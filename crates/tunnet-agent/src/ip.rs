//! Minimal packet parsing. We look at the IPv4 header for src/dst and,
//! for TCP/UDP, peek at ports / flags for ACL and QoS classification.

use std::net::Ipv4Addr;

use tunnet_common::policy::Protocol;

pub struct ParsedIpv4 {
    pub src: Ipv4Addr,
    pub dst: Ipv4Addr,
    pub protocol: Protocol,
    pub dst_port: Option<u16>,
    pub src_port: Option<u16>,
    /// TCP flags byte (offset 13 in TCP header), when protocol is TCP.
    pub tcp_flags: Option<u8>,
    /// Bytes after the L4 header (0 for pure ACK / ICMP header-only sense).
    pub l4_payload_len: usize,
}

#[inline]
pub fn parse_ipv4(packet: &[u8]) -> Option<ParsedIpv4> {
    if packet.len() < 20 {
        return None;
    }
    if packet[0] >> 4 != 4 {
        return None;
    }
    let ihl = (packet[0] & 0x0f) as usize * 4;
    if packet.len() < ihl {
        return None;
    }
    let src = Ipv4Addr::from(<[u8; 4]>::try_from(&packet[12..16]).ok()?);
    let dst = Ipv4Addr::from(<[u8; 4]>::try_from(&packet[16..20]).ok()?);
    let proto_byte = packet[9];
    let total_len = packet.len();
    let (protocol, src_port, dst_port, tcp_flags, l4_payload_len) = match proto_byte {
        6 if total_len >= ihl + 14 => {
            let data_off = ((packet[ihl + 12] >> 4) as usize) * 4;
            let l4_hdr = data_off.max(20);
            let payload = total_len.saturating_sub(ihl + l4_hdr);
            (
                Protocol::Tcp,
                Some(u16::from_be_bytes([packet[ihl], packet[ihl + 1]])),
                Some(u16::from_be_bytes([packet[ihl + 2], packet[ihl + 3]])),
                Some(packet[ihl + 13]),
                payload,
            )
        }
        6 if total_len >= ihl + 4 => (
            Protocol::Tcp,
            Some(u16::from_be_bytes([packet[ihl], packet[ihl + 1]])),
            Some(u16::from_be_bytes([packet[ihl + 2], packet[ihl + 3]])),
            None,
            total_len.saturating_sub(ihl + 20),
        ),
        17 if total_len >= ihl + 8 => {
            let payload = total_len.saturating_sub(ihl + 8);
            (
                Protocol::Udp,
                Some(u16::from_be_bytes([packet[ihl], packet[ihl + 1]])),
                Some(u16::from_be_bytes([packet[ihl + 2], packet[ihl + 3]])),
                None,
                payload,
            )
        }
        17 if total_len >= ihl + 4 => (
            Protocol::Udp,
            Some(u16::from_be_bytes([packet[ihl], packet[ihl + 1]])),
            Some(u16::from_be_bytes([packet[ihl + 2], packet[ihl + 3]])),
            None,
            total_len.saturating_sub(ihl + 8),
        ),
        1 => (
            Protocol::Icmp,
            None,
            None,
            None,
            total_len.saturating_sub(ihl + 8),
        ),
        _ => (
            Protocol::Any,
            None,
            None,
            None,
            total_len.saturating_sub(ihl),
        ),
    };
    Some(ParsedIpv4 {
        src,
        dst,
        protocol,
        dst_port,
        src_port,
        tcp_flags,
        l4_payload_len,
    })
}
