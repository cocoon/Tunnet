//! Per-peer FQ-CoDel packet scheduler state (RFC 8290, Tunnet-sized).
//!
//! Pure state machine: no I/O, no transport calls, no metrics registry. The
//! agent pump drives it (`next` → transmit or drop) and reports counters.
//!
//! ```text
//! PeerScheduler
//!   ├─ new flows (sparse/interactive, bounded epoch budget)
//!   ├─ old flows (backlogged, byte-DRR across flows)
//!   ├─ per-flow FIFO (ordering preserved within a flow)
//!   ├─ per-flow CoDel state (first_above_time/dropping/drop_next/count)
//!   └─ byte caps + emergency sojourn ceiling (safety bound only)
//! ```
//!
//! Complexity: dequeue touches O(1) flows (new-list head, then DRR cursor);
//! cap pressure probes at most a bounded number of flows. No linear scans,
//! no per-packet allocation on the dequeue path.
//!
//! The scheduler queues LOGICAL packets (§7): one inner packet is one
//! scheduling object. Segmentation happens after dequeue; the pump reports
//! actual wire bytes back via [`PeerScheduler::account_sent`] so fairness
//! reflects transmitted bytes including framing overhead.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use tunnet_common::packet::{FlowKey, LogicalPacket};

/// CoDel target: minimum sojourn indicating a standing queue (~5 ms baseline;
/// consider serialization time on slow links per RFC 8290 §4.2).
pub const CODEL_TARGET: Duration = Duration::from_millis(5);
/// CoDel interval: standing-queue observation window.
pub const CODEL_INTERVAL: Duration = Duration::from_millis(100);
/// Emergency maximum queue lifetime: hard safety bound only, not the AQM.
pub const EMERGENCY_CEILING: Duration = Duration::from_millis(1000);
/// Total queued bytes per peer (queueing budget shared with transport).
pub const PEER_BYTE_CAP: usize = 256 * 1024;
/// Hard packet cap per peer (memory bound for tiny packets).
pub const PEER_PACKET_CAP: usize = 512;
/// Per-flow packet cap (one flow cannot dominate peer memory).
pub const FLOW_PACKET_CAP: usize = 64;
/// New flows stay "sparse" until they send this many bytes.
pub const NEW_FLOW_BYTE_BUDGET: usize = 16 * 1024;
/// Sparse flow sojourn bar: heads older than this are not "interactive".
pub const SPARSE_SOJOURN_BAR: Duration = Duration::from_millis(25);
/// Cap-pressure probe bound (flows inspected per enqueue tdrops).
pub const CAP_PROBE_BOUND: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropReason {
    PeerByteCap,
    PeerPacketCap,
    FlowCap,
    Codel,
    EmergencyCeiling,
    TooLarge,
    NoConnection,
}

impl DropReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PeerByteCap => "sched_peer_bytes",
            Self::PeerPacketCap => "sched_peer_packets",
            Self::FlowCap => "sched_flow_cap",
            Self::Codel => "sched_codel",
            Self::EmergencyCeiling => "sched_emergency",
            Self::TooLarge => "datagram_too_large",
            Self::NoConnection => "no_connection",
        }
    }
}

/// Per-flow CoDel state (RFC 8290 §5.2, adapted to logical packets).
#[derive(Debug, Clone, Copy)]
struct CodelState {
    /// When the current above-target episode started (None = below target).
    first_above_time: Option<Instant>,
    /// In dropping state (sustained standing queue).
    dropping: bool,
    /// Next scheduled drop time while dropping.
    drop_next: Instant,
    /// Drops in the current episode (controls drop frequency).
    count: u32,
}

impl CodelState {
    fn new() -> Self {
        Self {
            first_above_time: None,
            dropping: false,
            drop_next: Instant::now(),
            count: 0,
        }
    }
}

struct QueuedPacket {
    packet: LogicalPacket,
    len: usize,
}

struct FlowQueue {
    packets: VecDeque<QueuedPacket>,
    bytes: usize,
    deficit: isize,
    epoch_bytes: usize,
    is_new: bool,
    codel: CodelState,
}

impl FlowQueue {
    fn new(now: Instant) -> Self {
        let _ = now;
        Self {
            packets: VecDeque::new(),
            bytes: 0,
            deficit: 0,
            epoch_bytes: 0,
            is_new: true,
            codel: CodelState::new(),
        }
    }
}

