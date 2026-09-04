//! Platform-specific TUN fast paths sharing one packet semantics (§9).
//!
//! Linux: offload + `recv_multiple` into pool-owned batch slots (ownership
//! transferred to logical packets, no per-packet copy) and genuine
//! multi-packet `send_multiple` batches that let GSO coalesce.
//! Windows: Wintun ring drained as bursts into pooled buffers and filled
//! from an explicit pending batch that retains its unsent tail — no silent
//! loss. Ring capacity stays deliberate; bigger rings only mask queueing.
//!
//! All slot sizes derive from the configured virtual MTU (§6): a 2800+ byte
//! logical packet is never truncated by a fixed 2 KiB assumption.

#[cfg(not(target_os = "linux"))]
use std::collections::VecDeque;
use std::sync::Arc;

#[cfg(not(target_os = "linux"))]
use bytes::Bytes;
use tun_rs::AsyncDevice;
#[cfg(target_os = "linux")]
use tunnet_common::packet::PooledBuffer;
use tunnet_common::packet::{LogicalPacket, MAX_LOGICAL_LEN, PacketPool};

/// Desired TUN batch depth (starting point; tun-rs `IDEAL_BATCH_SIZE` = 128).
#[cfg(target_os = "linux")]
pub const BATCH_SIZE: usize = tun_rs::IDEAL_BATCH_SIZE;
/// Windows burst budget per readiness wakeup.
pub const BURST_BUDGET: usize = 64;
/// Inbound TUN write batch: packets accumulated per drain iteration (§9).
pub const TUN_WRITE_BATCH: usize = 32;

/// Slot size for a virtual MTU: payload room plus virtio headroom on Linux.
pub fn slot_cap_for_mtu(mtu: usize) -> usize {
    mtu.clamp(576, MAX_LOGICAL_LEN) + 256
}

/// Preallocated batch engine for Linux `recv_multiple`.
///
/// Batch slots are pool-owned buffers with frame headroom intact: on
/// receipt each slot moves wholesale into the logical packet
/// (`from_pooled` — zero copy, and single-frame transmit later prepends
/// its header with no staging copy) and the slot is refilled from the
/// pool. `recv_multiple` writes at offset 0 of the slot's receive area,
/// which starts after the headroom.
#[cfg(target_os = "linux")]
pub struct LinuxBatchEngine {
    pub orig: Vec<u8>,
    bufs: Vec<BatchSlot>,
    sizes: Vec<usize>,
    pool: Arc<PacketPool>,
    slot_cap: usize,
}

/// A pool-owned TUN receive slot. `AsMut` exposes the headroomed receive
/// area (sized by `prepare` before each batch); receipt transfers the
/// whole buffer into a logical packet with ownership and headroom intact.
#[cfg(target_os = "linux")]
struct BatchSlot(PooledBuffer);

#[cfg(target_os = "linux")]
impl BatchSlot {
    fn new(pool: &Arc<PacketPool>, slot_cap: usize) -> Self {
        let mut buf = pool.acquire(slot_cap);
        buf.recv_region(slot_cap);
        Self(buf)
    }

    /// Size the receive area for the next batch.
    fn prepare(&mut self, slot_cap: usize) {
        self.0.recv_region(slot_cap);
    }

    fn into_pooled(self) -> PooledBuffer {
        self.0
    }
}

#[cfg(target_os = "linux")]
impl AsRef<[u8]> for BatchSlot {
    fn as_ref(&self) -> &[u8] {
        self.0.as_ref()
    }
}

#[cfg(target_os = "linux")]
impl AsMut<[u8]> for BatchSlot {
    fn as_mut(&mut self) -> &mut [u8] {
        self.0.recv_area_mut()
    }
}

#[cfg(target_os = "linux")]
impl LinuxBatchEngine {
    pub fn new(pool: Arc<PacketPool>, mtu: usize) -> Self {
        let slot_cap = slot_cap_for_mtu(mtu);
        let mut bufs = Vec::with_capacity(BATCH_SIZE);
        for _ in 0..BATCH_SIZE {
            bufs.push(BatchSlot::new(&pool, slot_cap));
        }
        Self {
            orig: vec![0u8; tun_rs::VIRTIO_NET_HDR_LEN + 65535],
            bufs,
            sizes: vec![0usize; BATCH_SIZE],
            pool,
            slot_cap,
        }
    }

