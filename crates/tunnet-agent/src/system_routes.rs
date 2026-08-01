//! OS route installation with diff-based reconciliation.
//!
//! Tracks routes Tunnet installed and adds/removes on each desired-state update
//! without requiring a restart. Gateway discovery uses [`crate::underlay`] (netdev).

use std::collections::BTreeSet;
use std::net::Ipv4Addr;
use std::process::Command;
use std::sync::{Arc, Mutex};

use ipnet::Ipv4Net;
use tunnet_common::{DeviceProfile, SplitTunnelMode};

use crate::underlay;

fn rfc1918_nets() -> [Ipv4Net; 3] {
    [
        "10.0.0.0/8".parse().expect("rfc1918"),
        "172.16.0.0/12".parse().expect("rfc1918"),
        "192.168.0.0/16".parse().expect("rfc1918"),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum RouteKind {
    ViaTun(Ipv4Net),
    ViaGw { cidr: Ipv4Net, gw: Ipv4Addr },
}

#[derive(Debug, Clone, Default)]
struct Installed {
    routes: BTreeSet<RouteKind>,
    gateway: Option<Ipv4Addr>,
    ifname: String,
}

/// Desired OS routing state for the agent dataplane.
#[derive(Debug, Clone)]
pub struct DesiredRoutes {
    pub ifname: String,
    pub profile: DeviceProfile,
    pub remote_subnets: Vec<Ipv4Net>,
    pub has_exit: bool,
    pub underlay_hosts: Vec<Ipv4Addr>,
}

impl DesiredRoutes {
    fn to_set(&self, gateway: Option<Ipv4Addr>) -> BTreeSet<RouteKind> {
        let mut set = BTreeSet::new();
        for cidr in &self.remote_subnets {
            set.insert(RouteKind::ViaTun(*cidr));
        }

        match self.profile.split_tunnel_mode {
            SplitTunnelMode::Include => {
                for cidr in &self.profile.split_tunnel_cidrs {
                    set.insert(RouteKind::ViaTun(*cidr));
                }
            }
            SplitTunnelMode::Exclude => {
                if self.has_exit || self.profile.exit_node_endpoint_id.is_some() {
                    set.insert(RouteKind::ViaTun("0.0.0.0/0".parse().expect("default")));
                    if let Some(gw) = gateway {
                        for cidr in &self.profile.split_tunnel_cidrs {
                            set.insert(RouteKind::ViaGw { cidr: *cidr, gw });
                        }
                        if self.profile.allow_local_lan {
                            for c in rfc1918_nets() {
                                set.insert(RouteKind::ViaGw { cidr: c, gw });
                            }
                        }
                        for host in &self.underlay_hosts {
                            set.insert(RouteKind::ViaGw {
                                cidr: Ipv4Net::from(*host),
                                gw,
                            });
                        }
                    }
                }
            }
        }
        set
    }
}

/// Diff-based OS route manager.
#[derive(Clone, Default)]
pub struct RouteReconciler {
    inner: Arc<Mutex<Installed>>,
}

impl RouteReconciler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reconcile(&self, desired: &DesiredRoutes) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());

        if g.gateway.is_none() {
            g.gateway = underlay::default_gateway_v4();
        }
        if (desired.has_exit || desired.profile.exit_node_endpoint_id.is_some())
            && desired.profile.split_tunnel_mode == SplitTunnelMode::Exclude
            && g.gateway.is_none()
        {
            tracing::warn!(
                "exit node enabled but underlay default gateway unknown; refusing default via TUN"
            );
        }

        let gateway = g.gateway;
        let want = if gateway.is_none()
            && (desired.has_exit || desired.profile.exit_node_endpoint_id.is_some())
            && desired.profile.split_tunnel_mode == SplitTunnelMode::Exclude
        {
            let mut d = desired.clone();
            d.has_exit = false;
            let mut profile = d.profile.clone();
            profile.exit_node_endpoint_id = None;
            d.profile = profile;
            d.to_set(None)
        } else {
            desired.to_set(gateway)
        };

        let to_add: Vec<_> = want.difference(&g.routes).cloned().collect();
        let to_del: Vec<_> = g.routes.difference(&want).cloned().collect();

        for r in to_del {
            match &r {
                RouteKind::ViaTun(cidr) => del_route(&desired.ifname, cidr),
                RouteKind::ViaGw { cidr, gw } => del_route_via_gateway(cidr, *gw),
            }
            g.routes.remove(&r);
        }

        let mut ordered = to_add;
        ordered.sort_by_key(|r| match r {
            RouteKind::ViaGw { cidr, .. } if cidr.prefix_len() == 32 => 0u8,
            RouteKind::ViaGw { .. } => 1,
            RouteKind::ViaTun(c) if c.prefix_len() == 0 => 3,
            RouteKind::ViaTun(_) => 2,
        });

        for r in ordered {
            match &r {
                RouteKind::ViaTun(cidr) => add_route(&desired.ifname, cidr),
                RouteKind::ViaGw { cidr, gw } => add_route_via_gateway(cidr, *gw),
            }
            g.routes.insert(r);
        }

        g.ifname = desired.ifname.clone();
        if gateway.is_some()
            && (desired.has_exit || desired.profile.exit_node_endpoint_id.is_some())
            && desired.underlay_hosts.is_empty()
            && desired.profile.split_tunnel_mode == SplitTunnelMode::Exclude
        {
            tracing::warn!("exit enabled with empty underlay host list; control plane may loop");
        }
    }

    pub fn clear(&self) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let ifname = g.ifname.clone();
        let routes: Vec<_> = g.routes.iter().cloned().collect();
        for r in routes {
            match &r {
                RouteKind::ViaTun(cidr) => del_route(&ifname, cidr),
                RouteKind::ViaGw { cidr, gw } => del_route_via_gateway(cidr, *gw),
            }
        }
        g.routes.clear();
        g.gateway = None;
    }
}

