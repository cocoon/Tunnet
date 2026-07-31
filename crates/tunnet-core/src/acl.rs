use std::collections::VecDeque;
use std::net::Ipv4Addr;
use std::sync::Arc;

use arc_swap::ArcSwap;
use parking_lot::Mutex;
use serde::Serialize;
use tunnet_common::policy::{
    Action, Direction, EvalCtx, EvalReason, EvalVerdict, PolicyBundle, Protocol, evaluate_detailed,
};

use crate::routing::{PeerInfo, RoutingTable};

const DENY_LOG_CAP: usize = 64;

#[derive(Debug, Clone)]
pub struct SelfIdentity {
    pub endpoint_hex: String,
    pub ip: Ipv4Addr,
    pub tags: Vec<String>,
    pub network: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AclDenyRecord {
    pub peer_endpoint: String,
    pub dst_port: Option<u16>,
    pub protocol: String,
    pub reason: String,
    pub rule_slug: Option<String>,
    pub scope: Option<String>,
    pub at_unix: i64,
}

#[derive(Clone)]
pub struct AclEngine {
    pub self_id: Arc<ArcSwap<SelfIdentity>>,
    pub routes: RoutingTable,
    pub bundle: Arc<ArcSwap<PolicyBundle>>,
    pub stale: Arc<ArcSwap<bool>>,
    /// When false, ACL rules that require source posture do not match.
    pub src_posture_ok: Arc<ArcSwap<bool>>,
    deny_log: Arc<Mutex<VecDeque<AclDenyRecord>>>,
}

impl AclEngine {
    pub fn new(self_id: SelfIdentity, routes: RoutingTable, bundle: PolicyBundle) -> Self {
        Self::with_posture_flag(
            self_id,
            routes,
            bundle,
            Arc::new(ArcSwap::from_pointee(true)),
        )
    }

    pub fn with_posture_flag(
        self_id: SelfIdentity,
        routes: RoutingTable,
        bundle: PolicyBundle,
        src_posture_ok: Arc<ArcSwap<bool>>,
    ) -> Self {
        Self {
            self_id: Arc::new(ArcSwap::from_pointee(self_id)),
            routes,
            bundle: Arc::new(ArcSwap::from_pointee(bundle)),
            stale: Arc::new(ArcSwap::from_pointee(false)),
            src_posture_ok,
            deny_log: Arc::new(Mutex::new(VecDeque::with_capacity(DENY_LOG_CAP))),
        }
    }

    pub fn set_src_posture_ok(&self, ok: bool) {
        self.src_posture_ok.store(Arc::new(ok));
    }

    pub fn replace_bundle(&self, b: PolicyBundle) {
        self.bundle.store(Arc::new(b));
        self.stale.store(Arc::new(false));
    }

    pub fn replace_self_tags(&self, tags: Vec<String>) {
        let current = self.self_id.load();
        if current.tags == tags {
            return;
        }
        self.self_id.store(Arc::new(SelfIdentity {
            endpoint_hex: current.endpoint_hex.clone(),
            ip: current.ip,
            tags,
            network: current.network.clone(),
        }));
    }

    pub fn mark_stale(&self) {
        self.stale.store(Arc::new(true));
    }

    pub fn recent_denies(&self) -> Vec<AclDenyRecord> {
        self.deny_log.lock().iter().cloned().collect()
    }

    pub fn allow_inbound_peer(&self, peer_endpoint_hex: &str) -> bool {
        self.allow_peer(peer_endpoint_hex, Direction::Inbound)
    }

    pub fn allow_outbound_peer(&self, peer_endpoint_hex: &str) -> bool {
        self.allow_peer(peer_endpoint_hex, Direction::Outbound)
    }

    pub fn allow_peer(&self, peer_endpoint_hex: &str, direction: Direction) -> bool {
        let peer = self.routes.lookup_endpoint(peer_endpoint_hex);
        self.check(
            peer.as_deref(),
            peer_endpoint_hex,
            None,
            None,
            Protocol::Any,
            direction,
        )
        .action
            == Action::Allow
    }

