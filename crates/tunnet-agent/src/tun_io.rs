use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Context;
use iroh::endpoint::Connection;
use tun_rs::{AsyncDevice, DeviceBuilder};
use tunnet_common::packet::{self, PacketBuf, synthesize_reject};
use tunnet_common::policy::Direction;
use tunnet_core::direct::{AuthCache, FirewallEngine, SpoofTracker, source_matches_peer};
use tunnet_core::policy_fast::{self, PolicyVerdict};
use tunnet_core::routing::RouteDecision;
use tunnet_core::{AclEngine, ConnPool, RoutingTable, iroh_pool::send_datagram};
use uuid::Uuid;

use crate::actors::dataplane::PublishedPlane;
use crate::metrics::AgentMetrics;
use crate::qos::OutboundScheduler;
use crate::ssh_nat;
use crate::tun_fast;

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
    pub acl: AclEngine,
    pub firewalls: HashMap<Uuid, FirewallEngine>,
    pub metrics: AgentMetrics,
    pub mtu: u16,
}

/// Handle one owned packet through the full outbound pipeline.
/// Parse-once: `packet` already carries metadata; NAT refreshes it only when
/// a rewrite actually mutated the bytes.
fn handle_outbound_one(
    mut packet: PacketBuf,
    self_ip: std::net::Ipv4Addr,
    routes: &RoutingTable,
    policy: &tunnet_core::policy_fast::PacketPolicy,
    scheduler: &OutboundScheduler,
    tun: &Arc<AsyncDevice>,
    metrics: &AgentMetrics,
) {
    // SSH NAT consumes existing metadata (no second parse).
    if ssh_nat::rewrite_outbound_with_meta(&mut packet.data, &packet.meta, self_ip) {
        // Rare (SSH-port traffic only): refresh metadata after mutation.
        let Ok(pkt) = packet::parse(&packet.data) else {
            metrics.dropped_inc("nat_reparse");
            return;
        };
        packet.meta = tunnet_common::packet::PacketMeta::from_packet(&pkt);
        packet.flow = tunnet_common::packet::FlowKey::for_packet(&pkt);
    }
    let Some(dst) = packet.meta.dst_v4 else {
        metrics.dropped_inc("ipv6_unsupported");
        return;
    };

    // Single immutable-snapshot route decision (one load, no string keys).
    let peer = match routes.route_once(&dst) {
        RouteDecision::LocalMagic => {
            metrics.dropped_inc("magic_dns_local");
            return;
        }
        RouteDecision::LocalAdvertised => {
            metrics.dropped_inc("local_subnet");
            return;
        }
        RouteDecision::NoRoute => {
            metrics.dropped_inc("no_route");
            return;
        }
        RouteDecision::Peer(h) => h,
    };

    if peer.peer.ip == self_ip {
        metrics.dropped_inc("self");
        return;
    }

    // One compiled policy verdict (one conntrack, fragment slow path only
    // for fragments, no allocation/sort/format in the hot path).
    match policy.check(
        &packet.meta,
        Direction::Outbound,
        &peer.peer.endpoint_hex,
        &peer.peer.tags,
        Some(peer.peer.hostname.as_str()),
        Some(peer.peer.network_id),
    ) {
        PolicyVerdict::Allow => {}
        PolicyVerdict::Deny => {
            metrics.dropped_inc("policy_deny");
            return;
        }
        PolicyVerdict::Reject => {
            metrics.dropped_inc("fw_reject_out");
            let reply = packet::parse(&packet.data)
                .ok()
                .and_then(|p| synthesize_reject(&p));
            if let Some(reply) = reply
                && !reply.is_empty()
            {
                let tun = tun.clone();
                tokio::spawn(async move {
                    let _ = tun.send(&reply).await;
                });
            }
            return;
        }
    }

    scheduler.enqueue(peer.endpoint, packet);
}

