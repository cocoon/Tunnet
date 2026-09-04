use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Context;
use bytes::Bytes;
use futures_util::FutureExt as _;
use iroh::endpoint::Connection;
use tun_rs::{AsyncDevice, DeviceBuilder};
use tunnet_common::packet::{self, LogicalPacket};
use tunnet_common::policy::Direction;
use tunnet_core::direct::{SpoofTracker, source_matches_peer};
use tunnet_core::peers::{PeerFastState, PeerIdentity, PeerRegistry};
use tunnet_core::policy_runtime::{PolicyRuntime, PolicyVerdict};
use tunnet_core::routing::{RouteDecision, RoutingTable};
use tunnet_core::{AclEngine, ConnPool, iroh_pool::send_datagram};
use uuid::Uuid;

use crate::actors::dataplane::PublishedPlane;
use crate::metrics::AgentMetrics;
use crate::pump::ensure_pump;
use crate::ssh_nat;
use crate::tun_fast;

/// Opportunistic inbound drain budget (§10): after each awaited datagram,
/// drain already-ready datagrams without busy-polling.
pub const INBOUND_DRAIN_BUDGET: usize = 32;

pub fn build_tun(
    ifname: &str,
    ipv4: std::net::Ipv4Addr,
    prefix: u8,
    mtu: u16,
) -> anyhow::Result<AsyncDevice> {
    // Fast-path builder: Linux enables offload; Windows uses the Wintun ring.
    let builder = DeviceBuilder::new()
        .name(ifname)
        .ipv4(ipv4, prefix, None)
        .mtu(mtu);
    #[cfg(target_os = "linux")]
    let builder = builder.offload(true);
    #[cfg(windows)]
    let builder = {
        let path = crate::wintun::materialize()?;
        builder
            .wintun_file(path.display().to_string())
            .wintun_log(true)
    };
    let dev = builder.build_async().context("build_async TUN device")?;
    tracing::info!(%ipv4, prefix, mtu, "TUN device up (fast path)");
    Ok(dev)
}

pub struct OutboundDeps {
    pub tun: Arc<AsyncDevice>,
    pub routes: RoutingTable,
    pub pool: ConnPool,
    pub runtime: PolicyRuntime,
    pub metrics: AgentMetrics,
    pub bufs: Arc<tunnet_common::packet::PacketPool>,
    pub meter: tunnet_core::CloudRelayMeter,
    pub mtu: u16,
}

