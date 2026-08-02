//! Prometheus operational metrics for tunnet-edge.

use std::sync::Arc;
use std::time::Duration;

use metrics::{counter, describe_counter, describe_gauge, gauge};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone)]
pub struct EdgeMetrics {
    handle: PrometheusHandle,
}

impl EdgeMetrics {
    pub fn new() -> anyhow::Result<Self> {
        let handle = PrometheusBuilder::new().install_recorder()?;

        describe_gauge!(
            "tunnet_edge_active_tunnels",
            "Registered agent reverse tunnels"
        );
        describe_gauge!(
            "tunnet_edge_active_connections",
            "In-flight public HTTPS/TCP splices"
        );
        describe_gauge!(
            "tunnet_edge_registration_ok",
            "1 if last control-plane register succeeded"
        );
        describe_gauge!(
            "tunnet_edge_heartbeat_ok",
            "1 if last control-plane heartbeat succeeded"
        );

        describe_counter!("tunnet_edge_http_requests_total", "Public HTTPS requests");
        describe_counter!(
            "tunnet_edge_tcp_accepts_total",
            "Public TCP mapping accepts"
        );
        describe_counter!("tunnet_edge_bytes_total", "Bytes spliced to/from agents");
        describe_counter!(
            "tunnet_edge_forward_failures_total",
            "Failed agent forward/splice attempts"
        );
        describe_counter!(
            "tunnet_edge_control_failures_total",
            "Control-plane register/heartbeat/traffic failures"
        );
        describe_counter!(
            "tunnet_edge_acme_failures_total",
            "ACME certificate provisioning failures"
        );

        let upkeep = handle.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                interval.tick().await;
                upkeep.run_upkeep();
            }
        });

        Ok(Self { handle })
    }

    pub fn set_active_tunnels(&self, n: usize) {
        gauge!("tunnet_edge_active_tunnels").set(n as f64);
    }

    pub fn active_connections_inc(&self) {
        gauge!("tunnet_edge_active_connections").increment(1.0);
    }

    pub fn active_connections_dec(&self) {
        gauge!("tunnet_edge_active_connections").decrement(1.0);
    }

    pub fn registration_ok(&self, ok: bool) {
        gauge!("tunnet_edge_registration_ok").set(if ok { 1.0 } else { 0.0 });
    }

    pub fn heartbeat_ok(&self, ok: bool) {
        gauge!("tunnet_edge_heartbeat_ok").set(if ok { 1.0 } else { 0.0 });
    }

    pub fn http_request(&self) {
        counter!("tunnet_edge_http_requests_total").increment(1);
    }

    pub fn tcp_accept(&self) {
        counter!("tunnet_edge_tcp_accepts_total").increment(1);
    }

    pub fn bytes_add(&self, direction: &'static str, n: u64) {
        counter!("tunnet_edge_bytes_total", "direction" => direction).increment(n);
    }

    pub fn forward_failure(&self, reason: &'static str) {
        counter!("tunnet_edge_forward_failures_total", "reason" => reason).increment(1);
    }

    pub fn control_failure(&self, op: &'static str) {
        counter!("tunnet_edge_control_failures_total", "op" => op).increment(1);
    }

    pub fn acme_failure(&self) {
        counter!("tunnet_edge_acme_failures_total").increment(1);
    }

    pub fn render(&self) -> String {
        self.handle.render()
    }
}

/// Serve `/metrics` and `/ready` on the internal metrics bind.
pub fn spawn_metrics_server(metrics: EdgeMetrics, bind: String) {
    let metrics = Arc::new(metrics);
    tokio::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(&bind).await {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(?e, %bind, "failed to bind edge metrics endpoint");
                return;
            }
        };
        tracing::info!(%bind, "edge metrics listening (/metrics, /ready)");
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                continue;
            };
            let m = metrics.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req
                    .lines()
                    .next()
                    .and_then(|line| {
                        let mut parts = line.split_whitespace();
                        let _method = parts.next()?;
                        parts.next()
                    })
                    .unwrap_or("/");

                let (status, content_type, body) = match path.split('?').next().unwrap_or(path) {
                    "/metrics" => ("200 OK", "text/plain; version=0.0.4", m.render()),
                    "/ready" => ("200 OK", "text/plain", "ok\n".into()),
                    _ => ("404 Not Found", "text/plain", "not found\n".into()),
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });
}
