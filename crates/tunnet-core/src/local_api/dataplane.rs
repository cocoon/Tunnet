//! Kameo-free control surface for pausing / resuming the agent data plane.
//!
//! HTTP handlers receive a narrow [`DataPlaneControl`] interface. The agent
//! implements it with Kameo `ReplyRecipient`s; frequently-read status is served
//! from a cheap atomic snapshot, never via an actor round-trip.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;

/// Narrow control capability used by the Local Management API.
///
/// Implemented in `tunnet-agent` on top of the `DataPlaneActor`. Kept in core
/// as a plain async trait so core never depends on Kameo.
#[async_trait]
pub trait DataPlaneControl: Send + Sync {
    fn is_up(&self) -> bool;
    async fn bring_up(&self) -> Result<(), String>;
    async fn bring_down(&self) -> Result<(), String>;
}

/// Cheap shared read model for dataplane status.
///
/// The `DataPlaneActor` is the only writer; HTTP GETs read this directly.
#[derive(Clone, Default)]
pub struct DataPlaneStatusSnapshot {
    up: Arc<AtomicBool>,
}

impl DataPlaneStatusSnapshot {
    pub fn new(up: bool) -> Self {
        Self {
            up: Arc::new(AtomicBool::new(up)),
        }
    }

    pub fn is_up(&self) -> bool {
        self.up.load(Ordering::SeqCst)
    }

    pub fn set_up(&self, v: bool) {
        self.up.store(v, Ordering::SeqCst);
    }
}
