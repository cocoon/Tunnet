//! Decrypt internal-CA leaf private keys (same format as management `internal-ca.ts`).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{Context, bail};
use base64::Engine;

/// Resolve the AES-256 key used for CA PEM encryption at rest.
///
/// Matches management: 64-char hex or 32-byte base64.
pub fn resolve_ca_key(raw: Option<&str>) -> anyhow::Result<[u8; 32]> {
    let raw = raw.context("TUNNET_CA_ENCRYPTION_KEY is required to decrypt CA private keys")?;
    if raw.len() == 64 && raw.chars().all(|c| c.is_ascii_hexdigit()) {
        let mut out = [0u8; 32];
        if hex::decode_to_slice(raw, &mut out).is_ok() {
            return Ok(out);
        }
    }
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw)
        && bytes.len() == 32
    {
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }
    bail!("TUNNET_CA_ENCRYPTION_KEY must be 32-byte hex (64 chars) or base64")
}

/// Decrypt a blob produced by management `encryptPem`: base64(iv‖tag‖ciphertext).
pub fn decrypt_pem(key: &[u8; 32], blob: &str) -> anyhow::Result<String> {
    let buf = base64::engine::general_purpose::STANDARD
        .decode(blob)
        .context("base64 decode encrypted PEM")?;
    if buf.len() < 28 {
        bail!("encrypted PEM blob too short");
    }
    let iv = &buf[..12];
    let tag = &buf[12..28];
    let ciphertext = &buf[28..];

    let mut sealed = Vec::with_capacity(ciphertext.len() + tag.len());
    sealed.extend_from_slice(ciphertext);
    sealed.extend_from_slice(tag);

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| anyhow::anyhow!("invalid AES key"))?;
    let nonce_arr: [u8; 12] = iv
        .try_into()
        .map_err(|_| anyhow::anyhow!("invalid nonce length"))?;
    let nonce = Nonce::from(nonce_arr);
    let plain = cipher
        .decrypt(&nonce, sealed.as_ref())
        .map_err(|_| anyhow::anyhow!("AES-GCM decrypt failed (wrong CA key?)"))?;
    String::from_utf8(plain).context("decrypted PEM is not utf8")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ca_key_is_required() {
        assert!(resolve_ca_key(None).is_err());
        assert!(resolve_ca_key(Some("not-a-key")).is_err());
    }

    #[test]
    fn ca_key_accepts_hex_and_base64() {
        let expected = [7u8; 32];
        let hex = hex::encode(expected);
        let base64 = base64::engine::general_purpose::STANDARD.encode(expected);
        assert_eq!(resolve_ca_key(Some(&hex)).unwrap(), expected);
        assert_eq!(resolve_ca_key(Some(&base64)).unwrap(), expected);
    }
}
