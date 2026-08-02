//! Accumulator for Tunnet Cloud deployment-relay traffic bytes.

use std::sync::Arc;

use parking_lot::Mutex;

/// Cloneable pending-byte accumulator flushed to the control plane on heartbeat.
#[derive(Clone, Default)]
pub struct CloudRelayMeter {
    pending: Arc<Mutex<u64>>,
}

impl CloudRelayMeter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add outbound bytes that traversed a metered cloud relay.
    pub fn record(&self, bytes: u64) {
        if bytes == 0 {
            return;
        }
        *self.pending.lock() += bytes;
    }

    /// Drain and return all pending bytes since the last take.
    pub fn take(&self) -> u64 {
        std::mem::take(&mut *self.pending.lock())
    }
}
