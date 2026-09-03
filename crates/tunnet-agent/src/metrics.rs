use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use metrics::{Counter, Gauge, counter, describe_counter, describe_gauge, gauge};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};

/// Cached metric handles: registered once, incremented without per-packet
/// registry/label lookup. Very hot counters additionally accumulate in
/// task-local atomics and flush periodically.
#[derive(Clone)]
pub struct AgentMetrics {
    handle: PrometheusHandle,
    packets_out: Counter,
    packets_in: Counter,
    bytes_out: Counter,
    bytes_in: Counter,
    active_conns: Gauge,
    sched_queue_packets: Gauge,
    sched_queue_bytes: Gauge,
    sched_active_flows: Gauge,
    sched_transport_full: Counter,
    hot: Arc<HotCounters>,
}

#[derive(Default)]
struct HotCounters {
    packets_out: AtomicU64,
    bytes_out: AtomicU64,
    packets_in: AtomicU64,
    bytes_in: AtomicU64,
    drops: AtomicU64,
}

impl AgentMetrics {
    /// Test handle without installing a global recorder (parallel tests).
    #[cfg(test)]
    pub fn for_tests() -> Self {
        let recorder = PrometheusBuilder::new()
            .with_recommended_naming(true)
            .build_recorder();
        Self::from_handle(recorder.handle())
    }

    fn from_handle(handle: PrometheusHandle) -> Self {
        let packets_out = counter!("tunnet_packets_total", "direction" => "out");
        let packets_in = counter!("tunnet_packets_total", "direction" => "in");
        let bytes_out = counter!("tunnet_bytes_total", "direction" => "out");
        let bytes_in = counter!("tunnet_bytes_total", "direction" => "in");
        let active_conns = gauge!("tunnet_active_connections");
        let sched_queue_packets = gauge!("tunnet_sched_queue_packets");
        let sched_queue_bytes = gauge!("tunnet_sched_queue_bytes");
        let sched_active_flows = gauge!("tunnet_sched_active_flows");
        let sched_transport_full = counter!("tunnet_sched_transport_full_total");
        Self {
            handle,
            packets_out,
            packets_in,
            bytes_out,
            bytes_in,
            active_conns,
            sched_queue_packets,
            sched_queue_bytes,
            sched_active_flows,
            sched_transport_full,
            hot: Arc::new(HotCounters::default()),
        }
    }

    pub fn new() -> anyhow::Result<Self> {
        let handle = PrometheusBuilder::new()
            .with_recommended_naming(true)
            .install_recorder()?;

        describe_counter!("tunnet_packets_total", "Packets processed by the tunnel");
        describe_counter!("tunnet_bytes_total", "Bytes processed by the tunnel");
        describe_counter!("tunnet_dropped_packets_total", "Packets dropped");
        describe_counter!(
            "tunnet_sched_transport_full_total",
            "Transport-full events (scheduler owns drop/retry)"
        );
        describe_counter!("tunnet_sched_drops_total", "Scheduler drops by reason");
        describe_gauge!("tunnet_active_connections", "Live peer connections");
        describe_gauge!(
            "tunnet_sched_queue_packets",
            "Queued packets in flow scheduler"
        );
        describe_gauge!("tunnet_sched_queue_bytes", "Queued bytes in flow scheduler");
        describe_gauge!("tunnet_sched_active_flows", "Active flows in scheduler");

        let m = Self::from_handle(handle.clone());
        // Periodic flush of task-local hot counters + prometheus upkeep.
        let flush = m.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                flush.flush_hot();
                handle.run_upkeep();
            }
        });

        Ok(m)
    }

    fn flush_hot(&self) {
        let p_out = self.hot.packets_out.swap(0, Ordering::Relaxed);
        let b_out = self.hot.bytes_out.swap(0, Ordering::Relaxed);
        let p_in = self.hot.packets_in.swap(0, Ordering::Relaxed);
        let b_in = self.hot.bytes_in.swap(0, Ordering::Relaxed);
        if p_out > 0 {
            self.packets_out.increment(p_out);
        }
        if b_out > 0 {
            self.bytes_out.increment(b_out);
        }
        if p_in > 0 {
            self.packets_in.increment(p_in);
        }
        if b_in > 0 {
            self.bytes_in.increment(b_in);
        }
    }

    pub fn packets_inc(&self, direction: &'static str) {
        match direction {
            "out" => self.hot.packets_out.fetch_add(1, Ordering::Relaxed),
            "in" => self.hot.packets_in.fetch_add(1, Ordering::Relaxed),
            _ => {
                counter!("tunnet_packets_total", "direction" => direction).increment(1);
                0
            }
        };
    }

    pub fn bytes_add(&self, direction: &'static str, n: u64) {
        match direction {
            "out" => self.hot.bytes_out.fetch_add(n, Ordering::Relaxed),
            "in" => self.hot.bytes_in.fetch_add(n, Ordering::Relaxed),
            _ => {
                counter!("tunnet_bytes_total", "direction" => direction).increment(n);
                0
            }
        };
    }

    pub fn dropped_inc(&self, reason: &'static str) {
        self.hot.drops.fetch_add(1, Ordering::Relaxed);
        counter!("tunnet_dropped_packets_total", "reason" => reason).increment(1);
    }

    /// Scheduler drop with a dedicated per-reason counter (cached path).
    pub fn sched_drop_inc(&self, reason: &'static str) {
        counter!("tunnet_sched_drops_total", "reason" => reason).increment(1);
    }

    pub fn sched_queue_set(&self, packets: u64, bytes: u64, flows: u64) {
        self.sched_queue_packets.set(packets as f64);
        self.sched_queue_bytes.set(bytes as f64);
        self.sched_active_flows.set(flows as f64);
    }

    pub fn sched_transport_full_inc(&self) {
        self.sched_transport_full.increment(1);
    }

    pub fn active_conns_inc(&self) {
        self.active_conns.increment(1.0);
    }

    pub fn active_conns_dec(&self) {
        self.active_conns.decrement(1.0);
    }

    pub fn render(&self) -> String {
        self.handle.render()
    }
}

pub fn metrics_port(bind: &str) -> &str {
    bind.rsplit(':').next().unwrap_or("9100")
}

/// Listen on localhost and the assigned overlay IP so peers can scrape via VPN.
pub fn spawn_listeners(metrics: AgentMetrics, metrics_bind: &str, overlay_ip: std::net::Ipv4Addr) {
    let port = metrics_port(metrics_bind);
    for bind in [
        format!("127.0.0.1:{}", port),
        format!("{}:{}", overlay_ip, port),
    ] {
        let m = metrics.clone();
        tokio::spawn(async move { serve_metrics(m, bind).await });
    }
}

pub async fn serve_metrics(metrics: AgentMetrics, bind: String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!(?e, "failed to bind metrics endpoint");
            return;
        }
    };
    tracing::info!(%bind, "metrics endpoint listening");
    loop {
        let Ok((mut sock, _)) = listener.accept().await else {
            continue;
        };
        let m = metrics.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await; // best-effort: read the request line
            let body = m.render();
            let resp = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/plain; version=0.0.4\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = sock.write_all(resp.as_bytes()).await;
        });
    }
}