    pub fn allow_packet(
        &self,
        peer_endpoint_hex: &str,
        peer_ip: Option<Ipv4Addr>,
        dst_port: Option<u16>,
        proto: Protocol,
        direction: Direction,
    ) -> bool {
        let peer = self.routes.lookup_endpoint(peer_endpoint_hex);
        let verdict = self.check(
            peer.as_deref(),
            peer_endpoint_hex,
            peer_ip,
            dst_port,
            proto,
            direction,
        );
        verdict.action == Action::Allow
    }

    /// Like [`allow_packet`] but returns the full verdict for explain/debug.
    pub fn evaluate_packet(
        &self,
        peer_endpoint_hex: &str,
        peer_ip: Option<Ipv4Addr>,
        dst_port: Option<u16>,
        proto: Protocol,
        direction: Direction,
    ) -> EvalVerdict {
        let peer = self.routes.lookup_endpoint(peer_endpoint_hex);
        self.check(
            peer.as_deref(),
            peer_endpoint_hex,
            peer_ip,
            dst_port,
            proto,
            direction,
        )
    }

    fn check(
        &self,
        peer: Option<&PeerInfo>,
        peer_hex: &str,
        peer_ip: Option<Ipv4Addr>,
        dst_port: Option<u16>,
        proto: Protocol,
        direction: Direction,
    ) -> EvalVerdict {
        let empty_tags: Vec<String> = Vec::new();
        let self_id = self.self_id.load();
        let bundle = self.bundle.load();
        let posture_required = !bundle.default_src_posture.is_empty()
            || bundle.rules.iter().any(|r| !r.src_posture.is_empty());
        let src_posture_ok = if posture_required {
            **self.src_posture_ok.load()
        } else {
            true
        };
        let ctx = EvalCtx {
            self_endpoint_hex: &self_id.endpoint_hex,
            self_ip: self_id.ip,
            self_tags: &self_id.tags,
            self_network: &self_id.network,
            peer_endpoint_hex: peer_hex,
            peer_ip: peer_ip.or_else(|| peer.map(|p| p.ip)),
            peer_tags: peer.map(|p| p.tags.as_slice()).unwrap_or(&empty_tags),
            peer_network: &self_id.network,
            dst_port,
            protocol: proto,
            src_posture_ok,
        };
        let verdict = evaluate_detailed(&bundle, &ctx, direction);
        if verdict.action == Action::Deny {
            // Fail-open only for open networks with no rules during poll outage.
            if **self.stale.load()
                && bundle.rules.is_empty()
                && bundle.default_action == tunnet_common::policy::DefaultAction::Allow
            {
                return EvalVerdict {
                    action: Action::Allow,
                    reason: EvalReason::DefaultAllow,
                    rule_slug: None,
                    scope: None,
                };
            }
            self.record_deny(peer_hex, dst_port, proto, &verdict);
            tracing::debug!(
                peer = %peer_hex,
                ?dst_port,
                ?proto,
                reason = ?verdict.reason,
                slug = ?verdict.rule_slug,
                "ACL deny"
            );
        }
        verdict
    }

    fn record_deny(
        &self,
        peer_hex: &str,
        dst_port: Option<u16>,
        proto: Protocol,
        verdict: &EvalVerdict,
    ) {
        let reason = match verdict.reason {
            EvalReason::OrgDeny => "org_deny",
            EvalReason::NetworkDeny => "network_deny",
            EvalReason::NetworkAllow => "network_allow",
            EvalReason::DefaultAllow => "default_allow",
            EvalReason::DefaultDeny => "default_deny",
            EvalReason::IcmpPolicy => "icmp_policy",
            EvalReason::PostureSkip => "posture_skip",
        };
        let scope = verdict.scope.map(|s| match s {
            tunnet_common::policy::RuleScope::Organization => "organization".to_string(),
            tunnet_common::policy::RuleScope::Network => "network".to_string(),
        });
        let record = AclDenyRecord {
            peer_endpoint: peer_hex.to_string(),
            dst_port,
            protocol: format!("{proto:?}").to_lowercase(),
            reason: reason.to_string(),
            rule_slug: verdict.rule_slug.clone(),
            scope,
            at_unix: chrono::Utc::now().timestamp(),
        };
        let mut log = self.deny_log.lock();
        if log.len() >= DENY_LOG_CAP {
            log.pop_front();
        }
        log.push_back(record);
    }
}
