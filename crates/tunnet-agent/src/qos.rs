//! Per-peer Byte-DRR outbound scheduler for mesh IP datagrams.
//!
//! One canonical QUIC connection per peer; latency / normal / bulk queues feed a
//! single sender. Deficit is counted in **bytes**, not packets.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use bytes::Bytes;
use dashmap::DashMap;
use iroh::EndpointId;
use parking_lot::Mutex;
use tokio::sync::Notify;
use tunnet_core::ConnPool;

use crate::ip::ParsedIpv4;
use crate::metrics::AgentMetrics;

/// Typical packet quantum unit (~one TUN MTU).
const Q: usize = 1280;
const QUANTUM_LATENCY: usize = 8 * Q;
const QUANTUM_NORMAL: usize = 4 * Q;
const QUANTUM_BULK: usize = Q;

const CAP_LATENCY: usize = 64;
const CAP_NORMAL: usize = 256;
const CAP_BULK: usize = 512;

/// Packets at or above this size are treated as bulk (simple heuristic).
const BULK_SIZE_THRESHOLD: usize = 1200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Latency,
    Normal,
    Bulk,
}

impl Class {
    fn quantum(self) -> usize {
        match self {
            Self::Latency => QUANTUM_LATENCY,
            Self::Normal => QUANTUM_NORMAL,
            Self::Bulk => QUANTUM_BULK,
        }
    }
}

/// Classify an IPv4 packet into a QoS class.
pub fn classify(parsed: &ParsedIpv4, packet_len: usize) -> Class {
    use tunnet_common::policy::Protocol;
    match parsed.protocol {
        Protocol::Icmp => Class::Latency,
        Protocol::Tcp => {
            let flags = parsed.tcp_flags.unwrap_or(0);
            // SYN / FIN / RST
            if flags & (0x02 | 0x01 | 0x04) != 0 {
                return Class::Latency;
            }
            // Pure ACK (ACK set, no payload).
            if flags & 0x10 != 0 && parsed.l4_payload_len == 0 {
                return Class::Latency;
            }
            if is_dns(parsed) {
                return Class::Latency;
            }
            if packet_len >= BULK_SIZE_THRESHOLD {
                return Class::Bulk;
            }
            Class::Normal
        }
        Protocol::Udp => {
            if is_dns(parsed) {
                return Class::Latency;
            }
            if packet_len >= BULK_SIZE_THRESHOLD {
                return Class::Bulk;
            }
            Class::Normal
        }
        _ => {
            if packet_len >= BULK_SIZE_THRESHOLD {
                Class::Bulk
            } else {
                Class::Normal
            }
        }
    }
}

fn is_dns(parsed: &ParsedIpv4) -> bool {
    matches!(parsed.dst_port, Some(53)) || matches!(parsed.src_port, Some(53))
}

struct PeerState {
    latency: Mutex<VecDeque<Bytes>>,
    normal: Mutex<VecDeque<Bytes>>,
    bulk: Mutex<VecDeque<Bytes>>,
    notify: Notify,
    running: AtomicBool,
}

impl PeerState {
    fn new() -> Self {
        Self {
            latency: Mutex::new(VecDeque::new()),
            normal: Mutex::new(VecDeque::new()),
            bulk: Mutex::new(VecDeque::new()),
            notify: Notify::new(),
            running: AtomicBool::new(false),
        }
    }

    fn queue(&self, class: Class) -> &Mutex<VecDeque<Bytes>> {
        match class {
            Class::Latency => &self.latency,
            Class::Normal => &self.normal,
            Class::Bulk => &self.bulk,
        }
    }

    fn cap(class: Class) -> usize {
        match class {
            Class::Latency => CAP_LATENCY,
            Class::Normal => CAP_NORMAL,
            Class::Bulk => CAP_BULK,
        }
    }

    fn is_empty(&self) -> bool {
        self.latency.lock().is_empty()
            && self.normal.lock().is_empty()
            && self.bulk.lock().is_empty()
    }

