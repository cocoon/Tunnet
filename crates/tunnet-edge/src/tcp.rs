//! Dynamic TCP listeners for tunnel port mappings.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use parking_lot::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tunnet_common::PortMapping;

use crate::control::ControlClient;
use crate::metrics::EdgeMetrics;
use crate::registry::TunnelRegistry;
use crate::transport::AgentStream;

type MappingKey = (String, u16); // (subdomain, external_port)

struct ActiveListener {
    stop: oneshot::Sender<()>,
}

#[derive(Clone, Default)]
pub struct TcpMappingManager {
    inner: Arc<Mutex<HashMap<MappingKey, ActiveListener>>>,
    control: Arc<Mutex<Option<ControlClient>>>,
}

impl TcpMappingManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_control(&self, client: Option<ControlClient>) {
        *self.control.lock() = client;
    }

    /// Reconcile desired mappings from heartbeat against live listeners.
    pub fn reconcile(
        &self,
        desired: Vec<(String, String, PortMapping)>,
        registry: TunnelRegistry,
        metrics: EdgeMetrics,
    ) {
        let desired_keys: Vec<MappingKey> = desired
            .iter()
            .map(|(sub, _, m)| (sub.to_ascii_lowercase(), m.external_port))
            .collect();

        {
            let mut guard = self.inner.lock();
            let stale: Vec<MappingKey> = guard
                .keys()
                .filter(|k| !desired_keys.contains(k))
                .cloned()
                .collect();
            for key in stale {
                if let Some(listener) = guard.remove(&key) {
                    let _ = listener.stop.send(());
                }
            }
        }

        let control = self.control.lock().clone();

        for (subdomain, tunnel_id, mapping) in desired {
            let key = (subdomain.to_ascii_lowercase(), mapping.external_port);
            {
                let guard = self.inner.lock();
                if guard.contains_key(&key) {
                    continue;
                }
            }

            let (stop_tx, stop_rx) = oneshot::channel();
            {
                let mut guard = self.inner.lock();
                if guard.contains_key(&key) {
                    continue;
                }
                guard.insert(key.clone(), ActiveListener { stop: stop_tx });
            }

            let registry = registry.clone();
            let mgr = self.clone();
            let metrics = metrics.clone();
            let control = control.clone();
            let subdomain = key.0.clone();
            let external_port = mapping.external_port;
            let target_port = mapping.target_port;
            let target_ip = mapping.target_ipv4.map(|ip| ip.to_string());
            tokio::spawn(async move {
                if let Err(e) = run_tcp_listener(
                    subdomain.clone(),
                    tunnel_id,
                    external_port,
                    target_port,
                    target_ip,
                    registry,
                    metrics,
                    control,
                    stop_rx,
                )
                .await
                {
                    tracing::warn!(
                        ?e,
                        %subdomain,
                        external_port,
                        "TCP mapping listener exited"
                    );
                }
                mgr.inner.lock().remove(&(subdomain, external_port));
            });
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_tcp_listener(
    subdomain: String,
    tunnel_id: String,
    external_port: u16,
    target_port: u16,
    target_ip: Option<String>,
    registry: TunnelRegistry,
    metrics: EdgeMetrics,
    control: Option<ControlClient>,
    mut stop: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    let bind = SocketAddr::from(([0, 0, 0, 0], external_port));
    let listener = TcpListener::bind(bind)
        .await
        .with_context(|| format!("bind TCP mapping {bind}"))?;
    tracing::info!(%subdomain, external_port, target_port, "TCP mapping listening");

    loop {
        tokio::select! {
            _ = &mut stop => {
                tracing::info!(%subdomain, external_port, "TCP mapping stopped");
                break;
            }
            accepted = listener.accept() => {
                let (tcp, peer) = accepted?;
                let registry = registry.clone();
                let subdomain = subdomain.clone();
                let tunnel_id = tunnel_id.clone();
                let target_ip = target_ip.clone();
                let metrics = metrics.clone();
                let control = control.clone();
                tokio::spawn(async move {
                    if let Err(e) =
                        handle_tcp_client(
                            tcp,
                            peer,
                            &subdomain,
                            &tunnel_id,
                            target_port,
                            target_ip,
                            registry,
                            metrics,
                            control,
                        ).await
                    {
                        tracing::debug!(?e, %peer, %subdomain, "TCP mapping session ended");
                    }
                });
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn handle_tcp_client(
    tcp: TcpStream,
    peer: SocketAddr,
    subdomain: &str,
    tunnel_id: &str,
    target_port: u16,
    target_ip: Option<String>,
    registry: TunnelRegistry,
    metrics: EdgeMetrics,
    control: Option<ControlClient>,
) -> anyhow::Result<()> {
    metrics.tcp_accept();
    metrics.active_connections_inc();
    struct Guard(EdgeMetrics);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.active_connections_dec();
        }
    }
    let _guard = Guard(metrics.clone());

    let slot = match registry.get(subdomain) {
        Some(s) => s,
        None => {
            metrics.forward_failure("no_tunnel");
            anyhow::bail!("no tunnel for subdomain {subdomain}");
        }
    };
    let transport = {
        let guard = slot.transport.lock();
        match guard.clone() {
            Some(t) => t,
            None => {
                metrics.forward_failure("not_connected");
                anyhow::bail!("tunnel for {subdomain} not connected");
            }
        }
    };

    let stream = match transport.open_forward(target_port, target_ip).await {
        Ok(s) => s,
        Err(e) => {
            metrics.forward_failure("open_forward");
            return Err(e).context("open bi to agent");
        }
    };
    let AgentStream { mut send, mut recv } = stream;

    tracing::debug!(%subdomain, %peer, target_port, "TCP mapping proxying to agent");

    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let up = async {
        let mut buf = vec![0u8; 32 * 1024];
        let mut total = 0u64;
        loop {
            let n = tcp_read.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            send.write_all(&buf[..n]).await?;
            total += n as u64;
        }
        send.finish().ok();
        Ok::<_, anyhow::Error>(total)
    };
    let down = async {
        let mut buf = vec![0u8; 32 * 1024];
        let mut total = 0u64;
        while let Some(n) = recv.read(&mut buf).await? {
            tcp_write.write_all(&buf[..n]).await?;
            total += n as u64;
        }
        Ok::<_, anyhow::Error>(total)
    };
    let (a, b) = tokio::join!(up, down);
    let tx = a?;
    let rx = b?;
    metrics.bytes_add("tx", tx);
    metrics.bytes_add("rx", rx);
    if let Some(ref client) = control {
        client.record_bytes(tunnel_id, tx + rx);
    }
    Ok(())
}