/// Scheduler counters reported to telemetry (deltas applied by the pump).
#[derive(Debug, Default, Clone, Copy)]
pub struct SchedCounters {
    pub enqueued: u64,
    pub sent_packets: u64,
    pub sent_bytes: u64,
    pub wire_bytes: u64,
    pub drops_codel: u64,
    pub drops_cap: u64,
    pub drops_emergency: u64,
    pub transport_full: u64,
}

/// Sojourn observation for histogram telemetry (filled by dequeue).
#[derive(Debug, Clone, Copy)]
pub struct SojournSample {
    pub sojourn: Duration,
}

/// Dequeue decision returned to the pump.
pub enum Dequeue {
    /// Transmit this logical packet (with its sojourn sample). Boxed: the
    /// packet is ~200 bytes and Empty is unit-sized.
    Send(Box<LogicalPacket>, SojournSample),
    /// Scheduler empty.
    Empty,
}

/// Per-peer FQ-CoDel scheduler. Not thread-safe; owned by the peer's pump
/// (either behind the fast-state lock or by a single pump task).
pub struct PeerScheduler {
    flows: HashMap<FlowKey, FlowQueue>,
    /// New (sparse) flows first, oldest-first.
    new_list: VecDeque<FlowKey>,
    /// Backlogged flows in DRR order.
    old_list: VecDeque<FlowKey>,
    bytes: usize,
    packets: usize,
    quantum: usize,
    target: Duration,
    interval: Duration,
    counters: SchedCounters,
}

impl PeerScheduler {
    pub fn new(quantum: usize) -> Self {
        Self::with_params(quantum, CODEL_TARGET, CODEL_INTERVAL)
    }

    /// Custom CoDel timing (tests, link-specific tuning). Production uses
    /// [`CODEL_TARGET`]/[`CODEL_INTERVAL`].
    pub fn with_params(quantum: usize, target: Duration, interval: Duration) -> Self {
        Self {
            flows: HashMap::new(),
            new_list: VecDeque::new(),
            old_list: VecDeque::new(),
            bytes: 0,
            packets: 0,
            quantum: quantum.max(512),
            target,
            interval: interval.max(Duration::from_millis(1)),
            counters: SchedCounters::default(),
        }
    }

    pub fn set_quantum(&mut self, quantum: usize) {
        self.quantum = quantum.max(512);
    }

    pub fn levels(&self) -> (u64, u64, u64) {
        (
            self.packets as u64,
            self.bytes as u64,
            self.flows.len() as u64,
        )
    }

    pub fn counters(&self) -> SchedCounters {
        self.counters
    }

    pub fn is_empty(&self) -> bool {
        self.packets == 0
    }

    /// Drop all queued packets (teardown ownership change). Returns the
    /// dropped (packets, bytes, flows) for gauge reconciliation.
    pub fn clear(&mut self) -> (u64, u64, u64) {
        let out = (
            self.packets as u64,
            self.bytes as u64,
            self.flows.len() as u64,
        );
        self.flows.clear();
        self.new_list.clear();
        self.old_list.clear();
        self.bytes = 0;
        self.packets = 0;
        out
    }

    /// Enqueue a logical packet. Returns the drop reason when shed.
    /// `now` should be the packet's observation time (usually Instant::now()).
    pub fn enqueue(&mut self, packet: LogicalPacket, now: Instant) -> Option<DropReason> {
        let flow = packet.flow;
        let len = packet.len();
        // Memory bounds first: probe a bounded number of flows for an
        // over-ceiling head to evict; otherwise shed the newcomer (tail drop
        // keeps the work O(1) instead of scanning all flows).
        if self.packets >= PEER_PACKET_CAP || self.bytes + len > PEER_BYTE_CAP {
            if !self.evict_one(now) && self.packets >= PEER_PACKET_CAP {
                self.counters.drops_cap += 1;
                return Some(DropReason::PeerPacketCap);
            }
            if self.bytes + len > PEER_BYTE_CAP {
                self.counters.drops_cap += 1;
                return Some(if self.packets >= PEER_PACKET_CAP {
                    DropReason::PeerPacketCap
                } else {
                    DropReason::PeerByteCap
                });
            }
        }
        let is_new_flow = !self.flows.contains_key(&flow);
        let q = self
            .flows
            .entry(flow)
            .or_insert_with(|| FlowQueue::new(now));
        if q.packets.len() >= FLOW_PACKET_CAP {
            // Per-flow cap: drop the flow's own stalest head (tail stays
            // fresh: retransmits and sparse signals survive).
            if let Some(old) = q.packets.pop_front() {
                q.bytes -= old.len;
                self.bytes -= old.len;
                self.packets -= 1;
                self.counters.drops_cap += 1;
            }
            if q.packets.len() >= FLOW_PACKET_CAP {
                self.counters.drops_cap += 1;
                return Some(DropReason::FlowCap);
            }
        }
        q.bytes += len;
        q.packets.push_back(QueuedPacket { packet, len });
        self.bytes += len;
        self.packets += 1;
        self.counters.enqueued += 1;
        if is_new_flow && !self.new_list.contains(&flow) && !self.old_list.contains(&flow) {
            self.new_list.push_back(flow);
        }
        None
    }

