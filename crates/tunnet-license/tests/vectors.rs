//! Golden vectors from `packages/license/test/vectors.json` (if present).

use std::collections::HashSet;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use tunnet_license::keyring::{KeyStatus, Keyring, TrustedKey};
use tunnet_license::{
    LicenseFailureCode, LicenseTier, RuntimeStatus, VerifyOptions, verify_license_token,
};

#[derive(Debug, Deserialize)]
struct VectorsFile {
    #[serde(default)]
    now: Option<i64>,
    #[serde(default)]
    cases: Vec<VectorCase>,
    #[serde(default)]
    keys: Vec<VectorKey>,
}

#[derive(Debug, Deserialize)]
struct VectorKey {
    kid: String,
    #[serde(alias = "publicKeyHex", alias = "public_key_hex")]
    public_key_hex: String,
    #[serde(default, alias = "validFrom")]
    valid_from: Option<i64>,
    #[serde(default, alias = "validUntil")]
    valid_until: Option<Option<i64>>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VectorCase {
    name: String,
    token: String,
    #[serde(default)]
    now: Option<i64>,
    #[serde(default)]
    skew: Option<i64>,
    #[serde(default)]
    audience: Option<String>,
    #[serde(default)]
    expected_issuer: Option<String>,
    #[serde(default)]
    revoked: Option<Vec<String>>,
    /// gen-vectors uses `expect`; accept `expected` too.
    #[serde(default, alias = "expect")]
    expected: Option<Value>,
}

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/license/test/vectors.json")
}

fn key_status(s: Option<&str>) -> KeyStatus {
    match s.unwrap_or("active") {
        "retired" => KeyStatus::Retired,
        "compromised" => KeyStatus::Compromised,
        _ => KeyStatus::Active,
    }
}

fn build_keyring(keys: &[VectorKey]) -> Keyring {
    if keys.is_empty() {
        return Keyring::default_tunnet();
    }
    let parsed: Vec<TrustedKey> = keys
        .iter()
        .map(|k| {
            let until = k.valid_until.flatten();
            TrustedKey::from_hex(
                &k.kid,
                &k.public_key_hex,
                jiff::Timestamp::from_second(k.valid_from.unwrap_or(0)).unwrap(),
                until.map(|seconds| jiff::Timestamp::from_second(seconds).unwrap()),
                key_status(k.status.as_deref()),
            )
            .unwrap_or_else(|e| panic!("bad vector key {}: {e}", k.kid))
        })
        .collect();
    Keyring::new(parsed).expect("vector keyring")
}

fn parse_failure_code(s: &str) -> Option<LicenseFailureCode> {
    match s {
        "not_configured" => Some(LicenseFailureCode::NotConfigured),
        "source_unavailable" => Some(LicenseFailureCode::SourceUnavailable),
        "too_large" => Some(LicenseFailureCode::TooLarge),
        "malformed" => Some(LicenseFailureCode::Malformed),
        "unsupported_format" => Some(LicenseFailureCode::UnsupportedFormat),
        "unknown_key" => Some(LicenseFailureCode::UnknownKey),
        "key_revoked" => Some(LicenseFailureCode::KeyRevoked),
        "alg_mismatch" => Some(LicenseFailureCode::AlgMismatch),
        "bad_signature" => Some(LicenseFailureCode::BadSignature),
        "unsupported_claim" => Some(LicenseFailureCode::UnsupportedClaim),
        "invalid_claims" => Some(LicenseFailureCode::InvalidClaims),
        "issuer_mismatch" => Some(LicenseFailureCode::IssuerMismatch),
        "audience_mismatch" => Some(LicenseFailureCode::AudienceMismatch),
        "not_yet_valid" => Some(LicenseFailureCode::NotYetValid),
        "expired" => Some(LicenseFailureCode::Expired),
        "revoked" => Some(LicenseFailureCode::Revoked),
        "clock_rollback" => Some(LicenseFailureCode::ClockRollback),
        _ => None,
    }
}

fn parse_tier(s: &str) -> Option<LicenseTier> {
    match s {
        "community" => Some(LicenseTier::Community),
        "cloud" => Some(LicenseTier::Cloud),
        "enterprise" => Some(LicenseTier::Enterprise),
        _ => None,
    }
}

#[test]
fn golden_vectors() {
    let path = vectors_path();
    if !path.is_file() {
        eprintln!(
            "skipping golden vectors: {} not found (run packages/license vectors script)",
            path.display()
        );
        return;
    }

    let text = std::fs::read_to_string(&path).expect("read vectors.json");
    let file: VectorsFile = serde_json::from_str(&text).expect("parse vectors.json");
    let keyring = build_keyring(&file.keys);
    let default_now = file.now.unwrap_or(0);

    for case in &file.cases {
        let Some(expected) = case.expected.as_ref() else {
            eprintln!("case {}: missing expect/expected; skipping", case.name);
            continue;
        };

        let now = case.now.unwrap_or(default_now);
        let mut opts = VerifyOptions::new(
            &keyring,
            jiff::Timestamp::from_second(now).expect("test timestamp is in range"),
        );
        if let Some(skew) = case.skew {
            opts.clock_skew = jiff::SignedDuration::from_secs(skew);
        }
        opts.audience = case.audience.as_deref();
        opts.expected_issuer = case.expected_issuer.as_deref();
        let revoked: Option<HashSet<String>> =
            case.revoked.as_ref().map(|v| v.iter().cloned().collect());
        opts.revoked_ids = revoked.as_ref();

        let result = verify_license_token(&case.token, opts);

        let ok = expected
            .get("ok")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if ok {
            let (license, status) = result.unwrap_or_else(|e| {
                panic!(
                    "case {}: expected ok, got {:?} ({})",
                    case.name, e.code, e.message
                )
            });
            if let Some(want_status) = expected.get("status").and_then(|v| v.as_str()) {
                let got = match status {
                    RuntimeStatus::Active => "active",
                    RuntimeStatus::Grace => "grace",
                };
                assert_eq!(got, want_status, "case {} status", case.name);
            }
            if let Some(tier) = expected.get("tier").and_then(|v| v.as_str()) {
                let want = parse_tier(tier).unwrap_or_else(|| panic!("bad tier {tier}"));
                assert_eq!(license.tier, want, "case {} tier", case.name);
            }
        } else {
            let err = result.expect_err(&format!("case {}: expected failure", case.name));
            if let Some(code) = expected
                .get("code")
                .and_then(|v| v.as_str())
                .and_then(parse_failure_code)
            {
                assert_eq!(err.code, code, "case {} code", case.name);
            }
        }
    }
}
