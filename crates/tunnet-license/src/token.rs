//! tnlic1 token decode (header / payload / signature).

#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use std::sync::LazyLock;

use base64::Engine;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use base64::engine::general_purpose::NO_PAD;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64U_ENGINE;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use base64::engine::simd::Simd;
use serde::Deserialize;
use serde_json::Value;

use crate::error::LicenseError;

#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
static B64U: LazyLock<Simd> = LazyLock::new(|| Simd::url_safe(NO_PAD));

pub const TOKEN_PREFIX: &str = "tnlic1";
pub const LICENSE_TYP: &str = "tunnet-license+2";
pub const MAX_TOKEN_LEN: usize = 8192;
const MAX_SEGMENT_CHARS: usize = 4096;

#[derive(Debug, Clone)]
pub struct ProtectedHeader {
    pub alg: String,
    pub kid: String,
    pub typ: String,
    pub crit: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DecodedToken {
    pub header: ProtectedHeader,
    pub payload: Value,
    pub signature: [u8; 64],
    /// Original `tnlic1.{h}.{p}` bytes (not re-serialized).
    pub signing_input: Vec<u8>,
}

fn is_b64url_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'-' || c == b'_'
}

fn b64u_engine_encode(bytes: &[u8]) -> String {
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        B64U.encode(bytes)
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        B64U_ENGINE.encode(bytes)
    }
}

fn b64u_engine_decode(value: &str) -> Result<Vec<u8>, base64::DecodeError> {
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        B64U.decode(value)
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        B64U_ENGINE.decode(value)
    }
}

/// Strict canonical base64url decode (no padding; round-trip must match).
pub fn b64u_decode(value: &str) -> Result<Vec<u8>, LicenseError> {
    if value.as_bytes().iter().any(|b| !is_b64url_char(*b)) || value.len() % 4 == 1 {
        return Err(LicenseError::malformed("invalid base64url"));
    }
    let bytes =
        b64u_engine_decode(value).map_err(|_| LicenseError::malformed("invalid base64url"))?;
    let re = b64u_engine_encode(&bytes);
    if re != value {
        return Err(LicenseError::malformed("non-canonical base64url"));
    }
    Ok(bytes)
}

pub fn b64u_encode(bytes: &[u8]) -> String {
    b64u_engine_encode(bytes)
}

fn parse_json_object(bytes: &[u8]) -> Result<Value, LicenseError> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|e| LicenseError::malformed(format!("json: {e}")))?;
    if !value.is_object() {
        return Err(LicenseError::malformed("expected JSON object"));
    }
    Ok(value)
}

#[derive(Debug, Deserialize)]
struct RawHeader {
    alg: String,
    kid: String,
    typ: String,
    #[serde(default)]
    crit: Vec<String>,
}

fn parse_header(raw: Value) -> Result<ProtectedHeader, LicenseError> {
    let h: RawHeader =
        serde_json::from_value(raw).map_err(|e| LicenseError::malformed(format!("header: {e}")))?;
    if h.alg != "Ed25519" {
        return Err(LicenseError::malformed("unsupported alg"));
    }
    if h.kid.is_empty() || h.kid.len() > 64 {
        return Err(LicenseError::malformed("invalid kid"));
    }
    Ok(ProtectedHeader {
        alg: h.alg,
        kid: h.kid,
        typ: h.typ,
        crit: h.crit,
    })
}

pub fn decode_token(token: &str) -> Result<DecodedToken, LicenseError> {
    let trimmed = token.trim();
    if trimmed.len() > MAX_TOKEN_LEN {
        return Err(LicenseError::too_large("token too large"));
    }

    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() != 4 || parts[0] != TOKEN_PREFIX {
        return Err(LicenseError::malformed("unsupported token format"));
    }
    let (h, p, s) = (parts[1], parts[2], parts[3]);
    if h.len() > MAX_SEGMENT_CHARS || p.len() > MAX_SEGMENT_CHARS || s.len() > 128 {
        return Err(LicenseError::too_large("segment too large"));
    }

    let sig_bytes = b64u_decode(s)?;
    let signature: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| LicenseError::malformed("invalid signature length"))?;

    let header = parse_header(parse_json_object(&b64u_decode(h)?)?)?;
    let payload = parse_json_object(&b64u_decode(p)?)?;
    let signing_input = format!("{TOKEN_PREFIX}.{h}.{p}").into_bytes();

    Ok(DecodedToken {
        header,
        payload,
        signature,
        signing_input,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    #[case::empty("")]
    #[case::not_a_token("not-a-token")]
    #[case::wrong_prefix("tnlic0.a.b.c")]
    #[case::missing_signature("tnlic1.a.b")]
    #[case::extra_segment("tnlic1.a.b.c.d")]
    #[case::padding_is_forbidden("tnlic1.YQ==.e30.AA")]
    fn rejects_malformed_token_envelopes(#[case] token: &str) {
        assert!(decode_token(token).is_err());
    }

    #[test]
    fn rejects_too_large() {
        let huge = format!("tnlic1.{}.b.c", "a".repeat(MAX_TOKEN_LEN));
        let err = decode_token(&huge).unwrap_err();
        assert_eq!(err.code, crate::error::LicenseFailureCode::TooLarge);
    }
}