pub async fn run_outbound(deps: OutboundDeps) -> anyhow::Result<()> {
    let OutboundDeps {
        tun,
        routes,
        pool,
        acl,
        firewalls,
        metrics,
        mtu,
    } = deps;

    let scheduler = OutboundScheduler::new(pool.clone(), metrics.clone(), mtu);
    // Compiled once; resynced amortized (every 256 packets) from live engines.
    let policy = policy_fast::from_engines(&acl, &firewalls, None);

    let mut self_ip = acl.self_id.load().ip;
    let mut since_sync: u32 = 0;

    #[cfg(target_os = "linux")]
    let mut batch = tun_fast::LinuxBatchEngine::new();

    tracing::info!("outbound TUN→iroh flow-scheduler loop started");
    loop {
        #[cfg(target_os = "linux")]
        {
            let packets = batch.recv_batch(&tun).await?;
            if packets.is_empty() {
                continue;
            }
            for packet in packets {
                if since_sync >= 256 {
                    policy.sync_from_engines(&acl, &firewalls);
                    self_ip = acl.self_id.load().ip;
                    since_sync = 0;
                }
                since_sync += 1;
                handle_outbound_one(
                    packet, self_ip, &routes, &policy, &scheduler, &tun, &metrics,
                );
            }
            continue;
        }

        #[allow(unreachable_code)]
        {
            // Windows + fallback: burst-drain the Wintun ring. One async
            // recv waits only when the ring is actually empty; the rest of
            // the burst is non-blocking try_recv.
            let mut slot = vec![0u8; tun_fast::SLOT_CAP];
            let burst =
                tun_fast::windows_recv_burst(&tun, tun_fast::BURST_BUDGET, &mut slot).await?;
            if burst.is_empty() {
                continue;
            }
            for packet in burst {
                if since_sync >= 256 {
                    policy.sync_from_engines(&acl, &firewalls);
                    self_ip = acl.self_id.load().ip;
                    since_sync = 0;
                }
                since_sync += 1;
                handle_outbound_one(
                    packet, self_ip, &routes, &policy, &scheduler, &tun, &metrics,
                );
            }
        }
    }
}

pub struct InboundDeps {
    pub conn: Connection,
    pub tun: PublishedPlane,
    pub routes: RoutingTable,
    pub acl: AclEngine,
    pub firewalls: HashMap<Uuid, FirewallEngine>,
    pub spoofs: HashMap<Uuid, SpoofTracker>,
    pub pool: Option<ConnPool>,
    pub metrics: AgentMetrics,
    pub direct_auth: Option<AuthCache>,
}

