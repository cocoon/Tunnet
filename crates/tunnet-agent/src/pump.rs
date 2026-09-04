//! Per-peer outbound pump: FQ-CoDel → v2 segmenter → Model A transport.
//!
//! Each peer's pump owns one loop over its [`PeerFastState`]:
//!
//! ```text
//! scheduler.next() → logical packet (or resume stashed cursor)
//!   → single frame (header in headroom, from_owner, no copy) or
//!     segments (incremental cursor, pooled staging per segment)
//!   → fast.try_send_frame (Model A: space must fit the whole frame;
//!     the frame is returned on failure, so stalls never consume bytes)
//!   → TransportFull: stash cursor (segmented) or requeue (single),
//!     adaptive backoff (notify + RTT/4, no fixed 5 ms, no spin)
//!   → NoConnection: requeue whole packet, slow dial, wake on completion
//!   → TooLarge: refresh MPS, restart with fresh id (path shrank)
//! ```
//!
//! One logical packet emits at most [`MAX_SEGMENTS`] DATAGRAMs, so no packet
//! monopolizes the connection for an arbitrary burst (§7). Scheduler and
//! transport never see fragments — only logical packets and frames.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use bytes::Bytes;
use tunnet_common::packet::{
    FlowKey, LogicalPacket, MAX_LOGICAL_LEN, MAX_SEGMENTS, MIN_SEGMENT_PAYLOAD, PacketOwner,
    PacketPool, SEGMENT_OVERHEAD, SINGLE_OVERHEAD, SegmentHeader, encode_segment_prefix,
    encode_single_prefix, segment_count,
};
use tunnet_core::peers::{FastSendError, PeerFastState, PeerRegistry};
use tunnet_core::{ConnPool, scheduler::Dequeue};

use crate::metrics::AgentMetrics;

/// Ensure the peer's pump task is running; otherwise wake it.
pub fn ensure_pump(
    fast: &Arc<PeerFastState>,
    pool: ConnPool,
    metrics: AgentMetrics,
    bufs: Arc<PacketPool>,
    meter: tunnet_core::CloudRelayMeter,
) {
    if !fast.pump_running.swap(true, Ordering::AcqRel) {
        let ctx = PumpCtx {
            fast: fast.clone(),
            pool,
            metrics,
            bufs,
            meter,
        };
        tokio::spawn(async move {
            run_peer_pump(ctx).await;
        });
    } else {
        fast.notify.notify_one();
    }
}

struct PumpCtx {
    fast: Arc<PeerFastState>,
    pool: ConnPool,
    metrics: AgentMetrics,
    bufs: Arc<PacketPool>,
    meter: tunnet_core::CloudRelayMeter,
}

/// Shared transmit context: one struct instead of eight parameters.
struct Tx<'a> {
    fast: &'a Arc<PeerFastState>,
    pool: &'a ConnPool,
    metrics: &'a AgentMetrics,
    bufs: &'a Arc<PacketPool>,
    meter: &'a tunnet_core::CloudRelayMeter,
    peer: iroh::EndpointId,
}

/// Mid-packet transmit cursor (§7): stashed only across TransportFull waits.
/// The logical owner is retained untouched; segments encode from borrows, so
/// resume never re-parses and never loses bytes.
struct PartialPacket {
    packet: Option<LogicalPacket>,
    flow: FlowKey,
    next_index: usize,
    frame_id: u32,
    count: usize,
    total: usize,
}

impl PartialPacket {
    fn new(packet: LogicalPacket, flow: FlowKey, fast: &PeerFastState) -> Self {
        let total = packet.len();
        let mps = fast.mps.load(Ordering::Relaxed);
        let count = segment_count(total, mps).unwrap_or(1).max(1);
        Self {
            packet: Some(packet),
            flow,
            next_index: 0,
            frame_id: fast.next_frame_id.fetch_add(1, Ordering::Relaxed),
            count,
            total,
        }
    }
}