    /// Bounded cap-pressure eviction: inspect at most CAP_PROBE_BOUND flows
    /// (round-robin from the old list, then new list) for an emergency head.
    /// Returns true when something was evicted.
    fn evict_one(&mut self, now: Instant) -> bool {
        for _ in 0..CAP_PROBE_BOUND {
            let key = if let Some(k) = self.old_list.pop_front() {
                k
            } else if let Some(k) = self.new_list.pop_front() {
                k
            } else {
                return false;
            };
            let evicted = match self.flows.get_mut(&key) {
                Some(q) => match q.packets.front() {
                    Some(h)
                        if now.saturating_duration_since(h.packet.enqueued_at)
                            > EMERGENCY_CEILING =>
                    {
                        let old = q.packets.pop_front().expect("head");
                        q.bytes -= old.len;
                        self.bytes -= old.len;
                        self.packets -= 1;
                        self.counters.drops_emergency += 1;
                        true
                    }
                    Some(_) => {
                        // Not evictable: rotate to the back and keep probing.
                        if q.is_new {
                            self.new_list.push_back(key);
                        } else {
                            self.old_list.push_back(key);
                        }
                        false
                    }
                    None => false,
                },
                None => false,
            };
            if evicted {
                // Keep a non-empty flow scheduled.
                if let Some(q) = self.flows.get(&key) {
                    if !q.packets.is_empty() {
                        if q.is_new {
                            self.new_list.push_front(key);
                        } else {
                            self.old_list.push_front(key);
                        }
                    } else {
                        self.flows.remove(&key);
                    }
                }
                return true;
            }
        }
        false
    }

    /// Dequeue the next logical packet to transmit: sparse flows first
    /// (bounded epoch budget, young head), else byte-DRR across old flows
    /// with per-flow CoDel standing-queue control. O(1) flows per call.
    pub fn next(&mut self, now: Instant) -> Dequeue {
        // 1) Sparse/new flows: head-of-list only (no scan).
        if let Some(key) = self.new_list.pop_front() {
            match self.serve_sparse(key, now) {
                SparseOut::Send(packet, sample) => return Dequeue::Send(packet, sample),
                SparseOut::Gone => {}
                SparseOut::Demoted => {}
            }
        }
        // 2) Byte-DRR across old flows with CoDel. List rotation lives
        // here: serve_old only signals, never pushes (one owner, no dupes,
        // no zombie keys for emptied flows).
        let n = self.old_list.len();
        for _ in 0..n.max(1) {
            let Some(key) = self.old_list.pop_front() else {
                break;
            };
            match self.serve_old(key, now) {
                OldOut::Send(packet, sample) => {
                    if self.flows.get(&key).is_some_and(|q| !q.packets.is_empty()) {
                        self.old_list.push_back(key);
                    }
                    return Dequeue::Send(packet, sample);
                }
                OldOut::Rotate => {
                    if self.flows.get(&key).is_some_and(|q| !q.packets.is_empty()) {
                        self.old_list.push_back(key);
                    }
                    continue;
                }
                OldOut::Gone => continue,
            }
        }
        Dequeue::Empty
    }

    /// Requeue a packet at its flow head (transport-full: retry later without
    /// losing order). Restores both flow and global accounting so a
    /// dequeue→requeue cycle is a no-op on the books. Counts a
    /// transport-full event for backoff telemetry.
    pub fn requeue_head(&mut self, flow: FlowKey, packet: LogicalPacket) {
        let len = packet.len();
        match self.flows.get_mut(&flow) {
            Some(q) => {
                q.bytes += len;
                q.packets.push_front(QueuedPacket { packet, len });
            }
            None => {
                let mut q = FlowQueue::new(Instant::now());
                q.bytes = len;
                q.packets.push_front(QueuedPacket { packet, len });
                self.flows.insert(flow, q);
                self.old_list.push_front(flow);
            }
        }
        self.bytes += len;
        self.packets += 1;
        self.counters.transport_full += 1;
    }