    /// Enqueue with drop policy: prefer dropping bulk, then normal, before latency.
    fn try_enqueue(&self, class: Class, packet: Bytes) -> Result<(), ()> {
        {
            let mut q = self.queue(class).lock();
            if q.len() < Self::cap(class) {
                q.push_back(packet);
                return Ok(());
            }
        }
        // Target class full: try to free bulk first, then normal.
        if class != Class::Bulk {
            let mut bulk = self.bulk.lock();
            if !bulk.is_empty() {
                bulk.pop_front();
                drop(bulk);
                let mut q = self.queue(class).lock();
                if q.len() < Self::cap(class) {
                    q.push_back(packet);
                    return Ok(());
                }
            }
        }
        if class == Class::Latency {
            let mut normal = self.normal.lock();
            if !normal.is_empty() {
                normal.pop_front();
                drop(normal);
                let mut q = self.latency.lock();
                if q.len() < CAP_LATENCY {
                    q.push_back(packet);
                    return Ok(());
                }
            }
        }
        Err(())
    }
}

/// Fan-out TUN packets to per-peer Byte-DRR senders.
#[derive(Clone)]
pub struct OutboundScheduler {
    peers: Arc<DashMap<EndpointId, Arc<PeerState>>>,
    pool: ConnPool,
    metrics: AgentMetrics,
}

impl OutboundScheduler {
    pub fn new(pool: ConnPool, metrics: AgentMetrics) -> Self {
        Self {
            peers: Arc::new(DashMap::new()),
            pool,
            metrics,
        }
    }

    pub fn enqueue(&self, peer: EndpointId, class: Class, packet: Bytes) {
        let state = self
            .peers
            .entry(peer)
            .or_insert_with(|| Arc::new(PeerState::new()))
            .clone();

        if state.try_enqueue(class, packet).is_err() {
            self.metrics.dropped_inc(match class {
                Class::Latency => "qos_latency_full",
                Class::Normal => "qos_normal_full",
                Class::Bulk => "qos_bulk_full",
            });
            return;
        }

        if !state.running.swap(true, Ordering::AcqRel) {
            let pool = self.pool.clone();
            let metrics = self.metrics.clone();
            let peers = self.peers.clone();
            tokio::spawn(async move {
                run_peer_sender(peer, state, pool, metrics).await;
                peers.remove(&peer);
            });
        } else {
            state.notify.notify_one();
        }
    }
}

async fn run_peer_sender(
    peer: EndpointId,
    state: Arc<PeerState>,
    pool: ConnPool,
    metrics: AgentMetrics,
) {
    let mut deficit = [0usize; 3]; // latency, normal, bulk
    loop {
        let mut sent_any = false;
        for (idx, class) in [Class::Latency, Class::Normal, Class::Bulk]
            .into_iter()
            .enumerate()
        {
            {
                let q = state.queue(class).lock();
                if q.is_empty() {
                    deficit[idx] = 0;
                    continue;
                }
            }
            deficit[idx] = deficit[idx].saturating_add(class.quantum());
            loop {
                let packet = {
                    let mut q = state.queue(class).lock();
                    let Some(head) = q.front() else { break };
                    if head.len() > deficit[idx] {
                        break;
                    }
                    q.pop_front().expect("front checked")
                };
                let n = packet.len();
                deficit[idx] -= n;
                sent_any = true;
                match pool.send_or_buffer(peer, packet).await {
                    Ok(()) => {
                        metrics.packets_inc("out");
                        metrics.bytes_add("out", n as u64);
                        pool.record_bytes_out(peer, n as u64);
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        if msg.contains("datagram_too_large") {
                            metrics.dropped_inc("datagram_too_large");
                        } else {
                            tracing::debug!(%peer, ?e, "send/buffer failed");
                            metrics.dropped_inc("send_failed");
                        }
                    }
                }
            }
        }

        if state.is_empty() {
            // Wait for more work or exit if idle after notify timeout.
            tokio::select! {
                _ = state.notify.notified() => {}
                _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => {
                    if state.is_empty() {
                        state.running.store(false, Ordering::Release);
                        // Race: packet enqueued after is_empty check.
                        if !state.is_empty()
                            && !state.running.swap(true, Ordering::AcqRel)
                        {
                            continue;
                        }
                        if state.is_empty() {
                            return;
                        }
                    }
                }
            }
            if !sent_any && state.is_empty() {
                // Spurious wake with empty queues.
            }
        }
    }
}

