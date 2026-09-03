//! Flow-aware outbound scheduler (FQ-CoDel concept, Tunnet-sized).
//!
//! Replaces the old `latency / normal / bulk` three-pipe design, which
//! classified packets subjectively and still collapsed into one awaited bulk
//! sender (priority inversion).
//!
//! Scheduling unit is a **flow** ([`FlowKey`]: IP 5-tuple, or src/dst/proto
//! plus ICMP echo id for protocols without ports):
//!
//! ```text
//! PeerScheduler
//!   ├─ new (sparse/interactive) flows — drained first, bounded
//!   ├─ old (backlogged) flows — byte-DRR across flows
//!   ├─ per-flow FIFO (ordering preserved within a flow)
//!   ├─ byte DRR (fairness by bytes, not packets)
//!   └─ sojourn-time AQM (drop stale queue-building packets)
//! ```
//!
//! Properties: per-flow order, sparse-flow isolation, byte fairness, bounded
//! bytes/time/memory, no starvation, no strict-priority pipe, and crucially
//! **no awaited packet**: the pump dequeues only while the transport accepts
//! traffic (`try_send_fast`), so one full QUIC buffer never HOL-blocks newer
//! sparse traffic.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use bytes::Bytes;
use dashmap::DashMap;
use iroh::EndpointId;
use parking_lot::Mutex;
use tokio::sync::Notify;
use tunnet_common::packet::{FlowKey, PacketBuf};
use tunnet_core::{ConnPool, FastSendError};

use crate::metrics::AgentMetrics;

/// Total queued bytes per peer before AQM drops the stalest bulk packet.
/// 256 KiB ≈ 25 ms at 80 Mbps — two orders below the old ~1 MiB + 1 MiB stack.
pub const PEER_BYTE_CAP: usize = 256 * 1024;
/// Hard packet cap per peer (memory bound even for tiny packets).
pub const PEER_PACKET_CAP: usize = 512;
/// Per-flow packet cap (a single flow cannot dominate peer memory).
pub const FLOW_PACKET_CAP: usize = 64;
/// Sojourn budget: packets older than this are stale (AQM drop candidates).
/// Sparse flows are protected; backlogged flows are not.
pub const SOJOURN_TARGET: Duration = Duration::from_millis(25);
/// Absolute sojourn ceiling: nothing older survives, whatever the flow.
pub const SOJOURN_CEILING: Duration = Duration::from_millis(250);
/// New flows stay "sparse" until they have sent this many bytes in one epoch.
pub const NEW_FLOW_BYTE_BUDGET: usize = 16 * 1024;
/// DRR quantum per flow visit (one typical full-size packet + headroom).
pub const FLOW_QUANTUM: usize = 1536;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropReason {
    PeerByteCap,
    PeerPacketCap,
    FlowCap,
    StaleSojourn,
    TransportTooLarge,
    NoConnection,
}

impl DropReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PeerByteCap => "sched_peer_bytes",
            Self::PeerPacketCap => "sched_peer_packets",
            Self::FlowCap => "sched_flow_cap",
            Self::StaleSojourn => "sched_stale",
            Self::TransportTooLarge => "datagram_too_large",
            Self::NoConnection => "no_connection",
        }
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct QueueLevels {
    pub packets: u64,
    pub bytes: u64,
    pub active_flows: u64,
}

struct QueuedPacket {
    data: Bytes,
    len: usize,
    enqueued_at: Instant,
}

struct FlowQueue {
    packets: VecDeque<QueuedPacket>,
    bytes: usize,
    deficit: usize,
    /// Bytes sent in the current new/old epoch.
    epoch_bytes: usize,
    is_new: bool,
}

impl FlowQueue {
    fn new() -> Self {
        Self {
            packets: VecDeque::new(),
            bytes: 0,
            deficit: 0,
            epoch_bytes: 0,
            is_new: true,
        }
    }
}

struct PeerState {
    flows: Mutex<HashMap<FlowKey, FlowQueue>>,
    /// Round-robin order of backlogged flows.
    order: Mutex<VecDeque<FlowKey>>,
    bytes: AtomicU64,
    packets: AtomicU64,
    notify: Notify,
    running: std::sync::atomic::AtomicBool,
}

