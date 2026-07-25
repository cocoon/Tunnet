//! Shared daemon state for the Local Management API.

use std::sync::Arc;
use std::time::Instant;

use crate::node::CoreNode;
use crate::send::SendManager;
use crate::serve::ServeManager;
use crate::tunnel::TunnelManager;

use super::bootstrap::BootstrapOps;
use super::dataplane::DataPlaneHandle;

/// Live agent state shared with the Local Management API server.
pub struct LocalApiState {
    pub node: CoreNode,
    pub hostname: String,
    pub agent_version: String,
    pub started_at: Instant,
    pub dns_upstream: Vec<String>,
    pub synthetic_base: String,
    pub magic_ip: String,
    pub peer_dns_active: Arc<std::sync::atomic::AtomicBool>,
    pub peer_rtt: Arc<dashmap::DashMap<String, f64>>,
    pub serves: ServeManager,
    pub tunnels: TunnelManager,
    pub send: SendManager,
    pub data_plane: DataPlaneHandle,
    pub bootstrap: Arc<dyn BootstrapOps>,
}

impl LocalApiState {
    pub fn uptime_secs(&self) -> u64 {
        self.started_at.elapsed().as_secs()
    }
}