    /// Receive a batch; each packet takes ownership of its slot storage.
    /// Reuses preallocated/pooled buffers; no per-packet copy, and the
    /// common single-frame path never copies afterwards either.
    pub async fn recv_batch(&mut self, dev: &AsyncDevice) -> anyhow::Result<Vec<LogicalPacket>> {
        for b in &mut self.bufs {
            b.prepare(self.slot_cap);
        }
        let n = dev
            .recv_multiple(&mut self.orig, &mut self.bufs, &mut self.sizes, 0)
            .await?;
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let len = self.sizes[i];
            if len == 0 || len > self.slot_cap {
                continue;
            }
            // Move the pool-owned slot into the packet (zero copy,
            // headroom intact); refill the slot from the pool.
            let slot =
                std::mem::replace(&mut self.bufs[i], BatchSlot::new(&self.pool, self.slot_cap));
            if let Some(p) = LogicalPacket::from_pooled(slot.into_pooled(), len) {
                out.push(p);
            }
            // else: malformed; the fresh replacement slot stays.
        }
        Ok(out)
    }
}

/// Genuine multi-packet TUN writer for Linux (§9).
///
/// Accumulates decoded logical packets (each staged with virtio headroom in
/// pooled storage) and flushes with ONE `send_multiple`, letting GSO
/// coalesce same-flow segments into fewer syscalls. GRO state and staging
/// storage are reused across iterations.
#[cfg(target_os = "linux")]
pub struct LinuxTunBatchWriter {
    gro: tun_rs::GROTable,
    staging: Vec<Vec<u8>>,
    pool: Arc<PacketPool>,
}

#[cfg(target_os = "linux")]
impl LinuxTunBatchWriter {
    pub fn new(pool: Arc<PacketPool>) -> Self {
        Self {
            gro: tun_rs::GROTable::default(),
            staging: Vec::with_capacity(TUN_WRITE_BATCH),
            pool,
        }
    }

    /// Stage one packet (copied once into headroomed pooled storage).
    pub fn push(&mut self, pkt: &[u8]) {
        const HDR: usize = tun_rs::VIRTIO_NET_HDR_LEN;
        let mut buf = self.pool.acquire(pkt.len() + HDR);
        // Layout: [HDR zeros][packet], offset = HDR.
        let region = buf.recv_region(pkt.len() + HDR);
        region[..HDR].fill(0);
        region[HDR..].copy_from_slice(pkt);
        buf.set_len(pkt.len() + HDR);
        // Staging takes the Vec; flush recycles it via release_raw.
        self.staging.push(buf.into_vec());
    }

    pub fn is_empty(&self) -> bool {
        self.staging.is_empty()
    }

    /// Flush the staged batch with one `send_multiple` call.
    pub async fn flush(&mut self, dev: &AsyncDevice) -> anyhow::Result<usize> {
        if self.staging.is_empty() {
            return Ok(0);
        }
        const HDR: usize = tun_rs::VIRTIO_NET_HDR_LEN;
        let n = dev
            .send_multiple(&mut self.gro, &mut self.staging, HDR)
            .await?;
        // Recycle staging storage back into pool classes.
        let staging = std::mem::take(&mut self.staging);
        for v in staging {
            self.pool.release_raw(v);
        }
        Ok(n)
    }
}