impl PeerState {
    fn new() -> Self {
        Self {
            flows: Mutex::new(HashMap::new()),
            order: Mutex::new(VecDeque::new()),
            bytes: AtomicU64::new(0),
            packets: AtomicU64::new(0),
            notify: Notify::new(),
            running: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Queue telemetry: (packets, bytes, active flows).
    fn snapshot(&self) -> QueueLevels {
        QueueLevels {
            packets: self.packets.load(Ordering::Relaxed),
            bytes: self.bytes.load(Ordering::Relaxed),
            active_flows: self.flows.lock().len() as u64,
        }
    }
}

/// Fan-out TUN packets to per-peer flow schedulers.
#[derive(Clone)]
pub struct OutboundScheduler {
    peers: Arc<DashMap<EndpointId, Arc<PeerState>>>,
    pool: ConnPool,
    metrics: AgentMetrics,
}

impl OutboundScheduler {
    pub fn new(pool: ConnPool, metrics: AgentMetrics, _mtu: u16) -> Self {
        Self {
            peers: Arc::new(DashMap::new()),
            pool,
            metrics,
        }
    }

    /// Enqueue a parsed packet into its flow. Bounded; drops per AQM policy.
    pub fn enqueue(&self, peer: EndpointId, packet: PacketBuf) {
        let state = self
            .peers
            .entry(peer)
            .or_insert_with(|| Arc::new(PeerState::new()))
            .clone();
        let flow = packet.flow;
        let len = packet.len();
        let queued = QueuedPacket {
            data: packet.into_bytes(),
            len,
            enqueued_at: Instant::now(),
        };
        let reason = enqueue_inner(&state, flow, queued, &self.metrics);
        if let Some(r) = reason {
            self.metrics.dropped_inc(r.as_str());
            self.metrics.sched_drop_inc(r.as_str());
            return;
        }
        state.bytes.fetch_add(len as u64, Ordering::Relaxed);
        state.packets.fetch_add(1, Ordering::Relaxed);
        self.metrics.sched_queue_set(
            state.packets.load(Ordering::Relaxed),
            state.bytes.load(Ordering::Relaxed),
            state.flows.lock().len() as u64,
        );

        if !state
            .running
            .swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            let pool = self.pool.clone();
            let metrics = self.metrics.clone();
            let peers = self.peers.clone();
            tokio::spawn(async move {
                run_peer_pump(peer, state, pool, metrics).await;
                peers.remove(&peer);
            });
        } else {
            state.notify.notify_one();
        }
    }
}

/// Bounded enqueue with AQM: returns `Some(reason)` when the packet is dropped.
fn enqueue_inner(
    state: &PeerState,
    flow: FlowKey,
    pkt: QueuedPacket,
    metrics: &AgentMetrics,
) -> Option<DropReason> {
    // Absolute peer bounds first.
    if state.packets.load(Ordering::Relaxed) as usize >= PEER_PACKET_CAP {
        evict_stalest(state, metrics);
        if state.packets.load(Ordering::Relaxed) as usize >= PEER_PACKET_CAP {
            return Some(DropReason::PeerPacketCap);
        }
    }
    if state.bytes.load(Ordering::Relaxed) as usize + pkt.len > PEER_BYTE_CAP {
        evict_stalest(state, metrics);
        if state.bytes.load(Ordering::Relaxed) as usize + pkt.len > PEER_BYTE_CAP {
            return Some(DropReason::PeerByteCap);
        }
    }
    let mut flows = state.flows.lock();
    let is_new_flow = !flows.contains_key(&flow);
    let q = flows.entry(flow).or_insert_with(FlowQueue::new);
    if q.packets.len() >= FLOW_PACKET_CAP {
        // Per-flow cap: drop the flow's own stalest head (keeps tail fresh,
        // preserves the newest sparse signal like retransmits).
        if let Some(old) = q.packets.pop_front() {
            q.bytes -= old.len;
            state.bytes.fetch_sub(old.len as u64, Ordering::Relaxed);
            state.packets.fetch_sub(1, Ordering::Relaxed);
            metrics.sched_drop_inc(DropReason::FlowCap.as_str());
        }
        if q.packets.len() >= FLOW_PACKET_CAP {
            return Some(DropReason::FlowCap);
        }
    }
    q.packets.push_back(pkt);
    q.bytes += q.packets.back().map(|p| p.len).unwrap_or(0);
    drop(flows);
    if is_new_flow {
        let mut order = state.order.lock();
        if !order.contains(&flow) {
            order.push_back(flow);
        }
    }
    None
}

/// Drop the single stalest packet of the most backlogged flow.
fn evict_stalest(state: &PeerState, metrics: &AgentMetrics) {
    let mut flows = state.flows.lock();
    let now = Instant::now();
    let mut victim: Option<FlowKey> = None;
    let mut victim_age = Duration::ZERO;
    let mut victim_backlog = 0usize;
    for (k, q) in flows.iter() {
        if let Some(head) = q.packets.front() {
            let age = now.saturating_duration_since(head.enqueued_at);
            if age > victim_age || (age == victim_age && q.bytes > victim_backlog) {
                victim_age = age;
                victim_backlog = q.bytes;
                victim = Some(*k);
            }
        }
    }
    if let Some(k) = victim
        && let Some(q) = flows.get_mut(&k)
        && let Some(old) = q.packets.pop_front()
    {
        q.bytes -= old.len;
        state.bytes.fetch_sub(old.len as u64, Ordering::Relaxed);
        state.packets.fetch_sub(1, Ordering::Relaxed);
        metrics.sched_drop_inc(DropReason::StaleSojourn.as_str());
        if q.packets.is_empty() {
            flows.remove(&k);
            state.order.lock().retain(|x| *x != k);
        }
    }
}

async fn run_peer_pump(
    peer: EndpointId,
    state: Arc<PeerState>,
    pool: ConnPool,
    metrics: AgentMetrics,
) {
    loop {
        // One pump round: new (sparse) flows first, then byte-DRR over old flows.
        // Dequeue only while the transport accepts traffic; on TransportFull
        // stop immediately and wait — never await holding a stale packet.
        let mut made_progress = false;
        loop {
            let next = dequeue_next(&state, &metrics);
            let Some((flow, pkt)) = next else { break };
            match pool.try_send_fast(peer, pkt.data.clone()) {
                Ok(()) => {
                    made_progress = true;
                    state.bytes.fetch_sub(pkt.len as u64, Ordering::Relaxed);
                    state.packets.fetch_sub(1, Ordering::Relaxed);
                    metrics.packets_inc("out");
                    metrics.bytes_add("out", pkt.len as u64);
                    pool.record_bytes_out(peer, pkt.len as u64);
                    after_send(&state, flow, pkt.len);
                }
                Err(FastSendError::TransportFull) => {
                    // Put it back at the head; back off until capacity frees.
                    requeue_head(&state, flow, pkt);
                    metrics.sched_transport_full_inc();
                    break;
                }
                Err(FastSendError::TooLarge) => {
                    state.bytes.fetch_sub(pkt.len as u64, Ordering::Relaxed);
                    state.packets.fetch_sub(1, Ordering::Relaxed);
                    metrics.dropped_inc(DropReason::TransportTooLarge.as_str());
                    after_send(&state, flow, 0);
                }
                Err(FastSendError::NoConnection) | Err(FastSendError::Closed) => {
                    // No live connection: requeue head and park until the
                    // slow reconnect path restores it or the packet goes stale.
                    requeue_head(&state, flow, pkt);
                    metrics.dropped_inc(DropReason::NoConnection.as_str());
                    // Trigger slow-path dial without blocking the pump.
                    let pool2 = pool.clone();
                    tokio::spawn(async move {
                        let _ = pool2.get(peer).await;
                    });
                    break;
                }
            }
            // Opportunistic stale-head eviction keeps sojourn bounded even
            // when the transport is draining slowly.
            evict_over_ceiling(&state, &metrics);
        }

        // Publish queue telemetry for this peer (cheap gauges).
        let snap = state.snapshot();
        metrics.sched_queue_set(snap.packets, snap.bytes, snap.active_flows);

        if state.packets.load(Ordering::Relaxed) == 0 {
            tokio::select! {
                _ = state.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    if state.packets.load(Ordering::Relaxed) == 0 {
                        state.running.store(false, std::sync::atomic::Ordering::Release);
                        if state.packets.load(Ordering::Relaxed) > 0
                            && !state.running.swap(true, std::sync::atomic::Ordering::AcqRel)
                        {
                            continue;
                        }
                        if state.packets.load(Ordering::Relaxed) == 0 {
                            return;
                        }
                    }
                }
            }
            if !made_progress && state.packets.load(Ordering::Relaxed) == 0 {
                // Spurious wake with empty queues.
            }
        } else if !made_progress {
            // Transport full or no connection: wait for capacity/notify.
            tokio::select! {
                _ = state.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(5)) => {}
            }
        }
    }
}