/// Handle one owned logical packet through the outbound pipeline.
/// Parse-once: `packet` already carries metadata; NAT refreshes it only when
/// a rewrite actually mutated the bytes. Policy uses the shared runtime with
/// the peer's pre-resolved firewall set — no per-packet map lookups.
fn handle_outbound_one(
    mut packet: LogicalPacket,
    fast_ctx: &OutboundCtx<'_>,
) -> Option<Arc<PeerFastState>> {
    let ctx = *fast_ctx;
    let OutboundCtx {
        routes,
        runtime,
        metrics,
        pool,
        bufs,
        meter,
        self_ip,
        ..
    } = ctx;
    // SSH NAT consumes existing metadata (no second parse).
    let meta = packet.meta;
    let Some(bytes) = packet_owner_bytes_mut(&mut packet, bufs) else {
        metrics.dropped_inc("nat_materialize");
        return None;
    };
    if ssh_nat::rewrite_outbound_with_meta(bytes, &meta, self_ip) {
        // Rare (SSH-port traffic only): refresh metadata after mutation.
        if !packet.refresh() {
            metrics.dropped_inc("nat_reparse");
            return None;
        }
    }
    let Some(dst) = packet.meta.dst_v4 else {
        metrics.dropped_inc("ipv6_unsupported");
        return None;
    };

    // Single immutable-snapshot route decision; the handle carries the
    // stable fast state (no peer map lookup after routing).
    let fast = match routes.route_once(&dst) {
        RouteDecision::LocalMagic => {
            metrics.dropped_inc("magic_dns_local");
            return None;
        }
        RouteDecision::LocalAdvertised => {
            metrics.dropped_inc("local_subnet");
            return None;
        }
        RouteDecision::NoRoute => {
            metrics.dropped_inc("no_route");
            return None;
        }
        RouteDecision::Peer(h) => h.peer.fast.clone(),
    };

    if fast.identity.read().ip == self_ip {
        metrics.dropped_inc("self");
        return None;
    }

    // One compiled verdict against the shared runtime. Guards are not held
    // across calls: snapshot the Arcs (cheap clones, no strings).
    let ident: Arc<PeerIdentity> = fast.identity.read().clone();
    let (fw, counters) = {
        let link = fast.policy.load();
        (link.fw.clone(), link.counters.clone())
    };
    let verdict = runtime.check(
        &packet.meta,
        Direction::Outbound,
        &ident.endpoint_hex,
        &ident.tags,
        Some(ident.hostname.as_str()),
        Some(ident.network_id),
        &fw,
        &counters,
    );
    match verdict {
        PolicyVerdict::Allow => {}
        PolicyVerdict::Deny => {
            metrics.dropped_inc("policy_deny");
            return None;
        }
        PolicyVerdict::Reject => {
            metrics.dropped_inc("fw_reject_out");
            send_reject_reply(fast_ctx, &packet);
            return None;
        }
    }

    let len = packet.len() as i64;
    let dropped = {
        let mut sched = fast.scheduler.lock();
        sched.enqueue(packet, std::time::Instant::now())
    };
    if let Some(reason) = dropped {
        metrics.dropped_inc(reason.as_str());
        metrics.sched_drop_inc(reason.as_str());
        return None;
    }
    metrics.queue_add(1, len, 0);
    ensure_pump(
        &fast,
        pool.clone(),
        metrics.clone(),
        bufs.clone(),
        meter.clone(),
    );
    Some(fast)
}

/// Mutable packet bytes for NAT, materializing pooled/shared storage.
/// Returns None only when materialization fails (counts as drop).
fn packet_owner_bytes_mut<'a>(
    packet: &'a mut LogicalPacket,
    pool: &Arc<tunnet_common::packet::PacketPool>,
) -> Option<&'a mut [u8]> {
    if matches!(packet.owner, tunnet_common::packet::PacketOwner::Shared(_))
        && !packet.materialize(pool)
    {
        return None;
    }
    match &mut packet.owner {
        tunnet_common::packet::PacketOwner::Pooled(b) => {
            let len = b.len();
            Some(&mut b.recv_region(len)[..len])
        }
        tunnet_common::packet::PacketOwner::Shared(_) => None,
    }
}

struct OutboundCtx<'a> {
    tun: &'a Arc<AsyncDevice>,
    routes: &'a RoutingTable,
    runtime: &'a PolicyRuntime,
    metrics: &'a AgentMetrics,
    pool: &'a ConnPool,
    bufs: &'a Arc<tunnet_common::packet::PacketPool>,
    meter: &'a tunnet_core::CloudRelayMeter,
    self_ip: std::net::Ipv4Addr,
}

impl Copy for OutboundCtx<'_> {}
impl Clone for OutboundCtx<'_> {
    fn clone(&self) -> Self {
        *self
    }
}

