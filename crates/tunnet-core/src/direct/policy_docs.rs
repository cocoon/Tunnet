//! Coordinator firewall policy distribution via iroh-docs.
//!
//! Signed with Ed25519 by the network coordinator.

use std::collections::HashMap;

use anyhow::Context;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use super::firewall::FirewallRule;

pub const POLICY_BUNDLE_KEY: &str = "policy/v1/bundle";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyBundleDoc {
    pub version: u64,
    pub timestamp: Timestamp,
    pub global: Vec<FirewallRule>,
    pub by_hostname: HashMap<String, Vec<FirewallRule>>,
    pub sig: String,
}

/// Atomic policy bundle stored in docs (alias for callers).
pub type SuggestedPolicy = PolicyBundleDoc;

#[derive(Serialize)]
struct PolicyBundleSignPayload<'a> {
    version: u64,
    timestamp: Timestamp,
    global: &'a [FirewallRule],
    by_hostname: &'a HashMap<String, Vec<FirewallRule>>,
}

fn policy_bundle_sign_payload(bundle: &PolicyBundleDoc) -> anyhow::Result<Vec<u8>> {
    Ok(serde_json::to_vec(&PolicyBundleSignPayload {
        version: bundle.version,
        timestamp: bundle.timestamp,
        global: &bundle.global,
        by_hostname: &bundle.by_hostname,
    })?)
}

pub fn sign_policy_bundle(
    sk: &SigningKey,
    version: u64,
    timestamp: Timestamp,
    global: Vec<FirewallRule>,
    by_hostname: HashMap<String, Vec<FirewallRule>>,
) -> anyhow::Result<PolicyBundleDoc> {
    let mut bundle = PolicyBundleDoc {
        version,
        timestamp,
        global,
        by_hostname,
        sig: String::new(),
    };
    let payload = policy_bundle_sign_payload(&bundle)?;
    bundle.sig = hex::encode(sk.sign(&payload).to_bytes());
    Ok(bundle)
}

pub fn verify_policy_bundle(vk: &VerifyingKey, bundle: &PolicyBundleDoc) -> anyhow::Result<()> {
    let payload = policy_bundle_sign_payload(bundle)?;
    let sig_bytes = hex::decode(bundle.sig.trim()).context("invalid policy signature hex")?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("policy signature must be 64 bytes"))?;
    let sig = ed25519_dalek::Signature::from_bytes(&sig_arr);
    vk.verify(&payload, &sig)
        .map_err(|_| anyhow::anyhow!("invalid policy bundle signature"))
}

/// Rules that apply to a given hostname (global + host-specific).
pub fn effective_suggested(policy: &PolicyBundleDoc, hostname: &str) -> Vec<FirewallRule> {
    let mut rules = policy.global.clone();
    if let Some(host_rules) = policy.by_hostname.get(hostname) {
        rules.extend(host_rules.iter().cloned());
    }
    rules
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingSuggestion {
    pub received_at: Timestamp,
    pub policy: PolicyBundleDoc,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::direct::firewall::{FirewallAction, FirewallDirection, PeerFilter};
    use ed25519_dalek::SigningKey;
    use tunnet_common::policy::Protocol;

    #[test]
    fn sign_verify_roundtrip() {
        let sk = SigningKey::generate(&mut rand::rng());
        let vk = sk.verifying_key();
        let mut by = HashMap::new();
        by.insert(
            "alice".into(),
            vec![FirewallRule {
                direction: FirewallDirection::In,
                action: FirewallAction::Allow,
                protocol: Protocol::Tcp,
                ports: vec![],
                peer: PeerFilter::Any,
            }],
        );
        let bundle =
            sign_policy_bundle(&sk, 1, "2026-01-01T00:00:00Z".parse().unwrap(), vec![], by)
                .unwrap();
        verify_policy_bundle(&vk, &bundle).unwrap();
    }

    #[test]
    fn forged_signature_rejected() {
        let sk = SigningKey::generate(&mut rand::rng());
        let other = SigningKey::generate(&mut rand::rng());
        let vk = sk.verifying_key();
        let bundle = sign_policy_bundle(
            &sk,
            1,
            "2026-01-01T00:00:00Z".parse().unwrap(),
            vec![],
            HashMap::new(),
        )
        .unwrap();
        assert!(verify_policy_bundle(&other.verifying_key(), &bundle).is_err());
        let mut tampered = bundle.clone();
        tampered.version = 99;
        assert!(verify_policy_bundle(&vk, &tampered).is_err());
    }
}