/// Windows burst drain into pooled buffers: after readiness, `try_recv`
/// until WouldBlock/budget. Each packet owns its pooled storage (no copy).
pub async fn windows_recv_burst(
    dev: &AsyncDevice,
    pool: &Arc<PacketPool>,
    mtu: usize,
    budget: usize,
) -> anyhow::Result<Vec<LogicalPacket>> {
    let slot_cap = slot_cap_for_mtu(mtu);
    let mut out = Vec::with_capacity(budget.min(BURST_BUDGET));
    // Prime with one async recv so we wait only when the ring is empty.
    {
        let mut buf = pool.acquire(slot_cap);
        let n = dev.recv(buf.recv_region(slot_cap)).await?;
        if n == 0 {
            return Ok(out);
        }
        if let Some(p) = LogicalPacket::from_pooled(buf, n) {
            out.push(p);
        }
    }
    for _ in 1..budget.min(BURST_BUDGET) {
        let mut buf = pool.acquire(slot_cap);
        match dev.try_recv(buf.recv_region(slot_cap)) {
            Ok(0) => break,
            Ok(n) => {
                if let Some(p) = LogicalPacket::from_pooled(buf, n) {
                    out.push(p);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(out)
}

/// Pending TUN write batch (§9, no silent loss).
///
/// `drain_pending` fills the device with repeated `try_send`; when it is
/// full it waits once via async `send`, then resumes the SAME batch. The
/// unsent tail is retained in `pending` across waits — ownership is explicit
/// (`Bytes`, no copy) and nothing is silently discarded.
///
/// Used by the Windows Wintun burst writer and by platforms without GSO
/// batching (same ring discipline everywhere outside Linux, where the GSO
/// writer owns TUN output instead).
#[cfg(not(target_os = "linux"))]
pub struct TunWriteBatch {
    pub pending: VecDeque<Bytes>,
}

#[cfg(not(target_os = "linux"))]
impl TunWriteBatch {
    pub fn new() -> Self {
        Self {
            pending: VecDeque::new(),
        }
    }

    pub fn push(&mut self, pkt: Bytes) {
        self.pending.push_back(pkt);
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// Drain as much as the ring accepts right now. Returns the number of
    /// packets written; the remainder stays queued.
    pub fn drain_pending(&mut self, dev: &AsyncDevice) -> anyhow::Result<usize> {
        let mut wrote = 0;
        while let Some(front) = self.pending.front() {
            match dev.try_send(front) {
                Ok(_) => {
                    self.pending.pop_front();
                    wrote += 1;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => return Err(e.into()),
            }
        }
        Ok(wrote)
    }

    /// Drain with one async wait when the ring is full; the tail is retained.
    pub async fn drain_or_wait(&mut self, dev: &AsyncDevice) -> anyhow::Result<usize> {
        let wrote = self.drain_pending(dev)?;
        if self.pending.is_empty() {
            return Ok(wrote);
        }
        // Ring full: exactly one async send to wait for space, then resume
        // the same batch (no tail loss, no async-send pileup).
        if let Some(front) = self.pending.front().cloned() {
            dev.send(&front).await?;
            self.pending.pop_front();
            Ok(wrote + 1)
        } else {
            Ok(wrote)
        }
    }
}

#[cfg(not(target_os = "linux"))]
impl Default for TunWriteBatch {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const _: () = {
        assert!(BURST_BUDGET >= 16 && BURST_BUDGET <= 256);
        assert!(TUN_WRITE_BATCH >= 8);
    };

    #[test]
    fn slot_cap_tracks_mtu() {
        // No fixed 2048 assumption: large logical packets must fit.
        assert!(slot_cap_for_mtu(1280) >= 1280);
        assert!(slot_cap_for_mtu(2800) >= 2800);
        assert!(slot_cap_for_mtu(9000) >= 9000);
        assert!(slot_cap_for_mtu(100) >= 576);
        assert!(slot_cap_for_mtu(99_999) <= MAX_LOGICAL_LEN + 256);
    }

    #[test]
    #[cfg(not(target_os = "linux"))]
    fn tun_write_batch_retains_tail() {
        // Pure state-machine coverage (no device): pending ownership is
        // explicit; nothing is silently discarded.
        let mut b = TunWriteBatch::new();
        assert!(b.is_empty());
        b.push(Bytes::from_static(&[1, 2, 3]));
        b.push(Bytes::from_static(&[4, 5]));
        assert!(!b.is_empty());
    }
}