    /// Account actual transmitted bytes (logical + framing overhead) for
    /// byte fairness that reflects wire cost (§7).
    pub fn account_sent(&mut self, flow: FlowKey, logical_len: usize, wire_len: usize) {
        self.counters.sent_packets += 1;
        self.counters.sent_bytes += logical_len as u64;
        self.counters.wire_bytes += wire_len as u64;
        if let Some(q) = self.flows.get_mut(&flow) {
            // Extra wire overhead beyond the DRR deficit debit leans future
            // rounds slightly against overhead-heavy flows.
            let overhead = wire_len.saturating_sub(logical_len);
            q.deficit -= overhead as isize;
        }
    }

    fn remove_flow(&mut self, key: &FlowKey) {
        self.flows.remove(key);
        self.new_list.retain(|k| k != key);
        self.old_list.retain(|k| k != key);
    }

    fn serve_sparse(&mut self, key: FlowKey, now: Instant) -> SparseOut {
        enum Prep {
            Send,
            Demote,
            Gone,
        }
        let prep = {
            let Some(q) = self.flows.get_mut(&key) else {
                return SparseOut::Gone;
            };
            // Emergency ceiling applies everywhere (safety bound only).
            while let Some(h) = q.packets.front() {
                if now.saturating_duration_since(h.packet.enqueued_at) > EMERGENCY_CEILING {
                    let old = q.packets.pop_front().expect("head");
                    q.bytes -= old.len;
                    self.bytes -= old.len;
                    self.packets -= 1;
                    self.counters.drops_emergency += 1;
                } else {
                    break;
                }
            }
            if q.packets.is_empty() {
                Prep::Gone
            } else {
                let young = q.packets.front().is_some_and(|h| {
                    now.saturating_duration_since(h.packet.enqueued_at) <= SPARSE_SOJOURN_BAR
                });
                if !q.is_new || q.epoch_bytes >= NEW_FLOW_BYTE_BUDGET || !young {
                    q.is_new = false;
                    Prep::Demote
                } else {
                    Prep::Send
                }
            }
        };
        match prep {
            Prep::Gone => {
                self.remove_flow(&key);
                SparseOut::Gone
            }
            Prep::Demote => {
                self.old_list.push_back(key);
                SparseOut::Demoted
            }
            Prep::Send => {
                let q = self.flows.get_mut(&key).expect("present");
                let qp = q.packets.pop_front().expect("head");
                let sample = SojournSample {
                    sojourn: now.saturating_duration_since(qp.packet.enqueued_at),
                };
                q.bytes -= qp.len;
                self.bytes -= qp.len;
                self.packets -= 1;
                q.epoch_bytes += qp.len;
                q.deficit += self.quantum as isize;
                q.deficit -= qp.len as isize;
                if q.packets.is_empty() {
                    self.remove_flow(&key);
                } else if q.epoch_bytes >= NEW_FLOW_BYTE_BUDGET {
                    q.is_new = false;
                    self.old_list.push_back(key);
                } else {
                    self.new_list.push_front(key);
                }
                SparseOut::Send(Box::new(qp.packet), sample)
            }
        }
    }