/// Reject replies are rare: synthesize and send off the hot path with
/// correct platform framing.
fn send_reject_reply(ctx: &OutboundCtx<'_>, packet: &LogicalPacket) {
    let reply = packet::parse(packet.owner.as_bytes())
        .ok()
        .and_then(|p| packet::synthesize_reject(&p));
    let Some(reply) = reply.filter(|r| !r.is_empty()) else {
        return;
    };
    #[cfg(target_os = "linux")]
    {
        let tun = ctx.tun.clone();
        let bufs = ctx.bufs.clone();
        tokio::spawn(async move {
            let mut w = tun_fast::LinuxTunBatchWriter::new(bufs);
            w.push(&reply);
            let _ = w.flush(&tun).await;
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let tun = ctx.tun.clone();
        tokio::spawn(async move {
            let _ = tun.send(&reply).await;
        });
    }
}

pub async fn run_outbound(deps: OutboundDeps) -> anyhow::Result<()> {
    let OutboundDeps {
        tun,
        routes,
        pool,
        runtime,
        metrics,
        bufs,
        meter,
        mtu,
    } = deps;
    // Cache pool hit/miss telemetry periodically (cheap atomics).
    let metrics_pool = metrics.clone();
    let bufs_pool = bufs.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            let (h, m) = bufs_pool.hit_miss();
            metrics_pool.pool_hit_miss(h, m);
        }
    });

    let self_ip = runtime.self_ip();
    metrics.mtu_set(mtu as u64);

    #[cfg(target_os = "linux")]
    let mut batch = tun_fast::LinuxBatchEngine::new(bufs.clone(), mtu as usize);

    tracing::info!("outbound TUN→iroh v2 loop started");
    loop {
        #[cfg(target_os = "linux")]
        {
            let packets = batch.recv_batch(&tun).await?;
            metrics.tun_syscall_inc("recv_batch");
            if packets.is_empty() {
                continue;
            }
            let ctx = OutboundCtx {
                tun: &tun,
                routes: &routes,
                runtime: &runtime,
                metrics: &metrics,
                pool: &pool,
                bufs: &bufs,
                meter: &meter,
                self_ip,
            };
            for packet in packets {
                if packet.len() > mtu as usize {
                    metrics.dropped_inc("oversize_mtu");
                    continue;
                }
                handle_outbound_one(packet, &ctx);
            }
            continue;
        }

        #[allow(unreachable_code)]
        {
            // Windows + fallback: burst-drain the ring into pooled buffers.
            let burst =
                tun_fast::windows_recv_burst(&tun, &bufs, mtu as usize, tun_fast::BURST_BUDGET)
                    .await?;
            metrics.tun_syscall_inc("recv_burst");
            if burst.is_empty() {
                continue;
            }
            let ctx = OutboundCtx {
                tun: &tun,
                routes: &routes,
                runtime: &runtime,
                metrics: &metrics,
                pool: &pool,
                bufs: &bufs,
                meter: &meter,
                self_ip,
            };
            for packet in burst {
                if packet.len() > mtu as usize {
                    metrics.dropped_inc("oversize_mtu");
                    continue;
                }
                handle_outbound_one(packet, &ctx);
            }
        }
    }
}

pub struct InboundDeps {
    pub conn: Connection,
    pub tun: PublishedPlane,
    pub routes: RoutingTable,
    pub runtime: PolicyRuntime,
    pub acl: AclEngine,
    pub spoofs: HashMap<Uuid, SpoofTracker>,
    pub pool: Option<ConnPool>,
    pub bufs: Arc<tunnet_common::packet::PacketPool>,
    pub metrics: AgentMetrics,
}

