//! Owned packet buffer for the data plane.
//!
//! Parse once: [`PacketBuf`] owns its bytes plus compact parsed metadata,
//! a stable [`FlowKey`], and an enqueue timestamp for AQM sojourn accounting.
//!
//! Ownership can be converted into `bytes::Bytes` without a second copy via
//! the `Vec<u8>` -> `Bytes` path (`Bytes::from(vec)` is zero-copy for the
//! payload; the old path did `Bytes::copy_from_slice` on top of a reusable
//! buffer which always copied). A small pool recycles allocations.

use std::collections::VecDeque;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use bytes::Bytes;

use super::{Fragmentation, IpMeta, Packet, Transport, parse};

/// Stable per-flow scheduling key.
///
/// TCP/UDP: IP 5-tuple. ICMP: src/dst/proto + echo id (cheap isolation).
/// Other protocols without ports: src/dst/proto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FlowKey {
    pub src: IpAddr,
    pub dst: IpAddr,
    pub proto: u8,
    pub sport: u16,
    pub dport: u16,
}

impl FlowKey {
    pub fn for_packet(pkt: &Packet<'_>) -> Self {
        let (src, dst) = match pkt.ip {
            IpMeta::V4 { src, dst, .. } => (IpAddr::V4(src), IpAddr::V4(dst)),
            IpMeta::V6 { src, dst, .. } => (IpAddr::V6(src), IpAddr::V6(dst)),
        };
        let proto = pkt.ip.ip_protocol();
        let (sport, dport) = match pkt.transport {
            Transport::Tcp {
                src_port, dst_port, ..
            }
            | Transport::Udp {
                src_port, dst_port, ..
            } => (src_port, dst_port),
            Transport::Icmpv4 { echo_id, .. } => (echo_id.unwrap_or(0), 0),
            Transport::Icmpv6 { .. } => (0, 0),
            Transport::Other { .. } => (0, 0),
            Transport::LaterFragment {
                protocol,
                identification,
                ..
            } => (
                (identification & 0xffff) as u16,
                (protocol as u16).wrapping_mul(31),
            ),
        };
        Self {
            src,
            dst,
            proto,
            sport,
            dport,
        }
    }

    /// Canonical bidirectional identity for conntrack fast-path hits.
    pub fn canonical(self) -> (Self, bool) {
        let rev = Self {
            src: self.dst,
            dst: self.src,
            proto: self.proto,
            sport: self.dport,
            dport: self.sport,
        };
        if (self.src, self.sport) <= (self.dst, self.dport) {
            (self, false)
        } else {
            (rev, true)
        }
    }
}

/// Compact parsed metadata stored alongside owned bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PacketMeta {
    pub src_v4: Option<Ipv4Addr>,
    pub dst_v4: Option<Ipv4Addr>,
    pub src: IpAddr,
    pub dst: IpAddr,
    pub proto: u8,
    pub wire_len: usize,
    pub ip_header_len: usize,
    pub transport: Transport,
    pub fragmentation: Fragmentation,
    pub tcp_flags: u8,
}

impl PacketMeta {
    pub fn from_packet(pkt: &Packet<'_>) -> Self {
        let (src, dst) = match pkt.ip {
            IpMeta::V4 { src, dst, .. } => (IpAddr::V4(src), IpAddr::V4(dst)),
            IpMeta::V6 { src, dst, .. } => (IpAddr::V6(src), IpAddr::V6(dst)),
        };
        let tcp_flags = match pkt.transport {
            Transport::Tcp { flags, .. } => flags.0,
            _ => 0,
        };
        Self {
            src_v4: pkt.ip.v4_src(),
            dst_v4: pkt.ip.v4_dst(),
            src,
            dst,
            proto: pkt.ip.ip_protocol(),
            wire_len: pkt.wire_len,
            ip_header_len: pkt.ip.header_len(),
            transport: pkt.transport,
            fragmentation: pkt.fragmentation,
            tcp_flags,
        }
    }

    pub fn is_fragment(&self) -> bool {
        !matches!(self.fragmentation, Fragmentation::None)
    }

