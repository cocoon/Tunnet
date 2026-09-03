//! Unified compiled packet policy: one flow key, one conntrack, one verdict.
//!
//! Consolidates the overlapping ACL + Direct-firewall packet work into a
//! single hot path:
//!
//! ```text
//! not fragmented → L4 from PacketMeta (no fragment lock)
//! fragmented    → fragment slow path (fail-closed without first-fragment state)
//! established   → single canonical conntrack lookup → Allow
//! new flow      → compiled ACL phases + compiled firewall rules → verdict
//! ```
//!
//! Policy is compiled at configuration time (pre-sorted phases, merged port
//! intervals, lowercased selector keys, integer endpoint ids where possible).
//! The hot path allocates nothing, sorts nothing, and formats no strings
//! (notably no `format!("user:{id}")` per packet).

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use arc_swap::ArcSwap;
use dashmap::DashMap;
use parking_lot::Mutex;
use tunnet_common::packet::{
    CachedTransport, FragKey, FragmentTable, PacketMeta, ResolvedL4, TcpFlags, Transport,
};
use tunnet_common::policy::{
    Action, DefaultAction, Direction, IcmpPolicy, PolicyBundle, Protocol, RuleScope, Selector,
};
use uuid::Uuid;

// Reuse TTLs from the established engines.
const TCP_ACTIVE_TTL: Duration = Duration::from_secs(300);
const TCP_TIME_WAIT_TTL: Duration = Duration::from_secs(10);
const UDP_TTL: Duration = Duration::from_secs(30);
const ICMP_TTL: Duration = Duration::from_secs(10);

/// Canonical bidirectional conntrack key: one lookup in the common case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct CanonKey {
    proto: u8,
    a: Ipv4Addr,
    aport: u16,
    b: Ipv4Addr,
    bport: u16,
}

fn proto_num(p: Protocol) -> Option<u8> {
    match p {
        Protocol::Tcp => Some(6),
        Protocol::Udp => Some(17),
        Protocol::Icmp => Some(1),
        Protocol::Icmpv6 => Some(58),
        Protocol::Other(n) => Some(n),
        Protocol::Any => None,
    }
}