async fn run_peer_pump(ctx: PumpCtx) {
    let PumpCtx {
        fast,
        pool,
        metrics,
        bufs,
        meter,
    } = ctx;
    let peer = fast.identity.read().endpoint;
    let mut partial: Option<PartialPacket> = None;
    // Ownership epoch at pump start; teardown advances it so this task
    // drains and exits instead of parking on a dead generation.
    let epoch0 = fast.epoch.load(Ordering::Relaxed);
    // Last-seen queue levels for gauge-delta reconciliation (global gauges
    // are sums; per-pump deltas keep them correct without overwrites).
    let mut last_levels: (i64, i64, i64) = (0, 0, 0);
    let reconcile =
        |fast: &Arc<PeerFastState>, metrics: &AgentMetrics, last: &mut (i64, i64, i64)| {
            let (p, b, f) = fast.scheduler.lock().levels();
            let (p, b, f) = (p as i64, b as i64, f as i64);
            metrics.queue_add(p - last.0, b - last.1, f - last.2);
            *last = (p, b, f);
        };

    loop {
        // Ownership change (teardown/drop): shed queued packets, zero the
        // gauges, and exit. The scheduler contents belong to the old
        // generation and must not cross into a new TUN generation.
        // (Enqueue/dequeue deltas were emitted as they happened, so the
        // peer's live contribution equals its current levels: negate them.)
        if fast.epoch.load(Ordering::Relaxed) != epoch0 {
            let (p, b, f) = fast.scheduler.lock().clear();
            metrics.queue_add(-(p as i64), -(b as i64), -(f as i64));
            drop(partial);
            fast.pump_running.store(false, Ordering::Release);
            return;
        }
        // 1) Resume a stashed cursor, else dequeue the next logical packet.
        if partial.is_none() {
            let dequeued = {
                let mut sched = fast.scheduler.lock();
                sched.next(Instant::now())
            };
            match dequeued {
                Dequeue::Empty => {
                    reconcile(&fast, &metrics, &mut last_levels);
                    // Idle: wait for work or exit after a quiet period.
                    tokio::select! {
                        _ = fast.notify.notified() => continue,
                        _ = tokio::time::sleep(Duration::from_millis(50)) => {
                            if fast.scheduler.lock().is_empty() {
                                fast.pump_running.store(false, Ordering::Release);
                                if !fast.scheduler.lock().is_empty()
                                    && !fast.pump_running.swap(true, Ordering::AcqRel)
                                {
                                    continue;
                                }
                                if fast.scheduler.lock().is_empty() {
                                    // Zero this peer's gauge contribution from
                                    // live levels (deltas were emitted live).
                                    let (p, b, f) = fast.scheduler.lock().levels();
                                    metrics.queue_add(-(p as i64), -(b as i64), -(f as i64));
                                    return;
                                }
                            }
                            continue;
                        }
                    }
                }
                Dequeue::Send(packet, sample) => {
                    metrics.observe_sojourn(sample.sojourn);
                    let flow = packet.flow;
                    metrics.queue_add(-1, -(packet.len() as i64), 0);
                    partial = Some(PartialPacket::new(*packet, flow, &fast));
                }
            }
        }

        // Periodic MPS refresh covers silent path changes (plus event-driven
        // refresh in the pool's path watcher and TooLarge recovery below).
        if fast.sends_since_mps_check.fetch_add(1, Ordering::Relaxed) >= 512 {
            fast.sends_since_mps_check.store(0, Ordering::Relaxed);
            fast.refresh_mps();
        }

        // 2) Transmit the cursor to completion, stall, or drop.
        let mut cur = partial.take().expect("cursor");
        let tx = Tx {
            fast: &fast,
            pool: &pool,
            metrics: &metrics,
            bufs: &bufs,
            meter: &meter,
            peer,
        };
        match transmit_cursor(&tx, &mut cur).await {
            TransmitOut::Done { logical, frames } => {
                metrics.frame_sent_inc(frames);
                metrics.packets_inc("out");
                metrics.bytes_add("out", logical as u64);
                reconcile(&fast, &metrics, &mut last_levels);
            }
            TransmitOut::Stash => {
                partial = Some(cur);
                metrics.sched_transport_full_inc();
                // Adaptive backoff (§0.7): wake on new work or timeout.
                tokio::select! {
                    _ = fast.notify.notified() => {}
                    _ = tokio::time::sleep(PeerRegistry::backoff_for(&fast)) => {}
                }
            }
            TransmitOut::Wait => {
                // Requeue/dial handled inside; just back off briefly.
                tokio::select! {
                    _ = fast.notify.notified() => {}
                    _ = tokio::time::sleep(Duration::from_millis(10)) => {}
                }
            }
            TransmitOut::Dropped(reason) => {
                metrics.dropped_inc(reason);
                reconcile(&fast, &metrics, &mut last_levels);
            }
        }
    }
}

enum TransmitOut {
    /// Logical packet fully transmitted (logical bytes, segment frames).
    Done { logical: usize, frames: u64 },
    /// Transport full: caller stashes `cur` and backs off.
    Stash,
    /// Stalled but handled inside (requeued, dial kicked): caller waits.
    Wait,
    /// Dropped with reason.
    Dropped(&'static str),
}

/// Segmentation plan for a logical packet at one MPS snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SegmentPlan {
    /// Fits in one DATAGRAM (plus 1-byte prefix).
    Single,
    /// Split into `count` segments of at most `seg_cap` payload bytes.
    Segmented { count: usize, seg_cap: usize },
    /// Degenerate path (no useful segment fits).
    Impossible,
}

