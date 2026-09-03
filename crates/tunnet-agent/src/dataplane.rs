//! Hot-swappable TUN + outbound loop for data-plane up/down.

use std::net::Ipv4Addr;
use std::sync::Arc;

use ipnet::Ipv4Net;
use parking_lot::Mutex;
use tun_rs::AsyncDevice;
use tunnet_common::local_api::LocalEvent;
use tunnet_common::{DeviceProfile, DnsConfig};
use tunnet_core::local_api::dataplane::DataPlaneCmdRx;
use tunnet_core::local_api::{DataPlaneHandle, recv_cmd};
use tunnet_core::{AclEngine, ConnPool, CoreNode, RoutingTable};
use uuid::Uuid;

use crate::ingress::IngressRegistry;
use crate::metrics::AgentMetrics;
use crate::system_dns::DnsController;
use crate::system_routes::RouteReconciler;
use crate::tun_io::{build_tun, run_outbound};

pub struct TunSlotState {
    pub device: Option<Arc<AsyncDevice>>,
    pub generation: u64,
}

pub type TunSlot = Arc<tokio::sync::RwLock<TunSlotState>>;

pub struct DataPlaneConfig {
    pub ifname: String,
    pub assigned_ipv4: Ipv4Addr,
    pub prefix: u8,
    pub mtu: u16,
    pub dns_cfg: DnsConfig,
    pub dns: Option<Arc<DnsController>>,
    pub is_direct: bool,
    pub network_id: Uuid,
    pub underlay_hosts: Vec<Ipv4Addr>,
}

pub(crate) struct LivePlane {
    tun: Arc<AsyncDevice>,
    dns: Option<Arc<DnsController>>,
    outbound: tokio::task::JoinHandle<()>,
}

/// Inputs for [`spawn_controller`].
pub struct ControllerSpawn {
    pub handle: DataPlaneHandle,
    pub cmd_rx: DataPlaneCmdRx,
    pub tun_slot: TunSlot,
    pub node: CoreNode,
    pub metrics: AgentMetrics,
    pub cfg: DataPlaneConfig,
    pub peer_dns_active: Arc<std::sync::atomic::AtomicBool>,
    pub initial: LivePlane,
    pub ingress: IngressRegistry,
    pub events: tokio::sync::broadcast::Sender<LocalEvent>,
    pub routes: RouteReconciler,
}

/// Spawns the data-plane controller that listens for up/down IPC commands.
pub fn spawn_controller(spawn: ControllerSpawn) {
    let ControllerSpawn {
        handle,
        mut cmd_rx,
        tun_slot,
        node,
        metrics,
        cfg,
        peer_dns_active,
        initial,
        ingress,
        events,
        routes,
    } = spawn;
    let state = Arc::new(Mutex::new(Some(initial)));
    tokio::spawn(async move {
        while let Some((want_up, reply)) = recv_cmd(&mut cmd_rx).await {
            let result = if want_up {
                bring_up(
                    &handle,
                    &tun_slot,
                    &node,
                    &metrics,
                    &cfg,
                    &peer_dns_active,
                    &state,
                    &events,
                    &routes,
                )
                .await
            } else {
                bring_down(
                    &handle,
                    &tun_slot,
                    &cfg,
                    &peer_dns_active,
                    &state,
                    &ingress,
                    &node.tunnel_pool,
                    &events,
                    &routes,
                )
                .await
            };
            let _ = reply.send(result.map_err(|e| e.to_string()));
        }
    });
}

pub fn build_initial_plane(
    tun: Arc<AsyncDevice>,
    dns: Option<Arc<DnsController>>,
    outbound: tokio::task::JoinHandle<()>,
    node: &CoreNode,
    is_direct: bool,
    network_id: Uuid,
) -> LivePlane {
    let _ = (node, is_direct, network_id);
    LivePlane { tun, dns, outbound }
}

fn route_snapshot(
    node: &CoreNode,
    is_direct: bool,
    network_id: Uuid,
) -> (Vec<Ipv4Net>, DeviceProfile, bool) {
    if is_direct {
        return (vec![], DeviceProfile::default(), false);
    }
    if let Some(snap) = tunnet_core::state::load_snapshot_cache(&node.paths)
        && let Some(m) = snap.memberships.iter().find(|m| m.network_id == network_id)
    {
        let remote_subnets: Vec<Ipv4Net> = m
            .subnet_routes
            .iter()
            .filter(|r| r.via_endpoint_id != node.identity.endpoint_id_hex())
            .map(|r| r.cidr)
            .collect();
        let has_exit = m.device_profile.exit_node_endpoint_id.is_some();
        return (remote_subnets, m.device_profile.clone(), has_exit);
    }
    (vec![], DeviceProfile::default(), false)
}