pub async fn serve_tunnel_connection(deps: InboundDeps) {
    let InboundDeps {
        conn,
        tun,
        routes,
        acl,
        firewalls,
        spoofs,
        pool,
        metrics,
        direct_auth,
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
    let inbound_network = direct_auth
        .as_ref()
        .and_then(|a| a.networks_for(&remote_hex).into_iter().next())
        .or_else(|| routes.lookup_endpoint(&remote_hex).map(|p| p.network_id));
    let policy = policy_fast::from_engines(&acl, &firewalls, None);

    // Load the published generation once. Retain the device + its exact
    // cancellation token; never reacquire a global lock per packet and never
    // observe a newer generation.
    let Some(plane) = tun.load_full() else {
        return;
    };
    let device = plane.device.clone();
    let generation_cancel = plane.cancel.clone();
    // Pinned at reader start: this task never observes a newer generation.
    tracing::debug!(generation = plane.generation, %remote_id, "ingress reader pinned");

    let mut since_sync: u32 = 0;
    // Linux inbound writes go through the GSO-aware writer (one reused GRO
    // table per reader task); see `tun_fast::LinuxTunWriter`.
    #[cfg(target_os = "linux")]
    let mut linux_writer = tun_fast::LinuxTunWriter::default();
    loop {
        if generation_cancel.is_cancelled() {
            break;
        }
        // Cancellation first so BringDown promptly stops old readers.
        let dg = tokio::select! {
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
        {
            if since_sync >= 256 {
                policy.sync_from_engines(&acl, &firewalls);
                since_sync = 0;
            }
            since_sync += 1;
            #[allow(clippy::collapsible_if)]
            if let Some(p) = &pool {
                p.touch_peer(remote_id);
            }

            // Parse once into an owned packet; metadata rides along.
            let Some(mut packet) = PacketBuf::from_slice(&dg) else {
                metrics.dropped_inc("malformed_transport");
                continue;
            };
            let Some(src) = packet.meta.src_v4 else {
                metrics.dropped_inc("ipv6_unsupported_in");
                continue;
            };

            let peer_info = inbound_network
                .and_then(|nid| routes.lookup_network_ip(nid, &src))
                .or_else(|| routes.lookup_endpoint(&remote_hex));

            if let Some(peer_info) = &peer_info
                && !source_matches_peer(src, peer_info.ip)
            {
                metrics.dropped_inc("antispoof");
                if let Some(nid) = inbound_network.or(Some(peer_info.network_id))
                    && let Some(tracker) = spoofs.get(&nid)
                    && tracker.record(&remote_hex)
                {
                    let counts = tracker.drain_window_counts();
                    for (peer, n) in counts {
                        tracing::warn!(
                            peer = %peer,
                            spoofed_packets = n,
                            "ingress anti-spoof drops in last window"
                        );
                    }
                }
                continue;
            }

            let empty_tags: Vec<String> = Vec::new();
            let peer_tags: &[String] = peer_info
                .as_ref()
                .map(|p| p.tags.as_slice())
                .unwrap_or(&empty_tags);
            match policy.check(
                &packet.meta,
                Direction::Inbound,
                &remote_hex,
                peer_tags,
                peer_info.as_ref().map(|p| p.hostname.as_str()),
                peer_info.as_ref().map(|p| p.network_id).or(inbound_network),
            ) {
                PolicyVerdict::Allow => {}
                PolicyVerdict::Deny => {
                    metrics.dropped_inc("policy_deny_in");
                    continue;
                }
                PolicyVerdict::Reject => {
                    metrics.dropped_inc("fw_reject_in");
                    let reply = packet::parse(&packet.data)
                        .ok()
                        .and_then(|p| synthesize_reject(&p));
                    if let Some(reply) = reply
                        && !reply.is_empty()
                    {
                        let _ = send_datagram(&conn, reply).await;
                    }
                    continue;
                }
            }

            let n = packet.data.len() as u64;
            let self_ip = acl.self_id.load().ip;
            // Generation already verified: device + token belong to the
            // generation loaded at reader start. Recheck cancellation
            // (not a lock) before the send so BringDown wins races.
            if generation_cancel.is_cancelled() {
                break;
            }
            // Inbound SSH-NAT consumes parsed metadata (no second parse).
            // The rewrite check avoids touching (and re-checksumming) the
            // 99%+ of packets that are not SSH-port traffic.
            if ssh_nat::needs_inbound_rewrite_with_meta(&packet.meta, self_ip) {
                ssh_nat::rewrite_inbound_with_meta(&mut packet.data, &packet.meta, self_ip);
            }
            // Platform write: Wintun burst-fill, GSO-aware batch write, or
            // plain send — waiting only when the ring is actually full.
            #[cfg(windows)]
            let send_result = tun_fast::windows_send_burst(&device, &[&packet.data]).await;
            #[cfg(target_os = "linux")]
            let send_result = linux_writer.send(&device, &packet.data).await;
            #[cfg(not(any(windows, target_os = "linux")))]
            let send_result = device.send(&packet.data).await;
            if let Err(e) = send_result {
                tracing::warn!(?e, "tun send failed");
                metrics.dropped_inc("tun_send_failed");
                break;
            }
            metrics.packets_inc("in");
            metrics.bytes_add("in", n);
            if let Some(p) = &pool {
                p.record_bytes_in(remote_id, n);
            }
        }
    }
    metrics.active_conns_dec();
    tracing::info!(%remote_id, "peer disconnected");
}