/// Pure sizing decision (§3, §7): single when it fits, else uniform
/// segments; impossible when the path cannot carry even minimal segments.
fn plan_for_mps(total: usize, mps: usize) -> SegmentPlan {
    if total == 0 || total > MAX_LOGICAL_LEN {
        return SegmentPlan::Impossible;
    }
    if total + SINGLE_OVERHEAD <= mps {
        return SegmentPlan::Single;
    }
    match usable_seg_cap(mps) {
        Some(seg_cap) => {
            let count = total.div_ceil(seg_cap).max(2);
            if count > MAX_SEGMENTS {
                SegmentPlan::Impossible
            } else {
                SegmentPlan::Segmented { count, seg_cap }
            }
        }
        None => SegmentPlan::Impossible,
    }
}

/// Transmit one cursor to completion, stall, or drop. At most MAX_SEGMENTS
/// DATAGRAMs per packet — bounded by construction.
async fn transmit_cursor(tx: &Tx<'_>, cur: &mut PartialPacket) -> TransmitOut {
    let mps = tx.fast.mps.load(Ordering::Relaxed);
    // Single-frame fast path (fresh cursors only; resumed cursors with
    // count == 1 encode the same way).
    if cur.next_index == 0 && matches!(plan_for_mps(cur.total, mps), SegmentPlan::Single) {
        return transmit_single(tx, cur).await;
    }
    transmit_segmented(tx, cur, mps).await
}

/// Encode a logical packet as one frame: pooled owners prepend the header
/// in headroom (no copy); shared owners stage through a pooled buffer.
async fn transmit_single(tx: &Tx<'_>, cur: &mut PartialPacket) -> TransmitOut {
    let Tx {
        fast,
        pool,
        metrics,
        bufs,
        meter,
        peer,
    } = tx;
    let packet = cur.packet.take().expect("cursor holds packet");
    let total = packet.len();
    let owner = packet.owner;
    let frame = match owner {
        PacketOwner::Pooled(mut buf) => match buf.header_slot(SINGLE_OVERHEAD) {
            Some(slot) => {
                encode_single_prefix(slot);
                Bytes::from_owner(buf)
            }
            None => {
                // No headroom (should not happen): stage a copy.
                let src = buf.as_ref().to_vec();
                drop(buf);
                stage_single(bufs, &src)
            }
        },
        PacketOwner::Shared(s) => stage_single(bufs, &s),
    };
    let wire = frame.len();
    match fast.try_send_frame(frame) {
        Ok(()) => {
            account_sent(fast, cur.flow, total, wire);
            if fast.relay.load(Ordering::Relaxed) {
                meter.record(wire as u64);
            }
            TransmitOut::Done {
                logical: total,
                frames: 1,
            }
        }
        Err((FastSendError::TransportFull, frame)) => {
            // Recover the frame, strip the prefix, requeue losslessly.
            if let Some(rebuilt) = LogicalPacket::from_shared(strip_single_prefix(frame)) {
                let flow = rebuilt.flow;
                let len = rebuilt.len() as i64;
                fast.scheduler.lock().requeue_head(flow, rebuilt);
                metrics.queue_add(1, len, 0);
            } else {
                metrics.dropped_inc("datagram_too_large");
            }
            TransmitOut::Wait
        }
        Err((FastSendError::NoConnection | FastSendError::Closed, frame)) => {
            if let Some(rebuilt) = LogicalPacket::from_shared(strip_single_prefix(frame)) {
                let flow = rebuilt.flow;
                let len = rebuilt.len() as i64;
                fast.scheduler.lock().requeue_head(flow, rebuilt);
                metrics.queue_add(1, len, 0);
            } else {
                // Our own encoding failed to re-parse: count it and still
                // kick the dial, since connectivity is suspect anyway.
                metrics.dropped_inc("no_connection");
            }
            kick_dial(pool, *peer, fast);
            TransmitOut::Wait
        }
        Err((FastSendError::TooLarge, frame)) => {
            // Stale MPS: refresh, rebuild the logical packet from the
            // recovered frame, and fall through to segmented encoding.
            fast.refresh_mps();
            let Some(rebuilt) = LogicalPacket::from_shared(strip_single_prefix(frame)) else {
                return TransmitOut::Dropped("datagram_too_large");
            };
            cur.packet = Some(rebuilt);
            cur.next_index = 0;
            cur.frame_id = fast.next_frame_id.fetch_add(1, Ordering::Relaxed);
            cur.total = cur.packet.as_ref().map(|p| p.len()).unwrap_or(0);
            cur.count = segment_count(cur.total, fast.mps.load(Ordering::Relaxed))
                .unwrap_or(1)
                .max(1);
            // Boxed: rare path (stale MPS on a single frame) that would
            // otherwise close a single↔segmented async cycle.
            return Box::pin(transmit_segmented(
                tx,
                cur,
                fast.mps.load(Ordering::Relaxed),
            ))
            .await;
        }
    }
}

