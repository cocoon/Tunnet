#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use std::sync::LazyLock;

use base64::Engine;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use base64::engine::general_purpose::PAD;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
use base64::engine::general_purpose::STANDARD as B64_ENGINE;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
use base64::engine::simd::Simd;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

use crate::ProtocolError;

#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
static B64: LazyLock<Simd> = LazyLock::new(|| Simd::standard(PAD));

/// Build the canonical bytes we sign for a request.
pub fn canonical_message(method: &str, path: &str, ts: i64, body: &[u8]) -> Vec<u8> {
    let body_hash = blake3::hash(body);
    let mut out = Vec::with_capacity(method.len() + path.len() + 96);
    out.extend_from_slice(method.to_ascii_uppercase().as_bytes());
    out.push(b'\n');
    out.extend_from_slice(path.as_bytes());
    out.push(b'\n');
    out.extend_from_slice(ts.to_string().as_bytes());
    out.push(b'\n');
    out.extend_from_slice(body_hash.as_bytes());
    out
}

fn b64_encode(bytes: &[u8]) -> String {
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        B64.encode(bytes)
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        B64_ENGINE.encode(bytes)
    }
}

fn b64_decode(input: &[u8]) -> Result<Vec<u8>, base64::DecodeError> {
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        B64.decode(input)
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        B64_ENGINE.decode(input)
    }
}

pub fn sign(key: &SigningKey, method: &str, path: &str, ts: i64, body: &[u8]) -> String {
    let msg = canonical_message(method, path, ts, body);
    let sig: Signature = key.sign(&msg);
    b64_encode(&sig.to_bytes())
}

pub fn verify(
    vk: &VerifyingKey,
    method: &str,
    path: &str,
    ts: i64,
    body: &[u8],
    signature_b64: &str,
) -> Result<(), ProtocolError> {
    let sig_bytes =
        b64_decode(signature_b64.as_bytes()).map_err(|_| ProtocolError::BadSignature)?;
    let sig_bytes: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| ProtocolError::BadSignature)?;
    let sig = Signature::from_bytes(&sig_bytes);
    let msg = canonical_message(method, path, ts, body);
    vk.verify(&msg, &sig)
        .map_err(|_| ProtocolError::BadSignature)
}

pub fn verifying_key_from_hex(hex: &str) -> Result<VerifyingKey, ProtocolError> {
    let bytes = hex::decode(hex).map_err(|_| ProtocolError::InvalidEndpointId(hex.into()))?;
    let arr: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| ProtocolError::InvalidEndpointId(hex.into()))?;
    VerifyingKey::from_bytes(&arr).map_err(|_| ProtocolError::InvalidEndpointId(hex.into()))
}
