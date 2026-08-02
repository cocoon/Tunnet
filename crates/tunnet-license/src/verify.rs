//! tnlic1 license token verification (mirrors `@tunnet/license` verify.ts).

use std::collections::{HashMap, HashSet};

use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{LicenseError, LicenseFailureCode};
use crate::features::{Feature, FeatureMap, LicenseTier, Limit, LimitMap};
use crate::keyring::{KeyStatus, Keyring, TrustedKey};
use crate::token::{LICENSE_TYP, b64u_encode, decode_token};

pub const DEFAULT_CLOCK_SKEW_SEC: i64 = 300;

/// Critical header claims this runtime understands.
const UNDERSTOOD_CRIT: &[&str] = &["aud", "limits"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct License {
    pub jti: String,
    pub iss: String,
    pub sub: String,
    pub aud: Vec<String>,
    pub tier: LicenseTier,
    pub features: FeatureMap,
    pub limits: LimitMap,
    pub iat: i64,
    pub nbf: i64,
    pub exp: i64,
    pub grace: i64,
    pub meta: HashMap<String, String>,
    pub kid: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeStatus {
    Active,
    Grace,
}

#[derive(Debug, Clone)]
pub struct VerifyOptions<'a> {
    pub keyring: &'a Keyring,
    pub now: i64,
    pub clock_skew_sec: i64,
    /// Deployment fingerprint; `None` skips aud check when license has empty aud.
    pub audience: Option<&'a str>,
    pub expected_issuer: Option<&'a str>,
    pub revoked_ids: Option<&'a HashSet<String>>,
}

impl<'a> VerifyOptions<'a> {
    pub fn new(keyring: &'a Keyring, now: i64) -> Self {
        Self {
            keyring,
            now,
            clock_skew_sec: DEFAULT_CLOCK_SKEW_SEC,
            audience: None,
            expected_issuer: None,
            revoked_ids: None,
        }
    }
}

pub type VerifyResult = Result<(License, RuntimeStatus), LicenseError>;

fn fail(code: LicenseFailureCode, message: impl Into<String>) -> LicenseError {
    LicenseError::new(code, message)
}

/// `aud` holds a hash, not the raw deployment id.
pub fn deployment_fingerprint(deployment_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"tunnet-deployment-v1\0");
    hasher.update(deployment_id.as_bytes());
    let digest = hasher.finalize();
    let encoded = b64u_encode(&digest);
    encoded.chars().take(22).collect()
}

fn int_claim(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().filter(|i| {
            // Match JS Number.isSafeInteger roughly: fit in i64 and exact.
            *i >= -(1i64 << 53) && *i <= (1i64 << 53)
        }),
        _ => None,
    }
}

fn str_claim(v: &Value, max: usize) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() && s.len() <= max => Some(s.clone()),
        _ => None,
    }
}

fn parse_features(v: &Value) -> Option<FeatureMap> {
    let obj = v.as_object()?;
    let mut out = FeatureMap::all_off();
    for f in Feature::ALL {
        if let Some(raw) = obj.get(f.as_str()) {
            if !raw.is_boolean() {
                return None;
            }
            out.set(*f, raw.as_bool() == Some(true));
        }
    }
    Some(out)
}

fn parse_limits(v: Option<&Value>) -> Option<LimitMap> {
    let Some(v) = v else {
        return Some(LimitMap::unlimited());
    };
    let obj = v.as_object()?;
    let mut out = LimitMap::unlimited();
    for l in Limit::ALL {
        let raw = obj.get(l.as_str());
        let val = match raw {
            None | Some(Value::Null) => None,
            Some(x) => {
                let n = int_claim(x)?;
                if n < 0 {
                    return None;
                }
                Some(n)
            }
        };
        match l {
            Limit::Organizations => out.organizations = val,
            Limit::Nodes => out.nodes = val,
            Limit::Seats => out.seats = val,
            Limit::Relays => out.relays = val,
        }
    }
    Some(out)
}