fn kick_dial(pool: &ConnPool, peer: iroh::EndpointId, fast: &Arc<PeerFastState>) {
    let pool2 = pool.clone();
    let fast2 = fast.clone();
    tokio::spawn(async move {
        let _ = pool2.get(peer).await;
        fast2.notify.notify_one();
    });
}

fn stage_single(pool: &Arc<PacketPool>, payload: &[u8]) -> Bytes {
    let mut buf = pool.acquire(payload.len() + SINGLE_OVERHEAD);
    let region = buf.recv_region(payload.len() + SINGLE_OVERHEAD);
    encode_single_prefix(&mut region[..SINGLE_OVERHEAD]);
    region[SINGLE_OVERHEAD..].copy_from_slice(payload);
    buf.set_len(payload.len() + SINGLE_OVERHEAD);
    Bytes::from_owner(buf)
}

/// Remove the single-frame prefix, returning the logical payload.
fn strip_single_prefix(frame: Bytes) -> Bytes {
    if frame.first() == Some(&tunnet_common::packet::KIND_SINGLE) && frame.len() > 1 {
        frame.slice(1..)
    } else {
        frame
    }
}

/// Transmit the cursor's remainder segment by segment, encoding
/// incrementally from the retained logical owner.
async fn transmit_segmented(tx: &Tx<'_>, cur: &mut PartialPacket, mps: usize) -> TransmitOut {
    let Tx {
        fast,
        pool,
        metrics,
        bufs,
        meter,
        peer,
    } = tx;
    let (count, seg_cap) = match plan_for_mps(cur.total, mps) {
        SegmentPlan::Segmented { count, seg_cap } => (count, seg_cap),
        SegmentPlan::Single => {
            // Path grew (or cursor mis-sized): single now fits. Boxed:
            // this is the rare path and breaks the single↔segmented cycle.
            return Box::pin(transmit_single(tx, cur)).await;
        }
        SegmentPlan::Impossible => {
            // Degenerate path: refresh once, then give up if still useless.
            fast.refresh_mps();
            let mps2 = fast.mps.load(Ordering::Relaxed);
            match plan_for_mps(cur.total, mps2) {
                SegmentPlan::Segmented { count, seg_cap } => (count, seg_cap),
                SegmentPlan::Single => {
                    return Box::pin(transmit_single(tx, cur)).await;
                }
                SegmentPlan::Impossible => {
                    return TransmitOut::Dropped("datagram_too_large");
                }
            }
        }
    };
    if count != cur.count {
        // Path shrank (or first sizing): restart with a fresh id so the
        // receiver never mixes shapes (§3).
        cur.frame_id = fast.next_frame_id.fetch_add(1, Ordering::Relaxed);
        cur.count = count;
        cur.next_index = 0;
    }
    let mut frames = 0u64;
    // Bounded retries on flapping paths.
    let mut restarts = 0u8;
    loop {
        if cur.next_index >= cur.count {
            return TransmitOut::Done {
                logical: cur.total,
                frames,
            };
        }
        let i = cur.next_index;
        let off = i * seg_cap;
        let end = (off + seg_cap).min(cur.total);
        if off >= cur.total || end <= off {
            return TransmitOut::Dropped("datagram_too_large");
        }
        // Encode from a borrow (owner retained for resume/retry).
        let Some(packet) = cur.packet.as_ref() else {
            return TransmitOut::Dropped("datagram_too_large");
        };
        let payload = &packet.owner.as_bytes()[off..end];
        let mut buf = bufs.acquire(payload.len() + SEGMENT_OVERHEAD);
        {
            let region = buf.recv_region(payload.len() + SEGMENT_OVERHEAD);
            encode_segment_prefix(
                &mut region[..SEGMENT_OVERHEAD],
                SegmentHeader {
                    id: cur.frame_id,
                    index: i as u16,
                    count: cur.count as u16,
                    total: cur.total as u16,
                },
            );
            region[SEGMENT_OVERHEAD..].copy_from_slice(payload);
            buf.set_len(payload.len() + SEGMENT_OVERHEAD);
        }
        let frame = Bytes::from_owner(buf);
        let wire = frame.len();
        match fast.try_send_frame(frame) {
            Ok(()) => {
                frames += 1;
                account_sent(fast, cur.flow, 0, wire);
                if fast.relay.load(Ordering::Relaxed) {
                    meter.record(wire as u64);
                }
                cur.next_index += 1;
            }
            Err((FastSendError::TransportFull, _)) => {
                // Owner intact: stash the cursor, resume after backoff.
                return TransmitOut::Stash;
            }
            Err((FastSendError::NoConnection | FastSendError::Closed, _)) => {
                // Owner intact: requeue the whole logical packet (fresh id
                // on retry; orphaned prefix expires), then dial.
                if let Some(packet) = cur.packet.take() {
                    let flow = packet.flow;
                    let len = packet.len() as i64;
                    fast.scheduler.lock().requeue_head(flow, packet);
                    metrics.queue_add(1, len, 0);
                } else {
                    metrics.dropped_inc("no_connection");
                }
                kick_dial(pool, *peer, fast);
                return TransmitOut::Wait;
            }
            Err((FastSendError::TooLarge, _)) => {
                // Stale MPS mid-packet: refresh and restart whole packet.
                fast.refresh_mps();
                cur.next_index = 0;
                cur.frame_id = fast.next_frame_id.fetch_add(1, Ordering::Relaxed);
                restarts += 1;
                if restarts > 2 {
                    return TransmitOut::Dropped("datagram_too_large");
                }
                let mps2 = fast.mps.load(Ordering::Relaxed);
                if usable_seg_cap(mps2).is_none() && cur.total + SINGLE_OVERHEAD > mps2 {
                    return TransmitOut::Dropped("datagram_too_large");
                }
            }
        }
    }
}