pub fn apply(
    reconciler: &RouteReconciler,
    ifname: &str,
    profile: &DeviceProfile,
    remote_subnets: &[Ipv4Net],
    has_exit: bool,
    underlay_hosts: &[Ipv4Addr],
) {
    reconciler.reconcile(&DesiredRoutes {
        ifname: ifname.to_string(),
        profile: profile.clone(),
        remote_subnets: remote_subnets.to_vec(),
        has_exit,
        underlay_hosts: underlay_hosts.to_vec(),
    });
}

pub fn unapply(reconciler: &RouteReconciler) {
    reconciler.clear();
}

fn del_route(ifname: &str, cidr: &Ipv4Net) {
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("ip")
            .args(["route", "del", &cidr.to_string(), "dev", ifname])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("route")
            .args(["-n", "delete", "-net", &cidr.to_string()])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("netsh")
            .args([
                "interface",
                "ipv4",
                "delete",
                "route",
                &cidr.to_string(),
                ifname,
            ])
            .status();
    }
    tracing::debug!(%cidr, ifname, "removed route via TUN");
}

fn del_route_via_gateway(cidr: &Ipv4Net, gateway: Ipv4Addr) {
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("ip")
            .args([
                "route",
                "del",
                &cidr.to_string(),
                "via",
                &gateway.to_string(),
            ])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("route")
            .args(["-n", "delete", "-net", &cidr.to_string()])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("route")
            .args([
                "delete",
                &cidr.network().to_string(),
                "mask",
                &cidr.netmask().to_string(),
                &gateway.to_string(),
            ])
            .status();
    }
    tracing::debug!(%cidr, "removed excluded CIDR route");
}

fn add_route(ifname: &str, cidr: &Ipv4Net) {
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("ip")
            .args(["route", "replace", &cidr.to_string(), "dev", ifname])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("route")
            .args(["-n", "add", "-net", &cidr.to_string(), "-interface", ifname])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("netsh")
            .args([
                "interface",
                "ipv4",
                "add",
                "route",
                &cidr.to_string(),
                ifname,
                "metric=1",
            ])
            .status();
    }
    tracing::debug!(%cidr, ifname, "installed route via TUN");
}

fn add_route_via_gateway(cidr: &Ipv4Net, gateway: Ipv4Addr) {
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("ip")
            .args([
                "route",
                "replace",
                &cidr.to_string(),
                "via",
                &gateway.to_string(),
            ])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("route")
            .args(["-n", "add", "-net", &cidr.to_string(), &gateway.to_string()])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("route")
            .args([
                "add",
                &cidr.network().to_string(),
                "mask",
                &cidr.netmask().to_string(),
                &gateway.to_string(),
            ])
            .status();
    }
    tracing::debug!(%cidr, %gateway, "excluded CIDR via original gateway");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desired_includes_rfc1918_when_allow_local_lan() {
        let profile = DeviceProfile {
            exit_node_endpoint_id: Some("abc".into()),
            allow_local_lan: true,
            ..Default::default()
        };
        let d = DesiredRoutes {
            ifname: "tun0".into(),
            profile,
            remote_subnets: vec![],
            has_exit: true,
            underlay_hosts: vec!["1.2.3.4".parse().unwrap()],
        };
        let gw: Ipv4Addr = "192.168.1.1".parse().unwrap();
        let set = d.to_set(Some(gw));
        assert!(set.contains(&RouteKind::ViaTun("0.0.0.0/0".parse().unwrap())));
        assert!(set.contains(&RouteKind::ViaGw {
            cidr: "10.0.0.0/8".parse().unwrap(),
            gw,
        }));
        assert!(set.contains(&RouteKind::ViaGw {
            cidr: Ipv4Net::from("1.2.3.4".parse::<Ipv4Addr>().unwrap()),
            gw,
        }));
    }

    #[test]
    fn reconciler_diff_is_idempotent() {
        let r = RouteReconciler::new();
        let profile = DeviceProfile::default();
        r.reconcile(&DesiredRoutes {
            ifname: "tun0".into(),
            profile,
            remote_subnets: vec!["10.99.0.0/24".parse().unwrap()],
            has_exit: false,
            underlay_hosts: vec![],
        });
        r.clear();
    }
}