pub async fn serve_tunnel_connection(deps: InboundDeps) {
    let InboundDeps {
        conn,
        tun,
        routes,
        runtime,
        acl,
        spoofs,
        pool,
        bufs,
        metrics,
    } = deps;
    let remote_id = conn.remote_id();
    let remote_hex = format!("{remote_id}");
    if !acl.allow_inbound_peer(&remote_hex) {
        tracing::warn!(%remote_id, "policy denied inbound peer");
        conn.close(1u32.into(), b"policy_deny");
        return;
    }
    tracing::info!(%remote_id, "peer connected");
    metrics.active_conns_inc();
    if let Some(p) = &pool {
        p.touch_peer(remote_id);
        if !p.adopt(remote_id, conn.clone()).await {
            tracing::debug!(%remote_id, "ingress conn lost tie-break; exiting reader");
            metrics.active_conns_dec();
            return;
        }
        if let Some(max) = conn.max_datagram_size() {
            tracing::debug!(%remote_id, max_datagram_size = max, "quic datagram limit");
        }
    }
    // Resolve the stable fast state once (§12); re-resolve only when the
    // routing generation changes. Per-datagram work uses the cached Arc.
    let registry = routes.peer_registry().clone();
    let mut fast_state = match resolve_fast(&registry, &routes, &remote_id) {
        Some(fast) => fast,
        None => {
            tracing::debug!(%remote_id, "unknown peer at admission; closing");
            conn.close(1u32.into(), b"no_route");
            metrics.active_conns_dec();
            return;
        }
    };
    let mut route_gen = routes.version();

    // Load the published generation once (device + cancel token pinned).
    let Some(plane) = tun.load_full() else {
        metrics.active_conns_dec();
        return;
    };
    let device = plane.device.clone();
    let generation_cancel = plane.cancel.clone();
    tracing::debug!(generation = plane.generation, %remote_id, "ingress reader pinned");

    #[cfg(target_os = "linux")]
    let mut tun_batch = tun_fast::LinuxTunBatchWriter::new(bufs.clone());
    #[cfg(not(target_os = "linux"))]
    let mut tun_batch = tun_fast::TunWriteBatch::new();

    loop {
        if generation_cancel.is_cancelled() {
            break;
        }
        // Await one datagram (cancellation-first), then opportunistically
        // drain already-ready datagrams up to a bounded budget (§10).
        let first = tokio::select! {
            biased;
            _ = generation_cancel.cancelled() => break,
            res = conn.read_datagram() => match res {
                Ok(dg) => dg,
                Err(e) => {
                    tracing::debug!(?e, "read_datagram closed");
                    break;
                }
            },
        };
        if generation_cancel.is_cancelled() {
            break;
        }
        if let Some(p) = &pool {
            p.touch_peer(remote_id);
        }
        metrics.datagram_inc("in");
        let mut batch: Vec<Bytes> = vec![first];
        // Opportunistic drain: ReadDatagram::poll serves buffered datagrams
        // synchronously first, so polling a fresh future once is a safe
        // non-waiting drain probe (dropping a Pending future only drops its
        // waker registration; no shared state is disturbed).
        for _ in 0..INBOUND_DRAIN_BUDGET {
            match conn.read_datagram().now_or_never() {
                Some(Ok(dg)) => {
                    metrics.datagram_inc("in");
                    batch.push(dg);
                }
                _ => break,
            }
        }
        if generation_cancel.is_cancelled() {
            break;
        }
        // Routing generation check (one atomic load per batch): re-resolve
        // the cached fast state when membership changed.
        let route_version = routes.version();
        if route_version != route_gen {
            route_gen = route_version;
            if let Some(next) = resolve_fast(&registry, &routes, &remote_id) {
                fast_state = next;
            }
        }
        let self_ip = runtime.self_ip();
        let mut tun_pending: u32 = 0;
        for dg in batch {
            if handle_inbound_one(
                &dg,
                &fast_state,
                &runtime,
                &spoofs,
                &conn,
                &bufs,
                &metrics,
                &mut tun_batch,
                self_ip,
            )
            .await
            {
                tun_pending += 1;
            }
            // Flush mid-iteration so bursts larger than the batch still
            // complete without loss (§9); the tail stays staged on failure.
            if tun_pending >= tun_fast::TUN_WRITE_BATCH as u32 {
                if !flush_tun_batch(&mut tun_batch, &device, &metrics).await {
                    break;
                }
                tun_pending = 0;
            }
        }
        // Flush the TUN batch once per drain iteration (§9).
        if tun_pending > 0 && !flush_tun_batch(&mut tun_batch, &device, &metrics).await {
            break;
        }
    }
    metrics.active_conns_dec();
    tracing::info!(%remote_id, "peer disconnected");
}