fn usable_seg_cap(mps: usize) -> Option<usize> {
    let cap = mps.checked_sub(SEGMENT_OVERHEAD)?;
    (cap >= MIN_SEGMENT_PAYLOAD).then_some(cap)
}

fn account_sent(fast: &Arc<PeerFastState>, flow: FlowKey, logical_len: usize, wire_len: usize) {
    // Debit DRR by logical bytes; wire overhead leans future rounds.
    fast.scheduler
        .lock()
        .account_sent(flow, logical_len, wire_len);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_single_segmented_impossible() {
        // Exact fit → single.
        assert_eq!(plan_for_mps(1200, 1201), SegmentPlan::Single);
        // One byte over → segmented.
        assert!(matches!(
            plan_for_mps(1201, 1201),
            SegmentPlan::Segmented { .. }
        ));
        // 2800 logical at 1350 MPS → 3 segments of ≤1339.
        match plan_for_mps(2800, 1350) {
            SegmentPlan::Segmented { count, seg_cap } => {
                assert_eq!(count, 3);
                assert_eq!(seg_cap, 1350 - SEGMENT_OVERHEAD);
            }
            other => panic!("expected segmented, got {other:?}"),
        }
        assert_eq!(plan_for_mps(0, 1350), SegmentPlan::Impossible);
        assert_eq!(plan_for_mps(9001, 1500), SegmentPlan::Impossible);
        assert_eq!(plan_for_mps(100, 10), SegmentPlan::Impossible);
    }

    #[test]
    fn plan_path_shrink_grows_count() {
        // §3: the same logical packet needs more segments on a smaller path;
        // the pump restarts it with a fresh id (tested here via the planner).
        let total = 2800;
        let before = plan_for_mps(total, 1350);
        let after = plan_for_mps(total, 1200);
        match (before, after) {
            (
                SegmentPlan::Segmented { count: c1, .. },
                SegmentPlan::Segmented { count: c2, .. },
            ) => assert!(c2 >= c1, "shrink must not reduce segments"),
            other => panic!("expected segmented plans, got {other:?}"),
        }
        // 9000 at tiny MPS exceeds the segment cap (19 > 16).
        assert_eq!(plan_for_mps(9000, 500), SegmentPlan::Impossible);
    }

    #[test]
    fn single_encode_round_trip() {
        let pool = PacketPool::new(8);
        let payload = vec![0xABu8; 200];
        let frame = stage_single(&pool, &payload);
        assert_eq!(frame.len(), 201);
        assert_eq!(frame[0], tunnet_common::packet::KIND_SINGLE);
        let back = strip_single_prefix(frame);
        assert_eq!(&back[..], &payload[..]);
    }
}