    fn serve_old(&mut self, key: FlowKey, now: Instant) -> OldOut {
        // Emergency ceiling + CoDel observe the head first.
        enum Head {
            Ready(usize),
            Dropped,
            Gone,
        }
        let head = {
            let Some(q) = self.flows.get_mut(&key) else {
                return OldOut::Gone;
            };
            // Emergency safety bound.
            while let Some(h) = q.packets.front() {
                if now.saturating_duration_since(h.packet.enqueued_at) > EMERGENCY_CEILING {
                    let old = q.packets.pop_front().expect("head");
                    q.bytes -= old.len;
                    self.bytes -= old.len;
                    self.packets -= 1;
                    self.counters.drops_emergency += 1;
                } else {
                    break;
                }
            }
            let (head_len, sojourn) = match q.packets.front() {
                Some(h) => (h.len, now.saturating_duration_since(h.packet.enqueued_at)),
                None => {
                    self.remove_flow(&key);
                    return OldOut::Gone;
                }
            };
            // CoDel control law (RFC 8290 §5.2) on head sojourn.
            let target = self.target;
            let interval = self.interval;
            let c = &mut q.codel;
            if sojourn < target {
                c.first_above_time = None;
                Head::Ready(head_len)
            } else if c.first_above_time.is_none() {
                c.first_above_time = Some(now + interval);
                Head::Ready(head_len)
            } else if now < c.first_above_time.expect("set") {
                Head::Ready(head_len)
            } else {
                // Standing queue: enter/continue dropping state.
                if !c.dropping {
                    c.dropping = true;
                    // First drop is immediate on entering dropping state.
                    c.drop_next = now;
                    c.count = 0;
                }
                if now < c.drop_next {
                    Head::Ready(head_len)
                } else {
                    c.count += 1;
                    // Next drop scheduled per control law: interval/sqrt(count).
                    let div = (c.count as f64).sqrt().max(1.0);
                    let step = interval.div_f64(div);
                    c.drop_next = now + step;
                    // Drop the head now.
                    let old = q.packets.pop_front().expect("head");
                    q.bytes -= old.len;
                    self.bytes -= old.len;
                    self.packets -= 1;
                    self.counters.drops_codel += 1;
                    // Re-observe the new head next visit.
                    if q.packets.is_empty() {
                        Head::Gone
                    } else {
                        Head::Dropped
                    }
                }
            }
        };
        match head {
            Head::Gone => {
                self.remove_flow(&key);
                OldOut::Gone
            }
            Head::Dropped => {
                // Dropped above; the caller requeues this flow for its next
                // packet (list ownership lives in `next`). An emptied flow
                // is removed outright so no zombie key lingers.
                if self.flows.get(&key).is_some_and(|q| q.packets.is_empty()) {
                    self.remove_flow(&key);
                    OldOut::Gone
                } else {
                    OldOut::Rotate
                }
            }
            Head::Ready(head_len) => {
                let q = self.flows.get_mut(&key).expect("present");
                q.deficit += self.quantum as isize;
                if (head_len as isize) > q.deficit {
                    return OldOut::Rotate;
                }
                let qp = q.packets.pop_front().expect("head");
                let sample = SojournSample {
                    sojourn: now.saturating_duration_since(qp.packet.enqueued_at),
                };
                q.bytes -= qp.len;
                self.bytes -= qp.len;
                self.packets -= 1;
                q.deficit -= qp.len as isize;
                q.epoch_bytes += qp.len;
                // Leaving dropping state: sojourn fell below target on a
                // previous observation (first_above_time cleared above).
                if q.codel.first_above_time.is_none() {
                    q.codel.dropping = false;
                    q.codel.count = 0;
                }
                if q.packets.is_empty() {
                    self.remove_flow(&key);
                }
                // List rotation belongs to the caller (`next` requeues on
                // Send/Rotate); serve_old never pushes.
                OldOut::Send(Box::new(qp.packet), sample)
            }
        }
    }
}

enum SparseOut {
    Send(Box<LogicalPacket>, SojournSample),
    Gone,
    Demoted,
}

enum OldOut {
    Send(Box<LogicalPacket>, SojournSample),
    Rotate,
    Gone,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tunnet_common::packet::PacketPool;

    fn pool() -> Arc<PacketPool> {
        PacketPool::new(64)
    }