#[allow(clippy::too_many_arguments)]
async fn bring_down(
    handle: &DataPlaneHandle,
    tun_slot: &TunSlot,
    cfg: &DataPlaneConfig,
    peer_dns_active: &std::sync::atomic::AtomicBool,
    state: &Mutex<Option<LivePlane>>,
    ingress: &IngressRegistry,
    tunnel_pool: &tunnet_core::ConnPool,
    events: &tokio::sync::broadcast::Sender<LocalEvent>,
    routes: &RouteReconciler,
) -> anyhow::Result<()> {
    if !handle.is_up() {
        return Ok(());
    }
    let Some(live) = state.lock().take() else {
        handle.set_up(false);
        return Ok(());
    };
    live.outbound.abort();
    ingress.abort_all();
    tunnel_pool.close_all().await;
    if let Err(e) = crate::system_routes::unapply(routes).await {
        tracing::warn!(error = %e, "route teardown failed");
    }
    crate::forward::teardown_exit_nat();
    // Explicit restoration is the normal lifecycle; osdns leaves externally
    // modified state untouched instead of overwriting it.
    if let Some(dns) = live.dns {
        let result = tokio::task::spawn_blocking(move || dns.restore()).await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::error!(error = %e, "PeerDNS restore failed"),
            Err(e) => tracing::warn!(error = %e, "PeerDNS restore task failed"),
        }
    }
    peer_dns_active.store(false, std::sync::atomic::Ordering::SeqCst);
    {
        let mut slot = tun_slot.write().await;
        slot.device = None;
        slot.generation = slot.generation.wrapping_add(1);
    }
    drop(live.tun);
    let _ = cfg;
    handle.set_up(false);
    let _ = events.send(LocalEvent::DataPlaneChanged { up: false });
    tracing::info!("data plane down");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn bring_up(
    handle: &DataPlaneHandle,
    tun_slot: &TunSlot,
    node: &CoreNode,
    metrics: &AgentMetrics,
    cfg: &DataPlaneConfig,
    peer_dns_active: &std::sync::atomic::AtomicBool,
    state: &Mutex<Option<LivePlane>>,
    events: &tokio::sync::broadcast::Sender<LocalEvent>,
    routes: &RouteReconciler,
) -> anyhow::Result<()> {
    if handle.is_up() {
        return Ok(());
    }
    let tun = Arc::new(build_tun(
        &cfg.ifname,
        cfg.assigned_ipv4,
        cfg.prefix,
        cfg.mtu,
    )?);
    crate::system_firewall::configure(&cfg.ifname);
    let _ = crate::magic_dns::ensure_magic_dns_addr(&cfg.ifname, cfg.dns_cfg.magic_ip);
    {
        let mut slot = tun_slot.write().await;
        slot.device = Some(tun.clone());
        slot.generation = slot.generation.wrapping_add(1);
    }

    // osdns is synchronous control-plane work; keep it off the executor.
    // A failed apply leaves internal state honest: PeerDNS is reported
    // inactive instead of claiming an overlay that was never installed.
    let dns_active = match cfg.dns.clone() {
        Some(dns) => {
            let ifname = cfg.ifname.clone();
            let magic_ip = cfg.dns_cfg.magic_ip;
            let suffix = cfg.dns_cfg.suffix.clone();
            let worker = dns.clone();
            let result =
                tokio::task::spawn_blocking(move || worker.update(&ifname, magic_ip, &suffix))
                    .await;
            match result {
                // Read back reality: only claim PeerDNS active while the
                // lease is actually held.
                Ok(Ok(())) => dns.is_active(),
                Ok(Err(e)) => {
                    tracing::error!(error = %e, "PeerDNS OS configuration failed");
                    false
                }
                Err(e) => {
                    tracing::warn!(error = %e, "PeerDNS configuration task failed");
                    false
                }
            }
        }
        None => false,
    };
    peer_dns_active.store(dns_active, std::sync::atomic::Ordering::SeqCst);

    let (remote_subnets, device_profile, has_exit) =
        route_snapshot(node, cfg.is_direct, cfg.network_id);
    if !cfg.is_direct
        && let Err(e) = crate::system_routes::apply(
            routes,
            &cfg.ifname,
            &device_profile,
            cfg.assigned_ipv4,
            cfg.prefix,
            &remote_subnets,
            has_exit,
            &cfg.underlay_hosts,
        )
        .await
    {
        tracing::warn!(error = %e, "route reconcile on dataplane up failed");
    }
    crate::forward::ensure_exit_nat(node.routes.is_exit_node());

    let firewalls: std::collections::HashMap<_, _> = node
        .direct
        .iter()
        .map(|(id, rt)| (*id, rt.firewall.clone()))
        .collect();
    let outbound = spawn_outbound(
        tun.clone(),
        node.routes.clone(),
        node.tunnel_pool.clone(),
        node.acl.clone(),
        firewalls,
        metrics.clone(),
        cfg.mtu,
    );

    *state.lock() = Some(LivePlane {
        tun,
        dns: cfg.dns.clone(),
        outbound,
    });
    handle.set_up(true);
    let _ = events.send(LocalEvent::DataPlaneChanged { up: true });
    tracing::info!("data plane up");
    Ok(())
}

pub fn spawn_outbound(
    tun: Arc<AsyncDevice>,
    routes: RoutingTable,
    pool: ConnPool,
    acl: AclEngine,
    firewalls: std::collections::HashMap<uuid::Uuid, tunnet_core::direct::FirewallEngine>,
    metrics: AgentMetrics,
    mtu: u16,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(e) = run_outbound(crate::tun_io::OutboundDeps {
            tun,
            routes,
            pool,
            acl,
            firewalls,
            metrics,
            mtu,
        })
        .await
        {
            tracing::error!(?e, "outbound TUN loop exited");
        }
    })
}

/// Resolve IPv4 underlay pins from a control-plane URL (host literal or hostname skip).
pub fn underlay_hosts_from_url(control_url: &str) -> Vec<Ipv4Addr> {
    let host = control_url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split(['/', ':', '?'])
        .next()
        .unwrap_or("");
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let mut out = Vec::new();
    if let Ok(ip) = host.parse::<Ipv4Addr>()
        && !ip.is_loopback()
        && !ip.is_unspecified()
    {
        out.push(ip);
    }
    out
}