/// Run one Byte-DRR round over in-memory queues (unit tests / saturation checks).
#[cfg(test)]
fn drr_round_drain(
    latency: &mut VecDeque<Bytes>,
    normal: &mut VecDeque<Bytes>,
    bulk: &mut VecDeque<Bytes>,
    deficit: &mut [usize; 3],
    out: &mut Vec<(Class, usize)>,
) {
    for (idx, (class, q)) in [
        (Class::Latency, &mut *latency),
        (Class::Normal, &mut *normal),
        (Class::Bulk, &mut *bulk),
    ]
    .into_iter()
    .enumerate()
    {
        if q.is_empty() {
            deficit[idx] = 0;
            continue;
        }
        deficit[idx] = deficit[idx].saturating_add(class.quantum());
        while let Some(head) = q.front() {
            if head.len() > deficit[idx] {
                break;
            }
            let pkt = q.pop_front().expect("front");
            deficit[idx] -= pkt.len();
            out.push((class, pkt.len()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkt(n: usize) -> Bytes {
        Bytes::from(vec![0u8; n])
    }

    #[test]
    fn byte_drr_prefers_latency_but_bulk_progresses() {
        let mut latency = VecDeque::from([pkt(100), pkt(100), pkt(100)]);
        let mut normal: VecDeque<Bytes> = VecDeque::new();
        let mut bulk = VecDeque::from([pkt(1200), pkt(1200), pkt(1200)]);
        let mut deficit = [0usize; 3];
        let mut out = Vec::new();

        drr_round_drain(&mut latency, &mut normal, &mut bulk, &mut deficit, &mut out);

        let lat_bytes: usize = out
            .iter()
            .filter(|(c, _)| *c == Class::Latency)
            .map(|(_, n)| n)
            .sum();
        let bulk_bytes: usize = out
            .iter()
            .filter(|(c, _)| *c == Class::Bulk)
            .map(|(_, n)| n)
            .sum();
        assert!(lat_bytes >= 300, "latency should drain small packets");
        assert!(
            bulk_bytes >= 1200,
            "bulk must still send at least one quantum"
        );
        assert!(latency.is_empty());
        assert_eq!(bulk.len(), 2);
    }

    #[test]
    fn empty_queue_zeros_deficit() {
        let mut latency: VecDeque<Bytes> = VecDeque::new();
        let mut normal: VecDeque<Bytes> = VecDeque::new();
        let mut bulk: VecDeque<Bytes> = VecDeque::new();
        let mut deficit = [50_000, 0, 0];
        let mut out = Vec::new();
        drr_round_drain(&mut latency, &mut normal, &mut bulk, &mut deficit, &mut out);
        assert_eq!(deficit[0], 0);
        assert!(out.is_empty());
    }

    #[test]
    fn classify_icmp_and_dns_as_latency() {
        let icmp = ParsedIpv4 {
            src: "10.0.0.1".parse().unwrap(),
            dst: "10.0.0.2".parse().unwrap(),
            protocol: tunnet_common::policy::Protocol::Icmp,
            dst_port: None,
            src_port: None,
            tcp_flags: None,
            l4_payload_len: 0,
        };
        assert_eq!(classify(&icmp, 64), Class::Latency);

        let dns = ParsedIpv4 {
            src: "10.0.0.1".parse().unwrap(),
            dst: "8.8.8.8".parse().unwrap(),
            protocol: tunnet_common::policy::Protocol::Udp,
            dst_port: Some(53),
            src_port: Some(54321),
            tcp_flags: None,
            l4_payload_len: 32,
        };
        assert_eq!(classify(&dns, 60), Class::Latency);
    }

    #[test]
    fn classify_large_udp_as_bulk() {
        let p = ParsedIpv4 {
            src: "10.0.0.1".parse().unwrap(),
            dst: "10.0.0.2".parse().unwrap(),
            protocol: tunnet_common::policy::Protocol::Udp,
            dst_port: Some(5201),
            src_port: Some(40000),
            tcp_flags: None,
            l4_payload_len: 1200,
        };
        assert_eq!(classify(&p, 1228), Class::Bulk);
    }
}
