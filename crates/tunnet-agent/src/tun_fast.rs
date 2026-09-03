//! Platform-specific TUN fast paths sharing one packet semantics.
//!
//! Linux: tun-rs offload + `recv_multiple` / `send_multiple` with a reused
//! `GROTable` and `IDEAL_BATCH_SIZE` preallocated batch buffers.
//! Windows: Wintun ring drained/filled as bursts via `try_recv` / `try_send`
//! (bounded burst after each readiness wakeup; wait only when the ring is
//! actually empty/full). Ring capacity stays deliberate — bigger rings would
//! only mask queue management and worsen loaded latency.

#[cfg(windows)]
use std::time::Duration;
use tun_rs::AsyncDevice;
use tunnet_common::packet::PacketBuf;

/// Desired TUN batch depth (starting point; tun-rs `IDEAL_BATCH_SIZE` = 128).
#[cfg(target_os = "linux")]
pub const BATCH_SIZE: usize = tun_rs::IDEAL_BATCH_SIZE;
/// Windows burst budget per readiness wakeup.
pub const BURST_BUDGET: usize = 64;
/// Preallocated receive buffer per packet slot.
pub const SLOT_CAP: usize = 2048;

/// Preallocated batch engine for Linux `recv_multiple`.
/// (`send_multiple` needs per-task GRO state; see [`LinuxTunWriter`].)
#[cfg(target_os = "linux")]
pub struct LinuxBatchEngine {
    pub orig: Vec<u8>,
    pub bufs: Vec<Vec<u8>>,
    pub sizes: Vec<usize>,
}

#[cfg(target_os = "linux")]
impl Default for LinuxBatchEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "linux")]
impl LinuxBatchEngine {
    pub fn new() -> Self {
        Self {
            orig: vec![0u8; tun_rs::VIRTIO_NET_HDR_LEN + 65535],
            bufs: vec![vec![0u8; SLOT_CAP]; BATCH_SIZE],
            sizes: vec![0usize; BATCH_SIZE],
        }
    }

    /// Receive a batch; parses each packet once into a [`PacketBuf`].
    /// Reuses preallocated buffers; no per-iteration allocation.
    pub async fn recv_batch(&mut self, dev: &AsyncDevice) -> anyhow::Result<Vec<PacketBuf>> {
        let n = dev
            .recv_multiple(&mut self.orig, &mut self.bufs, &mut self.sizes, 0)
            .await?;
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let len = self.sizes[i];
            if len == 0 {
                continue;
            }
            if let Some(p) = PacketBuf::from_slice(&self.bufs[i][..len]) {
                out.push(p);
            }
        }
        Ok(out)
    }
}

/// GSO-aware TUN writer for Linux (one reused GRO table per task).
///
/// With offload enabled the kernel expects a virtio-net header in front of
/// every written packet, so plain `send()` of a raw IP packet misframes.
/// This stages `VIRTIO_NET_HDR_LEN` headroom in a reused scratch buffer and
/// writes through `send_multiple`, which is the documented offload-aware
/// path ("reuse the same GROTable instance across calls").
#[cfg(target_os = "linux")]
#[derive(Default)]
pub struct LinuxTunWriter {
    gro: tun_rs::GROTable,
    scratch: Vec<u8>,
}

#[cfg(target_os = "linux")]
impl LinuxTunWriter {
    /// Write one packet to the TUN device with correct offload framing.
    /// `pkt` is borrowed: the scratch staging buffer is reused across calls.
    pub async fn send(&mut self, dev: &AsyncDevice, pkt: &[u8]) -> anyhow::Result<()> {
        const HDR: usize = tun_rs::VIRTIO_NET_HDR_LEN;
        self.scratch.clear();
        self.scratch.resize(HDR, 0);
        self.scratch.extend_from_slice(pkt);
        let _ = dev
            .send_multiple(&mut self.gro, std::slice::from_mut(&mut self.scratch), HDR)
            .await?;
        Ok(())
    }
}

/// Windows burst drain: after readiness, `try_recv` until WouldBlock/budget.
pub async fn windows_recv_burst(
    dev: &AsyncDevice,
    budget: usize,
    slot: &mut Vec<u8>,
) -> anyhow::Result<Vec<PacketBuf>> {
    let mut out = Vec::with_capacity(budget.min(BURST_BUDGET));
    // Prime with one async recv so we wait only when the ring is empty.
    if out.is_empty() {
        slot.resize(SLOT_CAP, 0);
        match dev.recv(slot).await {
            Ok(0) => return Ok(out),
            Ok(n) => {
                if let Some(p) = PacketBuf::from_slice(&slot[..n]) {
                    out.push(p);
                }
            }
            Err(e) => return Err(e.into()),
        }
    }
    for _ in 1..budget.min(BURST_BUDGET) {
        slot.resize(SLOT_CAP, 0);
        match dev.try_recv(slot) {
            Ok(0) => break,
            Ok(n) => {
                if let Some(p) = PacketBuf::from_slice(&slot[..n]) {
                    out.push(p);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(out)
}

/// Windows burst fill: `try_send` until WouldBlock, then one async send.
#[cfg(windows)]
pub async fn windows_send_burst(dev: &AsyncDevice, pkts: &[&[u8]]) -> anyhow::Result<()> {
    let mut queued_async = false;
    for p in pkts {
        match dev.try_send(p) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // Ring full: wait via exactly one async send, then retry fast.
                if !queued_async {
                    dev.send(p).await?;
                    queued_async = true;
                } else {
                    // Fairness: stop the burst rather than piling async sends.
                    tokio::time::sleep(Duration::from_micros(200)).await;
                    return Ok(());
                }
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const _: () = {
        assert!(BURST_BUDGET >= 16 && BURST_BUDGET <= 256);
        assert!(SLOT_CAP >= 1500);
        assert!(SLOT_CAP >= 1280 + 64);
    };

    #[test]
    fn burst_budget_fits_linux_batch() {
        // One Windows burst must never exceed a Linux batch: shared
        // scheduler/backpressure semantics across platforms.
        let linux_batch: usize = std::env::var("TUNNET_TEST_BATCH")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(128);
        assert!(BURST_BUDGET <= linux_batch);
    }
}