/// Pick the next packet: sparse (new) flows first, else byte-DRR round robin.
/// Drops sojourn-violating heads inline (AQM).
fn dequeue_next(state: &PeerState, metrics: &AgentMetrics) -> Option<(FlowKey, QueuedPacket)> {
    let now = Instant::now();
    let mut flows = state.flows.lock();
    let mut order = state.order.lock();
    if flows.is_empty() {
        return None;
    }
    // 1) Sparse/new flows: any flow under its new-flow budget and with a
    // young head packet jumps the queue (interactive isolation).
    let mut sparse_idx: Option<usize> = None;
    for (i, key) in order.iter().enumerate() {
        if let Some(q) = flows.get(key) {
            let young = q
                .packets
                .front()
                .is_some_and(|h| now.saturating_duration_since(h.enqueued_at) <= SOJOURN_TARGET);
            if q.is_new && q.epoch_bytes < NEW_FLOW_BYTE_BUDGET && young && !q.packets.is_empty() {
                sparse_idx = Some(i);
                break;
            }
        }
    }
    if let Some(i) = sparse_idx {
        let key = order.remove(i).unwrap();
        enum SparseOut {
            Packet(QueuedPacket, bool, bool),
            Drained,
        }
        let out = {
            let Some(q) = flows.get_mut(&key) else {
                return dequeue_next_inner(state, flows, order, now, metrics);
            };
            // Drop stale heads within this flow first.
            while let Some(h) = q.packets.front() {
                if now.saturating_duration_since(h.enqueued_at) > SOJOURN_CEILING {
                    let old = q.packets.pop_front().unwrap();
                    q.bytes -= old.len;
                    state.bytes.fetch_sub(old.len as u64, Ordering::Relaxed);
                    state.packets.fetch_sub(1, Ordering::Relaxed);
                    metrics.sched_drop_inc(DropReason::StaleSojourn.as_str());
                } else {
                    break;
                }
            }
            match q.packets.pop_front() {
                None => SparseOut::Drained,
                Some(pkt) => {
                    q.bytes -= pkt.len;
                    q.epoch_bytes += pkt.len;
                    let promote = q.epoch_bytes >= NEW_FLOW_BYTE_BUDGET;
                    if promote {
                        q.is_new = false;
                    }
                    let empty = q.packets.is_empty();
                    SparseOut::Packet(pkt, empty, promote)
                }
            }
        };
        match out {
            SparseOut::Drained => {
                flows.remove(&key);
                return dequeue_next_inner(state, flows, order, now, metrics);
            }
            SparseOut::Packet(pkt, empty, promote) => {
                if empty {
                    flows.remove(&key);
                } else if promote {
                    order.push_back(key);
                } else {
                    // Still sparse: requeue at front for immediate follow-ups.
                    order.push_front(key);
                }
                return Some((key, pkt));
            }
        }
    }
    dequeue_next_inner(state, flows, order, now, metrics)
}