    pub fn is_later_fragment(&self) -> bool {
        matches!(self.fragmentation, Fragmentation::Later { .. })
    }

    /// Cheap SSH-NAT precondition using stored metadata only (no reparse).
    pub fn ssh_nat_class(&self, self_ip: Ipv4Addr) -> SshNatClass {
        if self.is_later_fragment() {
            return SshNatClass::None;
        }
        let Transport::Tcp {
            src_port,
            dst_port,
            header_len,
            ..
        } = self.transport
        else {
            return SshNatClass::None;
        };
        if header_len < 18 {
            return SshNatClass::None;
        }
        if self.dst_v4 == Some(self_ip) && dst_port == 22 {
            return SshNatClass::InboundToInternal;
        }
        if self.src_v4 == Some(self_ip) && src_port == 30022 {
            return SshNatClass::OutboundToExternal;
        }
        SshNatClass::None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshNatClass {
    None,
    InboundToInternal,
    OutboundToExternal,
}

/// Owned data-plane packet: bytes + parse-once metadata.
#[derive(Debug)]
pub struct PacketBuf {
    pub data: Vec<u8>,
    pub meta: PacketMeta,
    pub flow: FlowKey,
    pub enqueued_at: Instant,
}

impl PacketBuf {
    /// Parse `data[..len]` once; returns `None` on parse failure.
    pub fn from_slice(data: &[u8]) -> Option<Self> {
        let pkt = parse(data).ok()?;
        let meta = PacketMeta::from_packet(&pkt);
        let flow = FlowKey::for_packet(&pkt);
        Some(Self {
            data: data.to_vec(),
            meta,
            flow,
            enqueued_at: Instant::now(),
        })
    }

    /// Take ownership of a `Vec<u8>` of exactly `len` bytes without copying.
    pub fn from_vec(mut data: Vec<u8>, len: usize) -> Option<Self> {
        data.truncate(len);
        let pkt = parse(&data).ok()?;
        let meta = PacketMeta::from_packet(&pkt);
        let flow = FlowKey::for_packet(&pkt);
        Some(Self {
            data,
            meta,
            flow,
            enqueued_at: Instant::now(),
        })
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn sojourn(&self) -> std::time::Duration {
        self.enqueued_at.elapsed()
    }

    /// Zero-extra-copy conversion into QUIC DATAGRAM payload.
    pub fn into_bytes(self) -> Bytes {
        Bytes::from(self.data)
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.data
    }
}

/// Recycled owned buffers to avoid per-packet allocation churn.
#[derive(Debug, Default)]
pub struct PacketPool {
    free: Mutex<VecDeque<Vec<u8>>>,
    cap: usize,
}

impl PacketPool {
    pub fn new(cap: usize) -> Arc<Self> {
        Arc::new(Self {
            free: Mutex::new(VecDeque::new()),
            cap: cap.max(8),
        })
    }

    pub fn acquire(&self, capacity: usize) -> Vec<u8> {
        if let Some(mut v) = self.free.lock().expect("pool").pop_front() {
            v.clear();
            v.reserve(capacity.saturating_sub(v.capacity()));
            return v;
        }
        Vec::with_capacity(capacity)
    }

    pub fn release(&self, mut v: Vec<u8>) {
        v.clear();
        let mut free = self.free.lock().expect("pool");
        if free.len() < self.cap {
            free.push_back(v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn udp_packet() -> Vec<u8> {
        let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64).udp(40000, 443);
        let mut o = Vec::new();
        b.write(&mut o, &[0; 200]).unwrap();
        o
    }

    #[test]
    fn flow_key_stable_for_5tuple() {
        let raw = udp_packet();
        let a = PacketBuf::from_slice(&raw).unwrap();
        let b = PacketBuf::from_slice(&raw).unwrap();
        assert_eq!(a.flow, b.flow);
        assert_eq!(a.meta, b.meta);
    }

    #[test]
    fn into_bytes_no_copy_length() {
        let raw = udp_packet();
        let p = PacketBuf::from_slice(&raw).unwrap();
        let n = p.len();
        let b = p.into_bytes();
        assert_eq!(b.len(), n);
    }
}
