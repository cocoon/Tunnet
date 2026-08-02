//! Batched per-tunnel byte accumulator for cloud-hosted edge metering.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

#[derive(Clone, Default)]
pub struct UsageMeter {
    inner: Arc<Mutex<HashMap<String, u64>>>,
}

impl UsageMeter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, tunnel_id: &str, bytes: u64) {
        if bytes == 0 || tunnel_id.is_empty() {
            return;
        }
        let mut guard = self.inner.lock();
        *guard.entry(tunnel_id.to_string()).or_insert(0) += bytes;
    }

    /// Drain accumulated bytes for flush to the control plane.
    pub fn take_all(&self) -> Vec<(String, u64)> {
        let mut guard = self.inner.lock();
        guard.drain().filter(|(_, n)| *n > 0).collect()
    }
}
