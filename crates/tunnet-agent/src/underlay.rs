use std::net::{IpAddr, Ipv4Addr};

use ipnet::{Ipv4Net, Ipv6Net};

#[derive(Debug, Clone, Default)]
#[allow(dead_code)] // Surfaced for NAT/route callers and future status APIs.
pub struct UnderlayInfo {
    pub interface_index: u32,
    pub interface_name: String,
    pub gateway: Option<IpAddr>,
    pub local_ipv4: Vec<Ipv4Net>,
    pub local_ipv6: Vec<Ipv6Net>,
    pub mtu: Option<u32>,
    pub dns_servers: Vec<IpAddr>,
}

impl UnderlayInfo {
    pub fn discover() -> Option<Self> {
        let iface = netdev::get_default_interface().ok()?;
        let gateway = iface
            .gateway
            .as_ref()
            .and_then(|gw| {
                gw.ipv4
                    .first()
                    .copied()
                    .map(IpAddr::V4)
                    .or_else(|| gw.ipv6.first().copied().map(IpAddr::V6))
            })
            .or_else(|| {
                netdev::get_default_gateway().ok().and_then(|gw| {
                    gw.ipv4
                        .first()
                        .copied()
                        .map(IpAddr::V4)
                        .or_else(|| gw.ipv6.first().copied().map(IpAddr::V6))
                })
            });

        let local_ipv4 = iface
            .ipv4
            .iter()
            .filter_map(|n| Ipv4Net::new(n.addr(), n.prefix_len()).ok())
            .collect();
        let local_ipv6 = iface
            .ipv6
            .iter()
            .filter_map(|n| Ipv6Net::new(n.addr(), n.prefix_len()).ok())
            .collect();

        Some(Self {
            interface_index: iface.index,
            interface_name: iface.name,
            gateway,
            local_ipv4,
            local_ipv6,
            mtu: iface.mtu,
            dns_servers: iface.dns_servers,
        })
    }

    pub fn gateway_v4(&self) -> Option<Ipv4Addr> {
        match self.gateway {
            Some(IpAddr::V4(ip)) => Some(ip),
            _ => None,
        }
    }
}

/// IPv4 default gateway of the underlay, if any.
pub fn default_gateway_v4() -> Option<Ipv4Addr> {
    UnderlayInfo::discover().and_then(|u| u.gateway_v4())
}

/// Underlay interface name used for NAT MASQUERADE.
pub fn default_uplink_name() -> Option<String> {
    UnderlayInfo::discover().map(|u| u.interface_name)
}