/// Slow-path resolve: registry first, else build from route info.
fn resolve_fast(
    registry: &PeerRegistry,
    routes: &RoutingTable,
    remote: &iroh::EndpointId,
) -> Option<Arc<PeerFastState>> {
    if let Some(fast) = registry.get(*remote) {
        return Some(fast);
    }
    // First packet after a rebuild race: construct from route info.
    let info = routes.lookup_endpoint(&format!("{remote}"))?;
    Some(registry.ensure(Arc::new(tunnet_core::peers::PeerIdentity {
        endpoint: info.endpoint,
        endpoint_hex: info.endpoint_hex.clone(),
        hostname: info.hostname.clone(),
        ip: info.ip,
        tags: info.tags.clone(),
        network_id: info.network_id,
        network_name: info.network_name.clone(),
    })))
}

/// Handle one inbound DATAGRAM: decode → reassemble → parse → antispoof →
/// policy → NAT → stage for the TUN batch. Returns true when a TUN packet
/// was staged.
#[allow(clippy::too_many_arguments)]
async fn handle_inbound_one(
    dg: &Bytes,
    fast: &Arc<PeerFastState>,
    runtime: &PolicyRuntime,
    spoofs: &HashMap<Uuid, SpoofTracker>,
    conn: &Connection,
    pool_bufs: &Arc<tunnet_common::packet::PacketPool>,
    metrics: &AgentMetrics,
    tun_batch: &mut TunBatchForPlatform,
    self_ip: std::net::Ipv4Addr,
) -> bool {
    use tunnet_core::reassembly::InsertOut;
    let now = std::time::Instant::now();
    // v2 framing first (§5: framing never bypasses policy).
    let frame = match tunnet_common::packet::decode(dg) {
        Ok(f) => f,
        Err(_) => {
            metrics.dropped_inc("malformed_frame");
            metrics.reassembly_inc("malformed");
            return false;
        }
    };
    let logical: LogicalPacket = match frame {
        tunnet_common::packet::Frame::Single(p) => {
            // Zero-copy: retain the DATAGRAM's storage.
            let off = p.as_ptr() as usize - dg.as_ptr() as usize;
            let owned = dg.slice(off..off + p.len());
            match LogicalPacket::from_shared(owned) {
                Some(pkt) => {
                    metrics.reassembly_inc("single");
                    pkt
                }
                None => {
                    metrics.dropped_inc("malformed_transport");
                    return false;
                }
            }
        }
        tunnet_common::packet::Frame::Segment(h, payload) => {
            let off = payload.as_ptr() as usize - dg.as_ptr() as usize;
            let owned = dg.slice(off..off + payload.len());
            let mut table = fast.reassembly.lock();
            match table.insert(h, owned, now) {
                InsertOut::Complete(logical) => {
                    metrics.reassembly_inc("complete");
                    match LogicalPacket::from_vec(logical) {
                        Some(pkt) => pkt,
                        None => {
                            metrics.dropped_inc("malformed_transport");
                            return false;
                        }
                    }
                }
                InsertOut::Pending => {
                    metrics.reassembly_inc("pending");
                    return false;
                }
                InsertOut::Duplicate => {
                    metrics.reassembly_inc("duplicate");
                    return false;
                }
                InsertOut::Dropped(reason) => {
                    metrics.reassembly_inc("dropped");
                    metrics.dropped_inc(match reason {
                        tunnet_core::reassembly::ReassemblyDrop::Conflict => "reasm_conflict",
                        tunnet_core::reassembly::ReassemblyDrop::OverBytes => "reasm_bytes",
                        tunnet_core::reassembly::ReassemblyDrop::TooManyEntries => "reasm_entries",
                        _ => "reasm_malformed",
                    });
                    return false;
                }
            }
        }
    };
    // Anti-spoof against the connection's stable identity (exact match).
    let Some(src) = logical.meta.src_v4 else {
        metrics.dropped_inc("ipv6_unsupported_in");
        return false;
    };
    let ident: Arc<PeerIdentity> = fast.identity.read().clone();
    if !source_matches_peer(src, ident.ip) {
        metrics.dropped_inc("antispoof");
        if let Some(tracker) = spoofs.get(&ident.network_id)
            && tracker.record(&ident.endpoint_hex)
        {
            for (peer, n) in tracker.drain_window_counts() {
                tracing::warn!(
                    peer = %peer,
                    spoofed_packets = n,
                    "ingress anti-spoof drops in last window"
                );
            }
        }
        return false;
    }
    // Snapshot the policy link Arcs (guards are not Send; Arcs are).
    let (fw, counters) = {
        let link = fast.policy.load();
        (link.fw.clone(), link.counters.clone())
    };
    let verdict = runtime.check(
        &logical.meta,
        Direction::Inbound,
        &ident.endpoint_hex,
        &ident.tags,
        Some(ident.hostname.as_str()),
        Some(ident.network_id),
        &fw,
        &counters,
    );
    match verdict {
        PolicyVerdict::Allow => {}
        PolicyVerdict::Deny => {
            metrics.dropped_inc("policy_deny_in");
            return false;
        }
        PolicyVerdict::Reject => {
            metrics.dropped_inc("fw_reject_in");
            let reply = packet::parse(logical.owner.as_bytes())
                .ok()
                .and_then(|p| packet::synthesize_reject(&p));
            if let Some(reply) = reply.filter(|r| !r.is_empty()) {
                let _ = send_datagram(conn, reply).await;
            }
            return false;
        }
    }
    // Inbound SSH-NAT consumes parsed metadata (no second parse); shared
    // storage materializes only when a rewrite actually applies.
    let mut logical = logical;
    if ssh_nat::needs_inbound_rewrite_with_meta(&logical.meta, self_ip) {
        if !logical.materialize(pool_bufs) {
            metrics.dropped_inc("nat_materialize");
            return false;
        }
        // PacketMeta is Copy: snapshot before the mutable borrow.
        let meta = logical.meta;
        let Some(region) = packet_owner_bytes_mut(&mut logical, pool_bufs) else {
            metrics.dropped_inc("nat_materialize");
            return false;
        };
        ssh_nat::rewrite_inbound_with_meta(region, &meta, self_ip);
    }
    let n = logical.len() as u64;
    stage_tun_packet(tun_batch, logical, metrics);
    fast.record_rx(n);
    metrics.packets_inc("in");
    metrics.bytes_add("in", n);
    true
}

