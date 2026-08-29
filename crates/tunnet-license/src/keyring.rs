//! Trusted signing keys for tnlic1 tokens.

use std::collections::HashMap;

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyStatus {
    Active,
    Retired,
    Compromised,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedKey {
    pub kid: String,
    pub public_key: [u8; 32],
    pub valid_from: Timestamp,
    pub valid_until: Option<Timestamp>,
    pub status: KeyStatus,
}

impl TrustedKey {
    pub const ALG: &'static str = "Ed25519";

    pub fn from_hex(
        kid: impl Into<String>,
        hex: &str,
        valid_from: Timestamp,
        valid_until: Option<Timestamp>,
        status: KeyStatus,
    ) -> Result<Self, String> {
        let bytes = hex::decode(hex).map_err(|e| e.to_string())?;
        if bytes.len() != 32 {
            return Err(format!("public key must be 32 bytes, got {}", bytes.len()));
        }
        let mut public_key = [0u8; 32];
        public_key.copy_from_slice(&bytes);
        Ok(Self {
            kid: kid.into(),
            public_key,
            valid_from,
            valid_until,
            status,
        })
    }
}

/// Built-in Tunnet production/dev keyring (`tnk-2025-01`).
pub fn tunnet_trusted_keys() -> Vec<TrustedKey> {
    vec![
        TrustedKey::from_hex(
            "tnk-2025-01",
            "54544bc6251b8076e7cdceff6b741d258b37a6a93020a03a251fe209b325ebbd",
            Timestamp::UNIX_EPOCH,
            None,
            KeyStatus::Active,
        )
        .expect("static key hex"),
    ]
}

/// Lazy static list matching TS `TUNNET_TRUSTED_KEYS`.
pub static TUNNET_TRUSTED_KEYS: std::sync::LazyLock<Vec<TrustedKey>> =
    std::sync::LazyLock::new(tunnet_trusted_keys);

#[derive(Debug, Clone)]
pub struct Keyring {
    by_kid: HashMap<String, TrustedKey>,
}

impl Keyring {
    pub fn new(keys: impl IntoIterator<Item = TrustedKey>) -> Result<Self, String> {
        let mut by_kid = HashMap::new();
        for k in keys {
            if by_kid.contains_key(&k.kid) {
                return Err(format!("duplicate kid: {}", k.kid));
            }
            by_kid.insert(k.kid.clone(), k);
        }
        if by_kid.is_empty() {
            return Err("keyring must contain at least one key".into());
        }
        Ok(Self { by_kid })
    }

    pub fn default_tunnet() -> Self {
        Self::new(TUNNET_TRUSTED_KEYS.iter().cloned()).expect("default keyring")
    }

    pub fn get(&self, kid: &str) -> Option<&TrustedKey> {
        self.by_kid.get(kid)
    }
}

impl Default for Keyring {
    fn default() -> Self {
        Self::default_tunnet()
    }
}
