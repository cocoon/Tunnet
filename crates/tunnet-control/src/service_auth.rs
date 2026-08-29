//! HMAC authentication for management → control-plane internal API.

use axum::body::Bytes;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;
use hmac::{Hmac, KeyInit, Mac};
use jiff::{SignedDuration, Timestamp};
use sha2::{Digest, Sha256};

const HDR_TIMESTAMP: &str = "x-tunnet-timestamp";
const HDR_NONCE: &str = "x-tunnet-nonce";
const HDR_SIGNATURE: &str = "x-tunnet-signature";
const MAX_SKEW: SignedDuration = SignedDuration::from_secs(60);
const NONCE_TTL: SignedDuration = SignedDuration::from_mins(5);

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct ServiceAuth {
    secret: Vec<u8>,
    seen_nonces: DashMap<String, Timestamp>,
}

impl ServiceAuth {
    pub fn new(secret: &str) -> anyhow::Result<Self> {
        if secret.len() < 32 {
            anyhow::bail!("TUNNET_SERVICE_SECRET must be at least 32 characters");
        }
        Ok(Self {
            secret: secret.as_bytes().to_vec(),
            seen_nonces: DashMap::new(),
        })
    }

    pub async fn verify(
        &self,
        method: &str,
        path: &str,
        headers: &HeaderMap,
        body: &Bytes,
    ) -> Result<(), ServiceAuthError> {
        let timestamp = headers
            .get(HDR_TIMESTAMP)
            .and_then(|v| v.to_str().ok())
            .ok_or(ServiceAuthError::MissingHeader)?;
        let nonce = headers
            .get(HDR_NONCE)
            .and_then(|v| v.to_str().ok())
            .ok_or(ServiceAuthError::MissingHeader)?;
        let signature = headers
            .get(HDR_SIGNATURE)
            .and_then(|v| v.to_str().ok())
            .ok_or(ServiceAuthError::MissingHeader)?;

        let ts = timestamp
            .parse()
            .ok()
            .and_then(|seconds| Timestamp::from_second(seconds).ok())
            .ok_or(ServiceAuthError::InvalidTimestamp)?;
        let now = Timestamp::now();
        if now.duration_since(ts).abs() > MAX_SKEW {
            return Err(ServiceAuthError::StaleTimestamp);
        }

        self.prune_nonces(now);
        if self.seen_nonces.insert(nonce.to_string(), now).is_some() {
            return Err(ServiceAuthError::Replay);
        }

        let mut hasher = Sha256::new();
        hasher.update(body);
        let body_hash = hex::encode(hasher.finalize());
        let canonical = format!("{method}\n{path}\n{timestamp}\n{nonce}\n{body_hash}");

        let mut mac =
            HmacSha256::new_from_slice(&self.secret).map_err(|_| ServiceAuthError::BadSignature)?;
        mac.update(canonical.as_bytes());
        let expected = mac.finalize().into_bytes();

        let provided = hex::decode(signature).map_err(|_| ServiceAuthError::BadSignature)?;
        if provided.len() != expected.len() || !subtle_eq(&provided, expected.as_slice()) {
            return Err(ServiceAuthError::BadSignature);
        }

        Ok(())
    }

    fn prune_nonces(&self, now: Timestamp) {
        self.seen_nonces
            .retain(|_, timestamp| now.duration_since(*timestamp) <= NONCE_TTL);
    }
}

fn subtle_eq(a: &[u8], b: &[u8]) -> bool {
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

#[derive(Debug)]
pub enum ServiceAuthError {
    MissingHeader,
    InvalidTimestamp,
    StaleTimestamp,
    Replay,
    BadSignature,
}

impl IntoResponse for ServiceAuthError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            Self::MissingHeader => (StatusCode::UNAUTHORIZED, "missing service auth headers"),
            Self::InvalidTimestamp | Self::StaleTimestamp => {
                (StatusCode::UNAUTHORIZED, "stale timestamp")
            }
            Self::Replay => (StatusCode::UNAUTHORIZED, "replay detected"),
            Self::BadSignature => (StatusCode::UNAUTHORIZED, "bad signature"),
        };
        (status, msg).into_response()
    }
}
