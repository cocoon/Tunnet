//! Kameo process-local orchestration for the Tunnet agent.
//!
//! Rule: **actor = owner of durable process-local state or lifecycle,
//! task = transient or high-throughput work.** Packet forwarding never passes
//! through actor mailboxes; Iroh remains the network transport.

pub mod control;
pub mod dataplane;
pub mod posture;
pub mod presence;
pub mod routes;
pub mod ssh_registry;
pub mod supervisor;
#[cfg(test)]
pub mod test_support;
pub mod update;

/// Bounded mailbox capacities, chosen by traffic semantics (not arbitrary).
pub(crate) const ROUTE_MAILBOX: usize = 16;
pub(crate) const DATAPLANE_MAILBOX: usize = 16;
pub(crate) const POSTURE_MAILBOX: usize = 32;
pub(crate) const CONTROL_MAILBOX: usize = 128;
pub(crate) const PRESENCE_MAILBOX: usize = 16;
pub(crate) const UPDATE_MAILBOX: usize = 16;
pub(crate) const SSH_REGISTRY_MAILBOX: usize = 32;
pub(crate) const SUPERVISOR_MAILBOX: usize = 32;

use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

/// A raw Tokio task owned by an actor.
///
/// The actor starts it, tracks it, cancels it on stop, waits with a bounded
/// timeout, and aborts only as a final fallback.
pub(crate) struct OwnedTask {
    cancel: CancellationToken,
    handle: Option<JoinHandle<()>>,
}

impl OwnedTask {
    pub(crate) fn spawn<F>(name: &'static str, cancel: CancellationToken, fut: F) -> Self
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        let token = cancel.clone();
        let handle = tokio::spawn(async move {
            tokio::select! {
                _ = token.cancelled() => {},
                _ = fut => {},
            }
            let _ = name;
        });
        Self {
            cancel,
            handle: Some(handle),
        }
    }

    /// Spawn `fut`; if it completes while `cancel` is not cancelled, send
    /// `make_msg()` to `owner` (best-effort `try_send`). Shutdown completions
    /// stay silent. The owner must treat the message as abnormal failure
    /// (panic) so supervision restarts it — a long-lived owned service must
    /// never terminate silently while its actor lives on.
    pub(crate) fn spawn_monitored<A, M, F>(
        name: &'static str,
        cancel: CancellationToken,
        owner: kameo::actor::WeakActorRef<A>,
        msg: M,
        fut: F,
    ) -> Self
    where
        A: kameo::actor::Actor + kameo::message::Message<M>,
        M: Send + 'static,
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        let wait = cancel.clone();
        let wrapped = async move {
            fut.await;
            if !wait.is_cancelled()
                && let Some(actor) = owner.upgrade()
            {
                let _ = actor.tell(msg).try_send();
            }
        };
        Self::spawn(name, cancel, wrapped)
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancel.is_cancelled()
    }

    pub(crate) async fn shutdown(mut self) {
        self.cancel.cancel();
        if let Some(handle) = self.handle.take() {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), handle).await;
        }
    }

    pub(crate) async fn shutdown_with(mut self, timeout: std::time::Duration) {
        self.cancel.cancel();
        if let Some(handle) = self.handle.take() {
            match tokio::time::timeout(timeout, handle).await {
                Ok(_) => {}
                Err(_) => {
                    tracing::warn!("owned task shutdown timed out; aborting");
                }
            }
        }
    }
}

impl Drop for OwnedTask {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}
