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
use crate::system_dns::DnsGuard;
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
    pub is_direct: bool,
    pub network_id: Uuid,
    pub underlay_hosts: Vec<Ipv4Addr>,
    #[cfg(windows)]
    pub wintun_file: Option<String>,
}

pub(crate) struct LivePlane {
    tun: Arc<AsyncDevice>,
    dns_guard: Option<DnsGuard>,
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
    dns_guard: Option<DnsGuard>,
    outbound: tokio::task::JoinHandle<()>,
    node: &CoreNode,
    is_direct: bool,
    network_id: Uuid,
) -> LivePlane {
    let _ = (node, is_direct, network_id);
    LivePlane {
        tun,
        dns_guard,
        outbound,
    }
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
    crate::system_routes::unapply(routes);
    crate::forward::teardown_exit_nat();
    drop(live.dns_guard);
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
        #[cfg(windows)]
        cfg.wintun_file.as_deref(),
    )?);
    crate::system_firewall::configure(&cfg.ifname);
    let _ = crate::magic_dns::ensure_magic_dns_addr(&cfg.ifname, cfg.dns_cfg.magic_ip);
    {
        let mut slot = tun_slot.write().await;
        slot.device = Some(tun.clone());
        slot.generation = slot.generation.wrapping_add(1);
    }

    let dns_guard = match crate::system_dns::configure(cfg.dns_cfg.magic_ip, &cfg.dns_cfg.suffix) {
        Ok(g) => {
            peer_dns_active.store(true, std::sync::atomic::Ordering::SeqCst);
            Some(g)
        }
        Err(e) => {
            tracing::warn!(?e, "PeerDNS system configuration skipped");
            peer_dns_active.store(false, std::sync::atomic::Ordering::SeqCst);
            None
        }
    };

    let (remote_subnets, device_profile, has_exit) =
        route_snapshot(node, cfg.is_direct, cfg.network_id);
    if !cfg.is_direct {
        crate::system_routes::apply(
            routes,
            &cfg.ifname,
            &device_profile,
            &remote_subnets,
            has_exit,
            &cfg.underlay_hosts,
        );
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
    );

    *state.lock() = Some(LivePlane {
        tun,
        dns_guard,
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
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(e) = run_outbound(crate::tun_io::OutboundDeps {
            tun,
            routes,
            pool,
            acl,
            firewalls,
            metrics,
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