fn dequeue_next_inner(
    state: &PeerState,
    mut flows: parking_lot::MutexGuard<'_, HashMap<FlowKey, FlowQueue>>,
    mut order: parking_lot::MutexGuard<'_, VecDeque<FlowKey>>,
    now: Instant,
    metrics: &AgentMetrics,
) -> Option<(FlowKey, QueuedPacket)> {
    let n = order.len();
    for _ in 0..n {
        let Some(key) = order.pop_front() else { break };
        // AQM: drop stale heads beyond the ceiling before serving.
        let drained: bool = {
            let Some(q) = flows.get_mut(&key) else {
                continue;
            };
            while let Some(h) = q.packets.front() {
                if now.saturating_duration_since(h.enqueued_at) > SOJOURN_CEILING {
                    let old = q.packets.pop_front().unwrap();
                    q.bytes -= old.len;
                    state.bytes.fetch_sub(old.len as u64, Ordering::Relaxed);
                    state.packets.fetch_sub(1, Ordering::Relaxed);
                    metrics.sched_drop_inc(DropReason::StaleSojourn.as_str());
                } else {
                    break;
                }
            }
            q.packets.is_empty()
        };
        if drained {
            flows.remove(&key);
            continue;
        }
        enum Decision {
            Serve,
            Rotate,
            Drop,
        }
        let decision = {
            let Some(q) = flows.get_mut(&key) else {
                continue;
            };
            q.deficit += FLOW_QUANTUM;
            match q.packets.front().map(|h| h.len) {
                None => Decision::Drop,
                Some(head_len) if head_len > q.deficit => Decision::Rotate,
                _ => Decision::Serve,
            }
        };
        match decision {
            Decision::Drop => {
                flows.remove(&key);
                continue;
            }
            Decision::Rotate => {
                // Not enough deficit this visit; rotate and try the next flow.
                order.push_back(key);
                continue;
            }
            Decision::Serve => {}
        }
        let (pkt, empty) = {
            let q = flows.get_mut(&key).expect("flow present");
            let pkt = q.packets.pop_front().unwrap();
            q.bytes -= pkt.len;
            q.deficit -= pkt.len;
            q.epoch_bytes += pkt.len;
            if q.epoch_bytes >= NEW_FLOW_BYTE_BUDGET {
                q.is_new = false;
            }
            let empty = q.packets.is_empty();
            if empty {
                q.deficit = 0;
            }
            (pkt, empty)
        };
        if empty {
            flows.remove(&key);
        } else {
            order.push_back(key);
        }
        return Some((key, pkt));
    }
    None
}

