use std::net::{IpAddr, Ipv4Addr};

pub type PgIp = ipnetwork::IpNetwork;

pub fn pg_host(addr: Ipv4Addr) -> PgIp {
    PgIp::new(IpAddr::V4(addr), 32).expect("host /32")
}

pub fn pg_ipv6_host(addr: std::net::Ipv6Addr) -> PgIp {
    PgIp::new(IpAddr::V6(addr), 128).expect("host /128")
}

pub fn to_ipnet(net: PgIp) -> anyhow::Result<ipnet::IpNet> {
    match net {
        ipnetwork::IpNetwork::V4(n) => {
            Ok(ipnet::IpNet::V4(ipnet::Ipv4Net::new(n.ip(), n.prefix())?))
        }
        ipnetwork::IpNetwork::V6(n) => {
            Ok(ipnet::IpNet::V6(ipnet::Ipv6Net::new(n.ip(), n.prefix())?))
        }
    }
}

pub fn to_ipv4_addr(net: PgIp) -> anyhow::Result<Ipv4Addr> {
    match to_ipnet(net)? {
        ipnet::IpNet::V4(v) => Ok(v.addr()),
        _ => anyhow::bail!("expected IPv4 address"),
    }
}