fn parse_meta(v: Option<&Value>) -> Option<HashMap<String, String>> {
    let Some(v) = v else {
        return Some(HashMap::new());
    };
    let obj = v.as_object()?;
    if obj.len() > 16 {
        return None;
    }
    let mut out = HashMap::new();
    for (k, val) in obj {
        let Value::String(s) = val else {
            return None;
        };
        if s.len() > 256 {
            return None;
        }
        out.insert(k.clone(), s.clone());
    }
    Some(out)
}

fn parse_paid_tier(v: &Value) -> Option<LicenseTier> {
    let s = v.as_str()?;
    match s {
        "cloud" => Some(LicenseTier::Cloud),
        "enterprise" => Some(LicenseTier::Enterprise),
        _ => None,
    }
}

pub fn verify_license_token(token: &str, options: VerifyOptions<'_>) -> VerifyResult {
    let skew = options.clock_skew_sec;
    let now = options.now;

    let decoded = decode_token(token)?;

    if decoded.header.typ != LICENSE_TYP {
        return Err(fail(
            LicenseFailureCode::UnsupportedFormat,
            format!("unexpected typ: {}", decoded.header.typ),
        ));
    }
    for c in &decoded.header.crit {
        if !UNDERSTOOD_CRIT.contains(&c.as_str()) {
            return Err(fail(
                LicenseFailureCode::UnsupportedClaim,
                format!("unsupported critical claim: {c}"),
            ));
        }
    }

    let key = options.keyring.get(&decoded.header.kid).ok_or_else(|| {
        fail(
            LicenseFailureCode::UnknownKey,
            format!("unknown kid: {}", decoded.header.kid),
        )
    })?;

    if key.status == KeyStatus::Compromised {
        return Err(fail(
            LicenseFailureCode::KeyRevoked,
            format!("signing key {} is revoked", decoded.header.kid),
        ));
    }
    if decoded.header.alg != TrustedKey::ALG {
        return Err(fail(
            LicenseFailureCode::AlgMismatch,
            "header alg does not match key alg",
        ));
    }

    let vk = VerifyingKey::from_bytes(&key.public_key)
        .map_err(|_| fail(LicenseFailureCode::BadSignature, "invalid public key bytes"))?;
    let signature = Signature::from_bytes(&decoded.signature);
    if vk
        .verify_strict(&decoded.signing_input, &signature)
        .is_err()
    {
        return Err(fail(
            LicenseFailureCode::BadSignature,
            "signature verification failed",
        ));
    }

    let payload = &decoded.payload;
    let jti = payload.get("jti").and_then(|v| str_claim(v, 64));
    let iss = payload.get("iss").and_then(|v| str_claim(v, 256));
    let sub = payload.get("sub").and_then(|v| str_claim(v, 256));
    let iat = payload.get("iat").and_then(int_claim);
    let nbf = match payload.get("nbf") {
        None => iat,
        Some(v) => int_claim(v),
    };
    let exp = payload.get("exp").and_then(int_claim);
    let grace = match payload.get("grace") {
        None => Some(0),
        Some(v) => int_claim(v),
    };
    let features = payload.get("features").and_then(parse_features);
    let limits = parse_limits(payload.get("limits"));
    let meta = parse_meta(payload.get("meta"));
    let tier = payload.get("tier").and_then(parse_paid_tier);

    let aud = match payload.get("aud") {
        None => Some(Vec::new()),
        Some(Value::Array(arr)) if arr.len() <= 32 => {
            let mut ok = true;
            let mut out = Vec::with_capacity(arr.len());
            for a in arr {
                match a.as_str() {
                    Some(s) if s.len() <= 64 => out.push(s.to_string()),
                    _ => {
                        ok = false;
                        break;
                    }
                }
            }
            if ok { Some(out) } else { None }
        }
        _ => None,
    };

    let (
        Some(jti),
        Some(iss),
        Some(sub),
        Some(tier),
        Some(features),
        Some(limits),
        Some(meta),
        Some(aud),
        Some(iat),
        Some(nbf),
        Some(exp),
        Some(grace),
    ) = (
        jti, iss, sub, tier, features, limits, meta, aud, iat, nbf, exp, grace,
    )
    else {
        return Err(fail(
            LicenseFailureCode::InvalidClaims,
            "license payload failed schema validation",
        ));
    };

    if !(0..=90 * 86400).contains(&grace) || exp <= iat {
        return Err(fail(
            LicenseFailureCode::InvalidClaims,
            "license payload failed schema validation",
        ));
    }

    if key.valid_from > iat {
        return Err(fail(
            LicenseFailureCode::KeyRevoked,
            "license issued before key validity window",
        ));
    }
    if let Some(until) = key.valid_until
        && iat > until
    {
        return Err(fail(
            LicenseFailureCode::KeyRevoked,
            "license issued after key retirement",
        ));
    }

    if let Some(expected) = options.expected_issuer
        && iss != expected
    {
        return Err(fail(
            LicenseFailureCode::IssuerMismatch,
            format!("unexpected issuer: {iss}"),
        ));
    }

    if let Some(revoked) = options.revoked_ids
        && revoked.contains(&jti)
    {
        return Err(fail(
            LicenseFailureCode::Revoked,
            format!("license {jti} has been revoked"),
        ));
    }

    if !aud.is_empty() {
        let Some(audience) = options.audience else {
            return Err(fail(
                LicenseFailureCode::AudienceMismatch,
                "license is deployment-bound but no deployment id is configured",
            ));
        };
        if !aud.iter().any(|a| a == audience) {
            return Err(fail(
                LicenseFailureCode::AudienceMismatch,
                "license is bound to a different deployment",
            ));
        }
    }

    if now + skew < nbf {
        return Err(fail(
            LicenseFailureCode::NotYetValid,
            "license is not yet valid",
        ));
    }

    let license = License {
        jti,
        iss,
        sub,
        aud,
        tier,
        features,
        limits,
        iat,
        nbf,
        exp,
        grace,
        meta,
        kid: decoded.header.kid,
    };

    if now - skew < exp {
        return Ok((license, RuntimeStatus::Active));
    }
    if now - skew < exp + grace {
        return Ok((license, RuntimeStatus::Grace));
    }
    Err(fail(
        LicenseFailureCode::Expired,
        format!(
            "license expired at {}",
            chrono::DateTime::from_timestamp(exp, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| exp.to_string())
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_22_chars_base64url() {
        let fp = deployment_fingerprint("deploy-abc");
        assert_eq!(fp.len(), 22);
        assert!(
            fp.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        // Stable for same input.
        assert_eq!(fp, deployment_fingerprint("deploy-abc"));
        assert_ne!(fp, deployment_fingerprint("deploy-xyz"));
    }

    #[test]
    fn fingerprint_matches_prefix_of_sha256() {
        let id = "test-deployment";
        let mut hasher = Sha256::new();
        hasher.update(b"tunnet-deployment-v1\0");
        hasher.update(id.as_bytes());
        let full = b64u_encode(&hasher.finalize());
        assert_eq!(deployment_fingerprint(id), &full[..22]);
    }

    #[test]
    fn bad_signature_rejected() {
        // Well-formed shape but garbage signature / segments → decode or verify fail.
        let token = format!(
            "tnlic1.{}.{}.{}",
            b64u_encode(br#"{"alg":"Ed25519","kid":"tnk-2025-01","typ":"tunnet-license+2"}"#),
            b64u_encode(br#"{"jti":"x","iss":"i","sub":"s","tier":"cloud","features":{},"iat":1,"exp":9999999999}"#),
            b64u_encode(&[0u8; 64]),
        );
        let keyring = Keyring::default_tunnet();
        let err =
            verify_license_token(&token, VerifyOptions::new(&keyring, 1_700_000_000)).unwrap_err();
        assert_eq!(err.code, LicenseFailureCode::BadSignature);
    }
}