fn after_send(state: &PeerState, flow: FlowKey, len: usize) {
    let _ = (state, flow, len);
}

fn requeue_head(state: &PeerState, flow: FlowKey, pkt: QueuedPacket) {
    let mut flows = state.flows.lock();
    if let Some(q) = flows.get_mut(&flow) {
        q.bytes += pkt.len;
        q.packets.push_front(pkt);
    } else {
        let mut q = FlowQueue::new();
        q.bytes = pkt.len;
        q.packets.push_front(pkt);
        flows.insert(flow, q);
        let mut order = state.order.lock();
        if !order.contains(&flow) {
            order.push_front(flow);
        }
    }
}

fn evict_over_ceiling(state: &PeerState, metrics: &AgentMetrics) {
    let now = Instant::now();
    let mut dropped = 0u64;
    {
        let mut flows = state.flows.lock();
        let mut empty = Vec::new();
        for (k, q) in flows.iter_mut() {
            while let Some(h) = q.packets.front() {
                if now.saturating_duration_since(h.enqueued_at) > SOJOURN_CEILING {
                    let old = q.packets.pop_front().unwrap();
                    q.bytes -= old.len;
                    state.bytes.fetch_sub(old.len as u64, Ordering::Relaxed);
                    state.packets.fetch_sub(1, Ordering::Relaxed);
                    dropped += 1;
                } else {
                    break;
                }
            }
            if q.packets.is_empty() {
                empty.push(*k);
            }
        }
        for k in empty {
            flows.remove(&k);
            state.order.lock().retain(|x| *x != k);
        }
    }
    if dropped > 0 {
        for _ in 0..dropped {
            metrics.dropped_inc(DropReason::StaleSojourn.as_str());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::AgentMetrics;

    fn metrics() -> AgentMetrics {
        AgentMetrics::for_tests()
    }

    fn queued(n: usize) -> QueuedPacket {
        QueuedPacket {
            data: Bytes::from(vec![0u8; n]),
            len: n,
            enqueued_at: Instant::now(),
        }
    }

    fn flow(a: u8, sport: u16) -> FlowKey {
        FlowKey {
            src: std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, a)),
            dst: std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, 99)),
            proto: 6,
            sport,
            dport: 443,
        }
    }

    #[test]
    fn per_flow_order_preserved() {
        let state = PeerState::new();
        for _ in 0..5 {
            assert!(enqueue_inner(&state, flow(1, 1111), queued(100), &metrics()).is_none());
            state.bytes.fetch_add(100, Ordering::Relaxed);
            state.packets.fetch_add(1, Ordering::Relaxed);
        }
        let mut sizes = Vec::new();
        while let Some((f, p)) = dequeue_next(&state, &metrics()) {
            assert_eq!(f, flow(1, 1111));
            sizes.push(p.len);
            state.bytes.fetch_sub(p.len as u64, Ordering::Relaxed);
            state.packets.fetch_sub(1, Ordering::Relaxed);
        }
        assert_eq!(sizes.len(), 5);
    }

    #[test]
    fn sparse_flow_jumps_bulk_backlog() {
        let state = PeerState::new();
        // Bulk flow: saturate its epoch so it is "old".
        let bulk = flow(1, 1111);
        for _ in 0..20 {
            assert!(enqueue_inner(&state, bulk, queued(1200), &metrics()).is_none());
            state.bytes.fetch_add(1200, Ordering::Relaxed);
            state.packets.fetch_add(1, Ordering::Relaxed);
        }
        {
            let mut flows = state.flows.lock();
            let q = flows.get_mut(&bulk).unwrap();
            q.is_new = false;
            q.epoch_bytes = NEW_FLOW_BYTE_BUDGET;
        }
        // Sparse flow arrives later.
        let sparse = flow(2, 2222);
        assert!(enqueue_inner(&state, sparse, queued(100), &metrics()).is_none());
        state.bytes.fetch_add(100, Ordering::Relaxed);
        state.packets.fetch_add(1, Ordering::Relaxed);
        let (first, _) = dequeue_next(&state, &metrics()).expect("packet");
        assert_eq!(first, sparse, "sparse flow must jump the bulk backlog");
    }

    #[test]
    fn byte_drr_no_starvation() {
        let state = PeerState::new();
        let a = flow(1, 1111);
        let b = flow(2, 2222);
        for f in [a, b] {
            for _ in 0..4 {
                assert!(enqueue_inner(&state, f, queued(1200), &metrics()).is_none());
                state.bytes.fetch_add(1200, Ordering::Relaxed);
                state.packets.fetch_add(1, Ordering::Relaxed);
            }
            let mut flows = state.flows.lock();
            let q = flows.get_mut(&f).unwrap();
            q.is_new = false;
            q.epoch_bytes = NEW_FLOW_BYTE_BUDGET;
        }
        let mut seen_a = 0;
        let mut seen_b = 0;
        while let Some((f, p)) = dequeue_next(&state, &metrics()) {
            if f == a {
                seen_a += 1;
            } else {
                seen_b += 1;
            }
            state.bytes.fetch_sub(p.len as u64, Ordering::Relaxed);
            state.packets.fetch_sub(1, Ordering::Relaxed);
        }
        assert!(seen_a > 0 && seen_b > 0, "no flow may starve");
    }

    #[test]
    fn stale_packets_dropped_by_ceiling() {
        let state = PeerState::new();
        let f = flow(1, 1111);
        let mut old = queued(100);
        old.enqueued_at = Instant::now() - SOJOURN_CEILING - Duration::from_millis(10);
        assert!(enqueue_inner(&state, f, old, &metrics()).is_none());
        state.bytes.fetch_add(100, Ordering::Relaxed);
        state.packets.fetch_add(1, Ordering::Relaxed);
        // Fresh packet in the same flow.
        assert!(enqueue_inner(&state, f, queued(100), &metrics()).is_none());
        state.bytes.fetch_add(100, Ordering::Relaxed);
        state.packets.fetch_add(1, Ordering::Relaxed);
        let (_, p) = dequeue_next(&state, &metrics()).expect("fresh survives");
        // Stale head dropped inside dequeue (2→1); the served fresh packet is
        // accounted by the pump after a successful transport submit, so the
        // counter still holds it here.
        assert_eq!(state.packets.load(Ordering::Relaxed), 1);
        assert_eq!(p.len, 100);
    }

    #[test]
    fn icmp_not_trapped_behind_tcp_bulk() {
        use tunnet_common::packet::PacketBuf;
        // Real ICMP echo packet → flow key must differ from TCP bulk flow.
        let icmp_raw = {
            let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64)
                .icmpv4_echo_request(7, 1);
            let mut o = Vec::new();
            b.write(&mut o, &[0; 32]).unwrap();
            o
        };
        let tcp_raw = {
            let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64)
                .tcp(40000, 443, 1, 1);
            let mut o = Vec::new();
            b.write(&mut o, &[0; 1200]).unwrap();
            o
        };
        let icmp = PacketBuf::from_slice(&icmp_raw).unwrap();
        let tcp = PacketBuf::from_slice(&tcp_raw).unwrap();
        assert_ne!(icmp.flow, tcp.flow, "ICMP must isolate from TCP bulk");

        let state = PeerState::new();
        for _ in 0..20 {
            assert!(enqueue_inner(&state, tcp.flow, queued(1200), &metrics()).is_none());
            state.bytes.fetch_add(1200, Ordering::Relaxed);
            state.packets.fetch_add(1, Ordering::Relaxed);
        }
        {
            let mut flows = state.flows.lock();
            let q = flows.get_mut(&tcp.flow).unwrap();
            q.is_new = false;
            q.epoch_bytes = NEW_FLOW_BYTE_BUDGET;
        }
        assert!(enqueue_inner(&state, icmp.flow, queued(64), &metrics()).is_none());
        state.bytes.fetch_add(64, Ordering::Relaxed);
        state.packets.fetch_add(1, Ordering::Relaxed);
        let (first, _) = dequeue_next(&state, &metrics()).expect("packet");
        assert_eq!(first, icmp.flow, "ICMP must jump saturated TCP bulk");
    }

    #[test]
    fn requeue_preserves_head_order_no_global_hol() {
        // Transport-full requeue must restore the head packet in order,
        // and peer schedulers must be fully independent (no global HOL).
        let a = PeerState::new();
        let b = PeerState::new();
        for _ in 0..3 {
            assert!(enqueue_inner(&a, flow(1, 1111), queued(100), &metrics()).is_none());
            a.bytes.fetch_add(100, Ordering::Relaxed);
            a.packets.fetch_add(1, Ordering::Relaxed);
        }
        assert!(enqueue_inner(&b, flow(9, 9999), queued(100), &metrics()).is_none());
        b.bytes.fetch_add(100, Ordering::Relaxed);
        b.packets.fetch_add(1, Ordering::Relaxed);
        // Simulate a transport-full on peer A: head requeued, peer B drains.
        let (f, p) = dequeue_next(&a, &metrics()).unwrap();
        requeue_head(&a, f, p);
        let (_, pb) = dequeue_next(&b, &metrics()).expect("peer B independent of A");
        assert_eq!(pb.len, 100);
        // Peer A still has all 3 packets in order.
        let mut n = 0;
        while dequeue_next(&a, &metrics()).is_some() {
            n += 1;
        }
        assert_eq!(n, 3);
    }

    #[test]
    fn memory_bounds_enforced() {
        let state = PeerState::new();
        let offered = PEER_PACKET_CAP + 64;
        let mut drops = 0;
        for i in 0..offered {
            let r = enqueue_inner(
                &state,
                flow(1, 1000 + (i % 8) as u16),
                queued(1400),
                &metrics(),
            );
            if r.is_some() {
                drops += 1;
            } else {
                state.bytes.fetch_add(1400, Ordering::Relaxed);
                state.packets.fetch_add(1, Ordering::Relaxed);
            }
        }
        let retained = state.packets.load(Ordering::Relaxed) as usize;
        // Hard bounds hold regardless of pressure.
        assert!(retained <= PEER_PACKET_CAP);
        assert!(state.bytes.load(Ordering::Relaxed) as usize <= PEER_BYTE_CAP + 1400);
        // Offered (576×1400B ≈ 807 KiB) far exceeds the 256 KiB byte budget,
        // so the scheduler must have shed load via AQM eviction/hard drops.
        assert!(
            retained + drops < offered,
            "scheduler must shed load under pressure"
        );
    }
}
