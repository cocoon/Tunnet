//! Datagram ingress readers: one bulk + one optional latency reader per peer.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use dashmap::DashMap;
use iroh::EndpointId;
use tokio::task::JoinHandle;

/// Tracks active TUN ingress tasks per remote endpoint.
#[derive(Clone, Default)]
pub struct IngressRegistry {
    readers: Arc<DashMap<EndpointId, JoinHandle<()>>>,
    latency_readers: Arc<DashMap<EndpointId, JoinHandle<()>>>,
    generation: Arc<AtomicU64>,
}

impl IngressRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bump generation (e.g. data-plane down) so in-flight readers can exit.
    pub fn bump_generation(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Abort any existing bulk reader and start a new one.
    pub fn force_spawn<F>(&self, peer: EndpointId, fut: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        Self::force_spawn_map(&self.readers, peer, fut);
    }

    /// Replace the latency-ALPN ingress reader.
    pub fn force_spawn_latency<F>(&self, peer: EndpointId, fut: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        Self::force_spawn_map(&self.latency_readers, peer, fut);
    }

    fn force_spawn_map<F>(map: &Arc<DashMap<EndpointId, JoinHandle<()>>>, peer: EndpointId, fut: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        if let Some((_, h)) = map.remove(&peer) {
            h.abort();
        }
        Self::spawn_inner(map, peer, fut);
    }

    fn spawn_inner<F>(map: &Arc<DashMap<EndpointId, JoinHandle<()>>>, peer: EndpointId, fut: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        let readers = map.clone();
        let handle = tokio::spawn(async move {
            fut.await;
            readers.remove(&peer);
        });
        map.insert(peer, handle);
    }

    pub fn abort_all(&self) {
        self.bump_generation();
        for map in [&self.readers, &self.latency_readers] {
            let keys: Vec<_> = map.iter().map(|e| *e.key()).collect();
            for k in keys {
                if let Some((_, h)) = map.remove(&k) {
                    h.abort();
                }
            }
        }
    }

    #[cfg(test)]
    pub fn has_reader(&self, peer: EndpointId) -> bool {
        self.readers.get(&peer).is_some_and(|h| !h.is_finished())
    }

    #[cfg(test)]
    pub fn has_latency_reader(&self, peer: EndpointId) -> bool {
        self.latency_readers
            .get(&peer)
            .is_some_and(|h| !h.is_finished())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_registry_has_no_readers() {
        let reg = IngressRegistry::new();
        let mut bytes = [7u8; 32];
        bytes[0] = 1;
        let p = iroh::SecretKey::from(bytes).public();
        assert!(!reg.has_reader(p));
        reg.abort_all();
        assert!(!reg.has_reader(p));
    }

    #[test]
    fn force_spawn_replaces_bulk_reader() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let reg = IngressRegistry::new();
            let mut bytes = [3u8; 32];
            bytes[0] = 2;
            let p = iroh::SecretKey::from(bytes).public();
            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
            reg.force_spawn(p, async move {
                let _ = rx.await;
            });
            tokio::task::yield_now().await;
            assert!(reg.has_reader(p));
            reg.force_spawn(p, async {});
            tokio::task::yield_now().await;
            // Previous reader aborted; new one finishes immediately.
            assert!(!reg.has_reader(p));
            drop(tx);
            tokio::task::yield_now().await;
        });
    }

    #[test]
    fn latency_reader_independent_of_bulk() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let reg = IngressRegistry::new();
            let mut bytes = [9u8; 32];
            bytes[0] = 4;
            let p = iroh::SecretKey::from(bytes).public();
            let (tx1, rx1) = tokio::sync::oneshot::channel::<()>();
            let (tx2, rx2) = tokio::sync::oneshot::channel::<()>();
            reg.force_spawn(p, async move {
                let _ = rx1.await;
            });
            reg.force_spawn_latency(p, async move {
                let _ = rx2.await;
            });
            tokio::task::yield_now().await;
            assert!(reg.has_reader(p));
            assert!(reg.has_latency_reader(p));
            reg.abort_all();
            assert!(!reg.has_reader(p));
            assert!(!reg.has_latency_reader(p));
            drop(tx1);
            drop(tx2);
            tokio::task::yield_now().await;
        });
    }

    #[test]
    fn abort_all_clears_readers() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let reg = IngressRegistry::new();
            let mut bytes = [5u8; 32];
            bytes[0] = 3;
            let p = iroh::SecretKey::from(bytes).public();
            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
            reg.force_spawn(p, async move {
                let _ = rx.await;
            });
            tokio::task::yield_now().await;
            assert!(reg.has_reader(p));
            reg.abort_all();
            assert!(!reg.has_reader(p));
            drop(tx);
            tokio::task::yield_now().await;
        });
    }
}