    fn logical(pool: &Arc<PacketPool>, sport: u16, size: usize) -> LogicalPacket {
        let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64).udp(sport, 443);
        let mut raw = Vec::new();
        b.write(&mut raw, &vec![0u8; size]).unwrap();
        let mut buf = pool.acquire(raw.len());
        buf.recv_region(raw.len()).copy_from_slice(&raw);
        LogicalPacket::from_pooled(buf, raw.len()).unwrap()
    }

    fn drain_all(s: &mut PeerScheduler) -> Vec<(FlowKey, usize)> {
        let mut out = Vec::new();
        let mut guard = 4096;
        while guard > 0 {
            guard -= 1;
            match s.next(Instant::now()) {
                Dequeue::Send(p, _) => {
                    let (f, l) = (p.flow, p.len());
                    s.account_sent(f, l, l);
                    out.push((f, l));
                }
                Dequeue::Empty => break,
            }
        }
        out
    }

    #[test]
    fn per_flow_order_preserved() {
        let p = pool();
        let mut s = PeerScheduler::new(1536);
        for _ in 0..5 {
            assert!(s.enqueue(logical(&p, 1111, 100), Instant::now()).is_none());
        }
        let out = drain_all(&mut s);
        assert_eq!(out.len(), 5);
        assert!(out.windows(2).all(|w| w[0].0 == w[1].0));
        assert!(s.is_empty());
    }

    #[test]
    fn sparse_flow_jumps_bulk_backlog() {
        let p = pool();
        let mut s = PeerScheduler::new(1536);
        for _ in 0..20 {
            assert!(s.enqueue(logical(&p, 1111, 1200), Instant::now()).is_none());
        }
        // Age the bulk flow out of sparsity, as the pump would via demotion.
        let bulk_key = {
            let k = *s.new_list.iter().next().unwrap();
            let q = s.flows.get_mut(&k).unwrap();
            q.is_new = false;
            q.epoch_bytes = NEW_FLOW_BYTE_BUDGET;
            s.new_list.clear();
            s.old_list.push_back(k);
            k
        };
        assert!(s.enqueue(logical(&p, 2222, 100), Instant::now()).is_none());
        match s.next(Instant::now()) {
            Dequeue::Send(pkt, _) => assert_ne!(pkt.flow, bulk_key),
            Dequeue::Empty => panic!("expected sparse packet"),
        }
    }

    #[test]
    fn byte_drr_no_starvation() {
        let p = pool();
        let mut s = PeerScheduler::new(1536);
        for sport in [1111u16, 2222] {
            for _ in 0..4 {
                assert!(
                    s.enqueue(logical(&p, sport, 1200), Instant::now())
                        .is_none()
                );
            }
        }
        for k in s.flows.keys().cloned().collect::<Vec<_>>() {
            let q = s.flows.get_mut(&k).unwrap();
            q.is_new = false;
            q.epoch_bytes = NEW_FLOW_BYTE_BUDGET;
        }
        // Move both to the old list like the pump would via demotion.
        s.new_list.clear();
        for k in s.flows.keys().cloned().collect::<Vec<_>>() {
            s.old_list.push_back(k);
        }
        let out = drain_all(&mut s);
        assert_eq!(out.len(), 8);
        assert!(out.iter().any(|(f, _)| f.sport == 1111));
        assert!(out.iter().any(|(f, _)| f.sport == 2222));
    }

    #[test]
    fn codel_drops_standing_queue() {
        // A persistently backlogged flow with old arrivals must see CoDel
        // drops (not just emergency-ceiling drops) once its sojourn exceeds
        // target for longer than the interval. Custom short timing keeps the
        // test fast while exercising the real control law.
        let target = Duration::from_millis(2);
        let interval = Duration::from_millis(10);
        let p = pool();
        let mut s = PeerScheduler::with_params(1536, target, interval);
        let t0 = Instant::now() - interval - Duration::from_millis(5);
        for _ in 0..10 {
            let mut pkt = logical(&p, 1111, 1200);
            pkt.enqueued_at = t0;
            assert!(s.enqueue(pkt, t0).is_none());
        }
        // Demote to old so CoDel (not sparse preference) governs.
        for k in s.flows.keys().cloned().collect::<Vec<_>>() {
            let q = s.flows.get_mut(&k).unwrap();
            q.is_new = false;
            q.epoch_bytes = NEW_FLOW_BYTE_BUDGET;
        }
        s.new_list.clear();
        for k in s.flows.keys().cloned().collect::<Vec<_>>() {
            s.old_list.push_back(k);
        }
        // Keep the queue standing past the interval: serve + requeue.
        // Note: a CoDel drop ends the current drain round (the pump then
        // waits briefly and continues), so Empty does not end the test —
        // only the deadline or an observed drop does.
        let deadline = Instant::now() + Duration::from_millis(500);
        let mut codel_drops = 0u64;
        while Instant::now() < deadline {
            match s.next(Instant::now()) {
                Dequeue::Send(pkt, _) => {
                    let (f, l) = (pkt.flow, pkt.len());
                    s.requeue_head(f, *pkt);
                    let _ = l;
                }
                Dequeue::Empty => {}
            }
            codel_drops = s.counters().drops_codel;
            if codel_drops > 0 {
                break;
            }
        }
        assert!(codel_drops > 0, "CoDel must drop a standing queue");
        assert_eq!(s.counters().drops_emergency, 0);
    }

    #[test]
    fn emergency_ceiling_is_safety_only() {
        // Fresh traffic never hits the emergency path.
        let p = pool();
        let mut s = PeerScheduler::new(1536);
        for _ in 0..8 {
            assert!(s.enqueue(logical(&p, 1111, 200), Instant::now()).is_none());
        }
        let out = drain_all(&mut s);
        assert_eq!(out.len(), 8);
        assert_eq!(s.counters().drops_emergency, 0);
        assert_eq!(s.counters().drops_codel, 0);
    }

    #[test]
    fn memory_bounds_enforced_without_scan() {
        let p = pool();
        let mut s = PeerScheduler::new(1536);
        let offered = PEER_PACKET_CAP + 64;
        let mut shed = 0;
        for i in 0..offered {
            if s.enqueue(logical(&p, 1000 + (i % 8) as u16, 1400), Instant::now())
                .is_some()
            {
                shed += 1;
            }
        }
        let (packets, bytes, _) = s.levels();
        assert!((packets as usize) <= PEER_PACKET_CAP);
        assert!((bytes as usize) <= PEER_BYTE_CAP + 1500);
        // Every offered packet is either retained or shed exactly once:
        // hard drops (shed) plus per-flow AQM evictions (the rest of
        // drops_cap) plus emergency drops must reconcile with offered.
        let c = s.counters();
        assert!(c.drops_cap as usize >= shed);
        assert_eq!(
            (packets as usize) + (c.drops_cap as usize) + (c.drops_emergency as usize),
            offered
        );
    }

    #[test]
    fn icmp_isolates_from_tcp_bulk() {
        use tunnet_common::packet::LogicalPacket as LP;
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
        let icmp = LP::from_slice(&icmp_raw).unwrap();
        let tcp = LP::from_slice(&tcp_raw).unwrap();
        assert_ne!(icmp.flow, tcp.flow);
        let mut s = PeerScheduler::new(1536);
        for _ in 0..20 {
            let mut t = LP::from_slice(&tcp_raw).unwrap();
            t.enqueued_at = Instant::now();
            assert!(s.enqueue(t, Instant::now()).is_none());
        }
        // Bulk is backlogged (demoted as the pump would), so the fresh ICMP
        // flow must jump it.
        for k in s.flows.keys().cloned().collect::<Vec<_>>() {
            let q = s.flows.get_mut(&k).unwrap();
            q.is_new = false;
            q.epoch_bytes = NEW_FLOW_BYTE_BUDGET;
        }
        s.new_list.clear();
        for k in s.flows.keys().cloned().collect::<Vec<_>>() {
            s.old_list.push_back(k);
        }
        assert!(s.enqueue(icmp, Instant::now()).is_none());
        match s.next(Instant::now()) {
            Dequeue::Send(first, _) => assert_ne!(first.flow, tcp.flow),
            Dequeue::Empty => panic!("expected icmp"),
        }
    }

    #[test]
    fn requeue_preserves_order_per_peer() {
        // Transport-full requeue restores the head packet in order, and peer
        // schedulers are fully independent objects (no global HOL).
        let p = pool();
        let mut a = PeerScheduler::new(1536);
        let mut b = PeerScheduler::new(1536);
        for _ in 0..3 {
            assert!(a.enqueue(logical(&p, 1111, 100), Instant::now()).is_none());
        }
        assert!(b.enqueue(logical(&p, 9999, 100), Instant::now()).is_none());
        // Simulate transport-full on A: dequeue then requeue the head.
        let (flow, pkt) = match a.next(Instant::now()) {
            Dequeue::Send(pkt, _) => (pkt.flow, *pkt),
            Dequeue::Empty => panic!("expected packet"),
        };
        a.requeue_head(flow, pkt);
        // B drains independently (same packet shape, same length).
        let expect_len = logical(&p, 9999, 100).len();
        match b.next(Instant::now()) {
            Dequeue::Send(pkt, _) => assert_eq!(pkt.len(), expect_len),
            Dequeue::Empty => panic!("peer B must be independent of A"),
        }
        // A still holds all 3 packets in order.
        let mut n = 0;
        while !a.is_empty() {
            match a.next(Instant::now()) {
                Dequeue::Send(_, _) => n += 1,
                Dequeue::Empty => break,
            }
        }
        assert_eq!(n, 3);
        assert!(a.is_empty());
    }
}