#[cfg(target_os = "linux")]
type TunBatchForPlatform = tun_fast::LinuxTunBatchWriter;
#[cfg(not(target_os = "linux"))]
type TunBatchForPlatform = tun_fast::TunWriteBatch;

/// Flush the staged TUN batch. Returns false when the reader should stop
/// (device error); on temporary backpressure the tail stays staged for the
/// next iteration — never silently dropped.
async fn flush_tun_batch(
    batch: &mut TunBatchForPlatform,
    device: &Arc<AsyncDevice>,
    metrics: &AgentMetrics,
) -> bool {
    #[cfg(target_os = "linux")]
    {
        if batch.is_empty() {
            return true;
        }
        metrics.tun_syscall_inc("send_batch");
        match batch.flush(device).await {
            Ok(_) => true,
            Err(e) => {
                tracing::warn!(?e, "tun batch send failed");
                metrics.dropped_inc("tun_send_failed");
                false
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        if batch.is_empty() {
            return true;
        }
        metrics.tun_syscall_inc("send_burst");
        match batch.drain_or_wait(device).await {
            Ok(_) => true,
            Err(e) => {
                tracing::warn!(?e, "tun burst send failed");
                metrics.dropped_inc("tun_send_failed");
                false
            }
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn stage_tun_packet(
    batch: &mut TunBatchForPlatform,
    packet: LogicalPacket,
    _metrics: &AgentMetrics,
) {
    let bytes = match packet.owner {
        tunnet_common::packet::PacketOwner::Shared(b) => b,
        tunnet_common::packet::PacketOwner::Pooled(b) => Bytes::from_owner(b),
    };
    batch.push(bytes);
}

#[cfg(target_os = "linux")]
fn stage_tun_packet(
    batch: &mut TunBatchForPlatform,
    packet: LogicalPacket,
    _metrics: &AgentMetrics,
) {
    batch.push(packet.owner.as_bytes());
}