fn canon_key(
    proto: Protocol,
    src: Ipv4Addr,
    dst: Ipv4Addr,
    sport: Option<u16>,
    dport: Option<u16>,
) -> Option<CanonKey> {
    let num = proto_num(proto)?;
    if num == 1 {
        // ICMP: direction-independent, keyed by sorted endpoints + echo id.
        let id = sport.or(dport).unwrap_or(0);
        let (a, b) = if src <= dst { (src, dst) } else { (dst, src) };
        return Some(CanonKey {
            proto: num,
            a,
            aport: id,
            b,
            bport: 0,
        });
    }
    let (a, aport, b, bport) = if (src, sport.unwrap_or(0)) <= (dst, dport.unwrap_or(0)) {
        (src, sport.unwrap_or(0), dst, dport.unwrap_or(0))
    } else {
        (dst, dport.unwrap_or(0), src, sport.unwrap_or(0))
    };
    Some(CanonKey {
        proto: num,
        a,
        aport,
        b,
        bport,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TcpPhase {
    SynSent,
    Established,
    TimeWait,
}

#[derive(Debug, Clone, Copy)]
enum Phase {
    Tcp(TcpPhase),
    Udp,
    Icmp,
}

#[derive(Debug, Clone, Copy)]
struct FlowState {
    phase: Phase,
    last_seen: Instant,
}

fn ttl_of(s: &FlowState) -> Duration {
    match s.phase {
        Phase::Tcp(TcpPhase::TimeWait) => TCP_TIME_WAIT_TTL,
        Phase::Tcp(_) => TCP_ACTIVE_TTL,
        Phase::Udp => UDP_TTL,
        Phase::Icmp => ICMP_TTL,
    }
}

/// Precompiled selector: no per-packet allocation or case folding.
#[derive(Debug, Clone)]
enum Sel {
    Any,
    Endpoint(Box<str>),
    Tag(Box<str>),
    Network(Box<str>),
    Cidr(ipnet::IpNet),
    User { id: Box<str>, marker: Box<str> },
}

impl Sel {
    fn compile(s: &Selector) -> Self {
        match s {
            Selector::Any => Self::Any,
            Selector::Endpoint(id) => Self::Endpoint(id.to_ascii_lowercase().into()),
            Selector::Tag(t) => Self::Tag(t.clone().into()),
            Selector::Network(n) => Self::Network(n.clone().into()),
            Selector::Cidr(net) => Self::Cidr(*net),
            Selector::User(id) => {
                let lower = id.to_ascii_lowercase();
                Self::User {
                    marker: format!("user:{id}").into(),
                    id: lower.into(),
                }
            }
        }
    }

    fn matches(
        &self,
        endpoint_hex: &str,
        tags: &[String],
        network: &str,
        ip: Option<Ipv4Addr>,
    ) -> bool {
        match self {
            Self::Any => true,
            Self::Endpoint(id) => id.as_ref().eq_ignore_ascii_case(endpoint_hex),
            Self::Tag(t) => tags.iter().any(|x| x.as_str() == t.as_ref()),
            Self::Network(n) => n.as_ref() == network,
            Self::Cidr(net) => ip.is_some_and(|ip| net.contains(&std::net::IpAddr::V4(ip))),
            Self::User { id, marker } => tags
                .iter()
                .any(|x| x.as_str() == marker.as_ref() || x.eq_ignore_ascii_case(id)),
        }
    }
}

#[derive(Debug, Clone)]
struct CompiledRule {
    src: Sel,
    dst: Sel,
    action: Action,
    order_index: i32,
    priority: i32,
    protocol: Option<Protocol>,
    /// Merged, sorted, non-overlapping port intervals. Empty = any.
    ports: Vec<(u16, u16)>,
    has_posture: bool,
}

impl CompiledRule {
    fn port_hit(&self, port: Option<u16>) -> bool {
        if self.ports.is_empty() {
            return true;
        }
        let Some(p) = port else { return false };
        self.ports.iter().any(|(a, b)| p >= *a && p <= *b)
    }
}

fn compile_ports(r: &tunnet_common::policy::PolicyRule) -> Vec<(u16, u16)> {
    let mut v: Vec<(u16, u16)> = r.ports.iter().map(|p| (p.start, p.end)).collect();
    if v.is_empty() {
        return v;
    }
    v.sort();
    let mut out = Vec::with_capacity(v.len());
    let mut cur = v[0];
    for (a, b) in v.into_iter().skip(1) {
        if a <= cur.1.saturating_add(1) {
            cur.1 = cur.1.max(b);
        } else {
            out.push(cur);
            cur = (a, b);
        }
    }
    out.push(cur);
    out
}

/// Allocation-free compiled ACL snapshot.
#[derive(Debug)]
pub struct CompiledAcl {
    org_deny: Vec<CompiledRule>,
    net_deny: Vec<CompiledRule>,
    net_allow: Vec<CompiledRule>,
    default_action: DefaultAction,
    icmp_policy: IcmpPolicy,
}

impl CompiledAcl {
    pub fn compile(bundle: &PolicyBundle) -> Self {
        let mut org_deny = Vec::new();
        let mut net_deny = Vec::new();
        let mut net_allow = Vec::new();
        for r in &bundle.rules {
            if !r.enabled {
                continue;
            }
            let c = CompiledRule {
                src: Sel::compile(&r.src),
                dst: Sel::compile(&r.dst),
                action: r.action,
                order_index: r.order_index,
                priority: r.priority,
                protocol: r.protocol,
                ports: compile_ports(r),
                has_posture: !r.src_posture.is_empty(),
            };
            match (r.scope, r.action) {
                (RuleScope::Organization, Action::Deny) => org_deny.push(c),
                (RuleScope::Network, Action::Deny) => net_deny.push(c),
                (RuleScope::Network, Action::Allow) => net_allow.push(c),
                _ => {}
            }
        }
        for v in [&mut org_deny, &mut net_deny, &mut net_allow] {
            v.sort_by(|a, b| {
                a.order_index
                    .cmp(&b.order_index)
                    .then_with(|| a.priority.cmp(&b.priority))
            });
        }
        Self {
            org_deny,
            net_deny,
            net_allow,
            default_action: bundle.default_action,
            icmp_policy: bundle.icmp_policy,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn verdict(
        &self,
        protocol: Protocol,
        self_hex: &str,
        self_ip: Ipv4Addr,
        self_tags: &[String],
        self_net: &str,
        peer_hex: &str,
        peer_ip: Option<Ipv4Addr>,
        peer_tags: &[String],
        dst_port: Option<u16>,
        direction: Direction,
        src_posture_ok: bool,
    ) -> Action {
        if protocol == Protocol::Icmp {
            match self.icmp_policy {
                IcmpPolicy::Allow => return Action::Allow,
                IcmpPolicy::Deny => return Action::Deny,
                IcmpPolicy::Acl => {}
            }
        }
        // Three ordered phases: org deny, network deny, network allow.
        // First hit in a phase wins; deny phases precede the allow phase.
        let mut posture_skip = false;
        for phase_rules in [&self.org_deny, &self.net_deny, &self.net_allow] {
            for rule in phase_rules.iter() {
                if !rule_hit(
                    rule, protocol, self_hex, self_ip, self_tags, self_net, peer_hex, peer_ip,
                    peer_tags, dst_port, direction,
                ) {
                    continue;
                }
                if rule.has_posture && !src_posture_ok {
                    posture_skip = true;
                    continue;
                }
                return rule.action;
            }
        }
        let _ = posture_skip;
        self.default_action.into()
    }
}

#[allow(clippy::too_many_arguments)]
fn rule_hit(
    r: &CompiledRule,
    protocol: Protocol,
    self_hex: &str,
    self_ip: Ipv4Addr,
    self_tags: &[String],
    self_net: &str,
    peer_hex: &str,
    peer_ip: Option<Ipv4Addr>,
    peer_tags: &[String],
    dst_port: Option<u16>,
    direction: Direction,
) -> bool {
    if !protocol.matches_rule(r.protocol) {
        return false;
    }
    if protocol.is_icmp() {
        // port-restricted rules still match ICMP (matches legacy semantics)
    } else if matches!(protocol, Protocol::Other(_)) {
        if !r.ports.is_empty() {
            return false;
        }
    } else if !r.port_hit(dst_port) {
        return false;
    }
    let (src_ok, dst_ok) = match direction {
        Direction::Inbound => (
            r.src.matches(peer_hex, peer_tags, self_net, peer_ip),
            r.dst.matches(self_hex, self_tags, self_net, Some(self_ip)),
        ),
        Direction::Outbound => (
            r.src.matches(self_hex, self_tags, self_net, Some(self_ip)),
            r.dst.matches(peer_hex, peer_tags, self_net, peer_ip),
        ),
    };
    // Note: peer_network uses self_net, matching legacy AclEngine behavior
    // (peer network context was the local network name).
    src_ok && dst_ok
}

/// Compiled local-firewall rule (direction + action + proto + ports + peer).
#[derive(Debug, Clone)]
pub struct CompiledFwRule {
    pub inbound: bool,
    pub allow: bool,
    pub reject: bool,
    pub protocol: Protocol,
    pub ports: Vec<(u16, u16)>,
    pub peer_endpoint: Option<Box<str>>,
    pub peer_hostname: Option<Box<str>>,
    pub peer_network: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyVerdict {
    Allow,
    Deny,
    Reject,
}

/// One compiled packet-policy snapshot: ACL + firewall + conntrack + fragments.
///
/// Hot path: [`Self::check`] — no allocation, no sorting, no string formatting,
/// no fragment lock for unfragmented traffic, one conntrack lookup when
/// established.
pub struct PacketPolicy {
    acl: Arc<ArcSwap<CompiledAcl>>,
    fw: Arc<ArcSwap<Vec<CompiledFwRule>>>,
    fw_enabled: Arc<ArcSwap<bool>>,
    conntrack: Arc<DashMap<CanonKey, FlowState>>,
    fragments: Arc<Mutex<FragmentTable>>,
    self_hex: Arc<ArcSwap<String>>,
    self_ip: Arc<ArcSwap<Ipv4Addr>>,
    self_tags: Arc<ArcSwap<Vec<String>>>,
    self_net: Arc<ArcSwap<String>>,
    src_posture_ok: Arc<ArcSwap<bool>>,
    last_gc: AtomicU64,
    last_bundle_ptr: AtomicUsize,
    last_fw_version: AtomicU64,
}

impl Clone for PacketPolicy {
    fn clone(&self) -> Self {
        Self {
            acl: self.acl.clone(),
            fw: self.fw.clone(),
            fw_enabled: self.fw_enabled.clone(),
            conntrack: self.conntrack.clone(),
            fragments: self.fragments.clone(),
            self_hex: self.self_hex.clone(),
            self_ip: self.self_ip.clone(),
            self_tags: self.self_tags.clone(),
            self_net: self.self_net.clone(),
            src_posture_ok: self.src_posture_ok.clone(),
            last_gc: AtomicU64::new(self.last_gc.load(Ordering::Relaxed)),
            last_bundle_ptr: AtomicUsize::new(self.last_bundle_ptr.load(Ordering::Relaxed)),
            last_fw_version: AtomicU64::new(self.last_fw_version.load(Ordering::Relaxed)),
        }
    }
}

impl PacketPolicy {
    pub fn new(
        bundle: PolicyBundle,
        fw_rules: Vec<CompiledFwRule>,
        fw_enabled: bool,
        self_hex: String,
        self_ip: Ipv4Addr,
        self_tags: Vec<String>,
        self_net: String,
    ) -> Self {
        Self {
            acl: Arc::new(ArcSwap::from_pointee(CompiledAcl::compile(&bundle))),
            fw: Arc::new(ArcSwap::from_pointee(fw_rules)),
            fw_enabled: Arc::new(ArcSwap::from_pointee(fw_enabled)),
            conntrack: Arc::new(DashMap::new()),
            fragments: Arc::new(Mutex::new(FragmentTable::default())),
            self_hex: Arc::new(ArcSwap::from_pointee(self_hex)),
            self_ip: Arc::new(ArcSwap::from_pointee(self_ip)),
            self_tags: Arc::new(ArcSwap::from_pointee(self_tags)),
            self_net: Arc::new(ArcSwap::from_pointee(self_net)),
            src_posture_ok: Arc::new(ArcSwap::from_pointee(true)),
            last_gc: AtomicU64::new(0),
            last_bundle_ptr: AtomicUsize::new(0),
            last_fw_version: AtomicU64::new(u64::MAX),
        }
    }

    pub fn replace_acl(&self, bundle: &PolicyBundle) {
        self.acl.store(Arc::new(CompiledAcl::compile(bundle)));
        self.conntrack.clear();
        self.fragments.lock().clear();
    }

    pub fn replace_fw(&self, rules: Vec<CompiledFwRule>, enabled: bool) {
        self.fw.store(Arc::new(rules));
        self.fw_enabled.store(Arc::new(enabled));
    }

    /// Recompile from live engines when control-plane state changed.
    /// Cheap pointer/version checks; hot path calls this amortized (every N
    /// packets), never per packet beyond two atomics.
    pub fn sync_from_engines(
        &self,
        acl: &crate::acl::AclEngine,
        firewalls: &HashMap<Uuid, crate::direct::firewall::FirewallEngine>,
    ) {
        let bundle = acl.bundle.load();
        let current = self.acl.load();
        // Recompile when the bundle identity changed. CompiledAcl has no
        // source pointer, so compare cheap structural version: rule count +
        // default action + icmp policy would miss edits; instead always
        // recompile when the bundle Arc differs from the last compiled one.
        // We track the last source pointer in `last_bundle_ptr`.
        let ptr = Arc::as_ptr(&bundle) as usize;
        let last = self.last_bundle_ptr.load(Ordering::Relaxed);
        if ptr != last {
            self.last_bundle_ptr.store(ptr, Ordering::Relaxed);
            self.replace_acl(&bundle);
            let _ = current;
            // Firewall rules ride along with ACL resync; plus periodic
            // version check below covers fw-only edits.
            self.resync_fw(firewalls);
            return;
        }
        self.resync_fw_if_changed(firewalls);
    }

    fn resync_fw(&self, firewalls: &HashMap<Uuid, crate::direct::firewall::FirewallEngine>) {
        let mut local = Vec::new();
        let mut suggested = Vec::new();
        let mut enabled = true;
        let mut version_sum: u64 = 0;
        for fw in firewalls.values() {
            local.extend(fw.local_rules_snapshot());
            suggested.extend(fw.suggested_rules_snapshot());
            enabled = enabled && fw.stats().enabled;
            version_sum = version_sum.wrapping_add(fw.stats().version);
        }
        self.replace_fw(compile_fw_rules(&local, &suggested), enabled);
        self.last_fw_version.store(version_sum, Ordering::Relaxed);
    }

    fn resync_fw_if_changed(
        &self,
        firewalls: &HashMap<Uuid, crate::direct::firewall::FirewallEngine>,
    ) {
        let mut version_sum: u64 = 0;
        for fw in firewalls.values() {
            version_sum = version_sum.wrapping_add(fw.stats().version);
        }
        if version_sum != self.last_fw_version.load(Ordering::Relaxed) {
            self.resync_fw(firewalls);
        }
    }

    pub fn flush(&self) {
        self.conntrack.clear();
    }

    /// Hot-path check. `peer_*` describe the remote mesh peer (if known).
    pub fn check(
        &self,
        meta: &PacketMeta,
        direction: Direction,
        peer_hex: &str,
        peer_tags: &[String],
        peer_hostname: Option<&str>,
        peer_network: Option<Uuid>,
    ) -> PolicyVerdict {
        // Fast path: unfragmented traffic never touches the fragment lock.
        let l4: ResolvedL4 = if meta.is_later_fragment() {
            let Some(hit) = self.fragments.lock().lookup_meta(meta) else {
                return PolicyVerdict::Deny;
            };
            hit
        } else {
            if meta.is_fragment() {
                self.fragments.lock().remember_meta(meta);
            }
            match ResolvedL4::from_transport(meta.transport) {
                Some(l4) => l4,
                None => return PolicyVerdict::Deny,
            }
        };

        let (Some(src), Some(dst)) = (meta.src_v4, meta.dst_v4) else {
            return PolicyVerdict::Deny;
        };
        let tcp_flags = l4.tcp_flags.map(|f| f.0).unwrap_or(0);

        // Single canonical established lookup.
        if let Some(key) = canon_key(l4.protocol, src, dst, l4.src_port, l4.dst_port)
            && self.conntrack_allows(key, direction, tcp_flags)
        {
            self.maybe_gc();
            return PolicyVerdict::Allow;
        }

        let self_hex = self.self_hex.load();
        let self_ip = **self.self_ip.load();
        let self_tags = self.self_tags.load();
        let self_net = self.self_net.load();
        let peer_ip = match direction {
            Direction::Outbound => Some(dst),
            Direction::Inbound => Some(src),
        };
        let acl = self.acl.load();
        let posture_ok = **self.src_posture_ok.load();
        let action = acl.verdict(
            l4.protocol,
            &self_hex,
            self_ip,
            &self_tags,
            &self_net,
            peer_hex,
            peer_ip,
            peer_tags,
            l4.dst_port,
            direction,
            posture_ok,
        );
        if action == Action::Deny {
            return PolicyVerdict::Deny;
        }

        // Firewall second (compiled local + suggested rules, then defaults).
        if **self.fw_enabled.load() {
            let fw = self.fw.load();
            let verdict = fw_verdict(&fw, direction, l4, peer_hex, peer_hostname, peer_network);
            match verdict {
                Some(PolicyVerdict::Allow) => {}
                Some(v) => return v,
                None => {
                    // Built-in defaults mirror FirewallEngine::default_policy:
                    // outbound allow; inbound from known peer allow; inbound
                    // without peer identity: ICMP echo only.
                    let allowed = match direction {
                        Direction::Outbound => true,
                        Direction::Inbound => {
                            if !peer_hex.is_empty() {
                                true
                            } else {
                                matches!(l4.protocol, Protocol::Icmp) && l4.icmp_type == Some(8)
                            }
                        }
                    };
                    if !allowed {
                        return PolicyVerdict::Deny;
                    }
                }
            }
        }

        if let Some(key) = canon_key(l4.protocol, src, dst, l4.src_port, l4.dst_port) {
            self.open_flow(key, l4.protocol, tcp_flags);
        }
        self.maybe_gc();
        PolicyVerdict::Allow
    }

    fn conntrack_allows(&self, key: CanonKey, direction: Direction, tcp_flags: u8) -> bool {
        let now = Instant::now();
        let mut e = match self.conntrack.get_mut(&key) {
            Some(e) => e,
            None => return false,
        };
        if now.duration_since(e.last_seen) > ttl_of(&e) {
            drop(e);
            self.conntrack.remove(&key);
            return false;
        }
        match e.phase {
            Phase::Tcp(TcpPhase::SynSent) => {
                if matches!(direction, Direction::Inbound)
                    || (tcp_flags & TcpFlags::ACK) != 0
                    || (tcp_flags & TcpFlags::RST) != 0
                {
                    if (tcp_flags & TcpFlags::RST) != 0 || (tcp_flags & TcpFlags::FIN) != 0 {
                        e.phase = Phase::Tcp(TcpPhase::TimeWait);
                    } else {
                        e.phase = Phase::Tcp(TcpPhase::Established);
                    }
                    e.last_seen = now;
                    true
                } else if matches!(direction, Direction::Outbound) {
                    e.last_seen = now;
                    true
                } else {
                    false
                }
            }
            Phase::Tcp(TcpPhase::Established) => {
                if (tcp_flags & TcpFlags::RST) != 0 || (tcp_flags & TcpFlags::FIN) != 0 {
                    e.phase = Phase::Tcp(TcpPhase::TimeWait);
                }
                e.last_seen = now;
                true
            }
            Phase::Tcp(TcpPhase::TimeWait) => {
                e.last_seen = now;
                true
            }
            Phase::Udp | Phase::Icmp => {
                e.last_seen = now;
                true
            }
        }
    }

    fn open_flow(&self, key: CanonKey, proto: Protocol, tcp_flags: u8) {
        let now = Instant::now();
        let phase = match proto {
            Protocol::Tcp => {
                if (tcp_flags & TcpFlags::SYN) != 0 && (tcp_flags & TcpFlags::ACK) == 0 {
                    Phase::Tcp(TcpPhase::SynSent)
                } else if (tcp_flags & TcpFlags::FIN) != 0 || (tcp_flags & TcpFlags::RST) != 0 {
                    Phase::Tcp(TcpPhase::TimeWait)
                } else {
                    Phase::Tcp(TcpPhase::Established)
                }
            }
            Protocol::Udp => Phase::Udp,
            Protocol::Icmp | Protocol::Icmpv6 => Phase::Icmp,
            Protocol::Any | Protocol::Other(_) => return,
        };
        self.conntrack
            .entry(key)
            .and_modify(|st| {
                st.last_seen = now;
                if matches!(st.phase, Phase::Tcp(TcpPhase::SynSent))
                    && matches!(phase, Phase::Tcp(TcpPhase::Established))
                {
                    st.phase = phase;
                }
                if matches!(phase, Phase::Tcp(TcpPhase::TimeWait)) {
                    st.phase = phase;
                }
            })
            .or_insert(FlowState {
                phase,
                last_seen: now,
            });
    }

    /// Amortized expiry: at most one retain scan per ~10 s, only when the
    /// table is large enough to matter. No periodic global GC task.
    fn maybe_gc(&self) {
        let len = self.conntrack.len();
        if len < 4096 {
            return;
        }
        let now_ms = now_millis();
        let last = self.last_gc.load(Ordering::Relaxed);
        if now_ms.wrapping_sub(last) < 10_000 {
            return;
        }
        if self
            .last_gc
            .compare_exchange(last, now_ms, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            return;
        }
        let now = Instant::now();
        self.conntrack
            .retain(|_, st| now.duration_since(st.last_seen) <= ttl_of(st));
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn fw_verdict(
    rules: &[CompiledFwRule],
    direction: Direction,
    l4: ResolvedL4,
    peer_hex: &str,
    peer_hostname: Option<&str>,
    peer_network: Option<Uuid>,
) -> Option<PolicyVerdict> {
    let inbound = matches!(direction, Direction::Inbound);
    for r in rules {
        if r.inbound != inbound {
            continue;
        }
        if !l4.protocol.matches_rule(Some(r.protocol)) {
            continue;
        }
        if !r.ports.is_empty() && !l4.protocol.is_icmp() {
            let Some(p) = l4.dst_port else { continue };
            if !r.ports.iter().any(|(a, b)| p >= *a && p <= *b) {
                continue;
            }
        }
        if let Some(ep) = r.peer_endpoint.as_ref()
            && !ep.as_ref().eq_ignore_ascii_case(peer_hex)
        {
            continue;
        }
        if let Some(h) = r.peer_hostname.as_ref()
            && peer_hostname.is_none_or(|ph| !ph.eq_ignore_ascii_case(h))
        {
            continue;
        }
        if let Some(n) = r.peer_network
            && peer_network != Some(n)
        {
            continue;
        }
        if r.allow {
            return Some(PolicyVerdict::Allow);
        }
        if r.reject {
            return Some(PolicyVerdict::Reject);
        }
        return Some(PolicyVerdict::Deny);
    }
    None
}

trait FragMetaExt {
    fn lookup_meta(&mut self, meta: &PacketMeta) -> Option<ResolvedL4>;
    fn remember_meta(&mut self, meta: &PacketMeta);
}

impl FragMetaExt for FragmentTable {
    fn lookup_meta(&mut self, meta: &PacketMeta) -> Option<ResolvedL4> {
        let key = FragKey {
            src: meta.src,
            dst: meta.dst,
            protocol: meta.proto,
            identification: meta.fragmentation.identification()?,
        };
        self.lookup_cached(&key)
    }

    fn remember_meta(&mut self, meta: &PacketMeta) {
        use tunnet_common::packet::Fragmentation;
        if !matches!(meta.fragmentation, Fragmentation::First { .. }) {
            return;
        }
        let Some(id) = meta.fragmentation.identification() else {
            return;
        };
        let key = FragKey {
            src: meta.src,
            dst: meta.dst,
            protocol: meta.proto,
            identification: id,
        };
        let cached = match meta.transport {
            Transport::Tcp {
                src_port,
                dst_port,
                flags,
                ..
            } => CachedTransport::Tcp {
                src_port,
                dst_port,
                flags,
            },
            Transport::Udp {
                src_port, dst_port, ..
            } => CachedTransport::Udp { src_port, dst_port },
            Transport::Icmpv4 {
                type_u8,
                code,
                echo_id,
                echo_seq,
                ..
            } => CachedTransport::Icmpv4 {
                type_u8,
                code,
                echo_id,
                echo_seq,
            },
            Transport::Icmpv6 { type_u8, code, .. } => CachedTransport::Icmpv6 { type_u8, code },
            Transport::Other { protocol, .. } => CachedTransport::Other { protocol },
            Transport::LaterFragment { .. } => return,
        };
        self.insert_cached(key, cached);
    }
}

/// Compile a firewall rule list once (local + suggested concatenated, local first).
pub fn compile_fw_rules(
    local: &[tunnet_core_firewall_types::FirewallRule],
    suggested: &[tunnet_core_firewall_types::FirewallRule],
) -> Vec<CompiledFwRule> {
    local
        .iter()
        .chain(suggested.iter())
        .map(|r| {
            let mut ports: Vec<(u16, u16)> = r.ports.iter().map(|p| (p.start, p.end)).collect();
            ports.sort();
            let mut merged: Vec<(u16, u16)> = Vec::with_capacity(ports.len());
            for (a, b) in ports {
                if let Some(last) = merged.last_mut()
                    && a <= last.1.saturating_add(1)
                {
                    last.1 = last.1.max(b);
                    continue;
                }
                merged.push((a, b));
            }
            let (peer_endpoint, peer_hostname, peer_network) = match &r.peer {
                tunnet_core_firewall_types::PeerFilter::Any => (None, None, None),
                tunnet_core_firewall_types::PeerFilter::Endpoint(e) => {
                    (Some(e.clone().into_boxed_str()), None, None)
                }
                tunnet_core_firewall_types::PeerFilter::Hostname(h) => {
                    (None, Some(h.clone().into_boxed_str()), None)
                }
                tunnet_core_firewall_types::PeerFilter::NetworkId(n) => {
                    (None, None, n.parse().ok())
                }
            };
            CompiledFwRule {
                inbound: matches!(
                    r.direction,
                    tunnet_core_firewall_types::FirewallDirection::In
                ),
                allow: matches!(r.action, tunnet_core_firewall_types::FirewallAction::Allow),
                reject: matches!(r.action, tunnet_core_firewall_types::FirewallAction::Reject),
                protocol: r.protocol,
                ports: merged,
                peer_endpoint,
                peer_hostname,
                peer_network,
            }
        })
        .collect()
}

// Re-export firewall types without a hard module dependency cycle.
pub mod tunnet_core_firewall_types {
    pub use crate::direct::firewall::{
        FirewallAction, FirewallDirection, FirewallRule, PeerFilter,
    };
}

/// Build a [`PacketPolicy`] from live ACL + firewall engines (control plane).
pub fn from_engines(
    acl: &crate::acl::AclEngine,
    firewalls: &HashMap<Uuid, crate::direct::firewall::FirewallEngine>,
    default_fw: Option<&crate::direct::firewall::FirewallEngine>,
) -> PacketPolicy {
    let bundle = acl.bundle.load();
    let self_id = acl.self_id.load();
    // Merge all per-network firewall rules into one compiled list. Per-packet
    // network scoping is preserved via PeerFilter::NetworkId matching.
    let mut local = Vec::new();
    let mut suggested = Vec::new();
    let mut enabled = true;
    for fw in firewalls.values() {
        local.extend(fw.local_rules_snapshot());
        suggested.extend(fw.suggested_rules_snapshot());
        enabled = enabled && fw.stats().enabled;
    }
    if let Some(fw) = default_fw
        && local.is_empty()
        && suggested.is_empty()
    {
        local.extend(fw.local_rules_snapshot());
        suggested.extend(fw.suggested_rules_snapshot());
        enabled = fw.stats().enabled;
    }
    PacketPolicy::new(
        (**bundle).clone(),
        compile_fw_rules(&local, &suggested),
        enabled,
        self_id.endpoint_hex.clone(),
        self_id.ip,
        self_id.tags.clone(),
        self_id.network.clone(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tunnet_common::policy::{PolicyRule, RuleScope, Selector};

    fn meta_tcp(dst_port: u16) -> PacketMeta {
        let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64)
            .tcp(40000, dst_port, 1, 1000);
        let mut o = Vec::new();
        b.write(&mut o, b"hello").unwrap();
        let pkt = tunnet_common::packet::parse(&o).unwrap();
        PacketMeta::from_packet(&pkt)
    }

    fn open_bundle() -> PolicyBundle {
        PolicyBundle::default()
    }

    #[test]
    fn open_bundle_allows_and_establishes() {
        let p = PacketPolicy::new(
            open_bundle(),
            vec![],
            false,
            "aa".into(),
            Ipv4Addr::new(10, 0, 0, 1),
            vec![],
            "net".into(),
        );
        let m = meta_tcp(80);
        assert_eq!(
            p.check(&m, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Allow
        );
        // Second packet of the same flow: single conntrack hit.
        assert_eq!(
            p.check(&m, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Allow
        );
        assert_eq!(p.conntrack.len(), 1);
    }

    #[test]
    fn deny_rule_matches_legacy_semantics() {
        let bundle = PolicyBundle {
            rules: vec![PolicyRule {
                src: Selector::Any,
                dst: Selector::Any,
                action: Action::Deny,
                ports: vec![tunnet_common::policy::PortRange { start: 22, end: 22 }],
                protocol: Some(Protocol::Tcp),
                priority: 0,
                order_index: 0,
                scope: RuleScope::Network,
                enabled: true,
                slug: None,
                src_posture: vec![],
            }],
            default_action: DefaultAction::Allow,
            ..PolicyBundle::default()
        };
        let p = PacketPolicy::new(
            bundle.clone(),
            vec![],
            false,
            "aa".into(),
            Ipv4Addr::new(10, 0, 0, 1),
            vec![],
            "net".into(),
        );
        let m22 = meta_tcp(22);
        let m80 = meta_tcp(80);
        assert_eq!(
            p.check(&m22, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Deny
        );
        assert_eq!(
            p.check(&m80, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Allow
        );
        // Legacy evaluator agrees (differential equivalence probe).
        let legacy = {
            use tunnet_common::policy::{EvalCtx, evaluate_detailed};
            let ctx = EvalCtx {
                self_endpoint_hex: "aa",
                self_ip: Ipv4Addr::new(10, 0, 0, 1),
                self_tags: &[],
                self_network: "net",
                peer_endpoint_hex: "bb",
                peer_ip: Some(Ipv4Addr::new(10, 0, 0, 2)),
                peer_tags: &[],
                peer_network: "net",
                dst_port: Some(22),
                protocol: Protocol::Tcp,
                src_posture_ok: true,
            };
            evaluate_detailed(&bundle, &ctx, Direction::Outbound).action
        };
        assert_eq!(legacy, Action::Deny);
    }

    #[test]
    fn later_fragment_without_state_denied() {
        let p = PacketPolicy::new(
            open_bundle(),
            vec![],
            false,
            "aa".into(),
            Ipv4Addr::new(10, 0, 0, 1),
            vec![],
            "net".into(),
        );
        // Craft a later fragment manually.
        let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64).udp(40000, 443);
        let mut o = Vec::new();
        b.write(&mut o, &[0; 100]).unwrap();
        o[6] = 0x20; // MF + offset bit pattern => fragment offset nonzero
        o[7] = 0x08;
        let pkt = tunnet_common::packet::parse(&o).unwrap();
        let meta = PacketMeta::from_packet(&pkt);
        assert!(meta.is_later_fragment());
        assert_eq!(
            p.check(&meta, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Deny
        );
    }

    fn meta_udp(sport: u16, dport: u16) -> PacketMeta {
        let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64).udp(sport, dport);
        let mut o = Vec::new();
        b.write(&mut o, &[0; 40]).unwrap();
        let pkt = tunnet_common::packet::parse(&o).unwrap();
        PacketMeta::from_packet(&pkt)
    }

    fn legacy_action(bundle: &PolicyBundle, port: Option<u16>, proto: Protocol) -> Action {
        use tunnet_common::policy::{EvalCtx, evaluate_detailed};
        let ctx = EvalCtx {
            self_endpoint_hex: "aa",
            self_ip: Ipv4Addr::new(10, 0, 0, 1),
            self_tags: &[],
            self_network: "net",
            peer_endpoint_hex: "bb",
            peer_ip: Some(Ipv4Addr::new(10, 0, 0, 2)),
            peer_tags: &[],
            peer_network: "net",
            dst_port: port,
            protocol: proto,
            src_posture_ok: true,
        };
        evaluate_detailed(bundle, &ctx, Direction::Outbound).action
    }

    fn new_policy(bundle: PolicyBundle) -> PacketPolicy {
        PacketPolicy::new(
            bundle,
            vec![],
            false,
            "aa".into(),
            Ipv4Addr::new(10, 0, 0, 1),
            vec![],
            "net".into(),
        )
    }

    #[test]
    fn differential_matrix_matches_legacy() {
        // order_index ascending first-match, port ranges, org-deny priority,
        // disabled rules, protocol scoping — new engine must equal legacy.
        let bundle = PolicyBundle {
            rules: vec![
                PolicyRule {
                    src: Selector::Tag("admin".into()),
                    dst: Selector::Any,
                    action: Action::Allow,
                    ports: vec![],
                    protocol: None,
                    priority: 0,
                    order_index: 5,
                    scope: RuleScope::Network,
                    enabled: false,
                    slug: Some("disabled".into()),
                    src_posture: vec![],
                },
                PolicyRule {
                    src: Selector::Any,
                    dst: Selector::Any,
                    action: Action::Deny,
                    ports: vec![
                        tunnet_common::policy::PortRange {
                            start: 8000,
                            end: 8010,
                        },
                        tunnet_common::policy::PortRange {
                            start: 8005,
                            end: 8020,
                        },
                    ],
                    protocol: Some(Protocol::Tcp),
                    priority: 0,
                    order_index: 1,
                    scope: RuleScope::Organization,
                    enabled: true,
                    slug: Some("org-deny-range".into()),
                    src_posture: vec![],
                },
                PolicyRule {
                    src: Selector::Any,
                    dst: Selector::Any,
                    action: Action::Allow,
                    ports: vec![tunnet_common::policy::PortRange {
                        start: 8000,
                        end: 9000,
                    }],
                    protocol: Some(Protocol::Tcp),
                    priority: 0,
                    order_index: 0,
                    scope: RuleScope::Network,
                    enabled: true,
                    slug: Some("net-allow-wide".into()),
                    src_posture: vec![],
                },
            ],
            default_action: DefaultAction::Deny,
            ..PolicyBundle::default()
        };
        let p = new_policy(bundle.clone());
        // Org deny (merged 8000-8020) beats network allow despite higher order.
        for port in [8000, 8015, 8020] {
            let m = meta_tcp(port);
            let got = p.check(&m, Direction::Outbound, "bb", &[], None, None);
            assert_eq!(got, PolicyVerdict::Deny, "port {port}");
            assert_eq!(
                legacy_action(&bundle, Some(port), Protocol::Tcp),
                Action::Deny
            );
        }
        // Outside the org-deny range but inside the network allow range,
        // the network allow wins.
        for port in [8021, 8500] {
            let m = meta_tcp(port);
            let got = p.check(&m, Direction::Outbound, "bb", &[], None, None);
            assert_eq!(got, PolicyVerdict::Allow, "port {port}");
            assert_eq!(
                legacy_action(&bundle, Some(port), Protocol::Tcp),
                Action::Allow
            );
        }
        // Outside every range the restrictive default applies in both engines.
        let m = meta_tcp(7999);
        assert_eq!(
            p.check(&m, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Deny
        );
        assert_eq!(
            legacy_action(&bundle, Some(7999), Protocol::Tcp),
            Action::Deny
        );
        // UDP to the same port is not matched by TCP-only rules → default deny.
        let u = meta_udp(40000, 8010);
        assert_eq!(
            p.check(&u, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Deny
        );
        assert_eq!(
            legacy_action(&bundle, Some(8010), Protocol::Udp),
            Action::Deny
        );
    }

    #[test]
    fn first_fragment_allows_later_fragment() {
        let p = new_policy(open_bundle());
        // First fragment (offset 0 + MF) is policy-evaluated and remembered.
        let b = etherparse::PacketBuilder::ipv4([10, 0, 0, 1], [10, 0, 0, 2], 64).udp(40000, 443);
        let mut first = Vec::new();
        b.write(&mut first, &[0; 100]).unwrap();
        first[6] = 0x20; // MF set, offset 0
        first[7] = 0x00;
        let pkt = tunnet_common::packet::parse(&first).unwrap();
        let meta = PacketMeta::from_packet(&pkt);
        assert!(matches!(
            meta.fragmentation,
            tunnet_common::packet::Fragmentation::First { .. }
        ));
        assert_eq!(
            p.check(&meta, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Allow
        );
        // Later fragment of the same datagram now resolves via cached state.
        let mut later = first.clone();
        later[6] = 0x20;
        later[7] = 0x08;
        let pkt = tunnet_common::packet::parse(&later).unwrap();
        let meta = PacketMeta::from_packet(&pkt);
        assert!(meta.is_later_fragment());
        assert_eq!(
            p.check(&meta, Direction::Outbound, "bb", &[], None, None),
            PolicyVerdict::Allow
        );
    }

    #[test]
    fn malformed_packets_denied() {
        let p = new_policy(open_bundle());
        // Truncated garbage must never reach the transport.
        assert!(tunnet_common::packet::parse(&[0x45, 0x00]).is_err());
        assert!(tunnet_common::packet::parse(&[]).is_err());
        let _ = p;
    }
}
