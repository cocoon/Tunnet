//! Load and verify a license from environment (`TUNNET_LICENSE`).

use crate::entitlements::{entitlements_from, fallback_community, has_feature};
use crate::error::LicenseFailureCode;
use crate::features::{Entitlements, Feature, community};
use crate::keyring::Keyring;
use crate::token::{MAX_TOKEN_LEN, TOKEN_PREFIX};
use crate::verify::{VerifyOptions, deployment_fingerprint, verify_license_token};

const DEFAULT_ISSUER: &str = "https://licensing.tunnet.io";

enum LoadResult {
    Ok(String),
    NotConfigured,
    Unavailable(String),
    TooLarge,
}

async fn load_license_text(raw: Option<&str>) -> LoadResult {
    let Some(ref_) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return LoadResult::NotConfigured;
    };

    if ref_.starts_with(TOKEN_PREFIX) {
        if ref_.len() > MAX_TOKEN_LEN {
            return LoadResult::TooLarge;
        }
        return LoadResult::Ok(ref_.to_string());
    }

    if ref_.starts_with("https://") || ref_.starts_with("http://") {
        if ref_.starts_with("http://")
            && std::env::var("TUNNET_LICENSE_ALLOW_INSECURE")
                .ok()
                .as_deref()
                != Some("1")
        {
            tracing::warn!(
                "TUNNET_LICENSE URL must use https (set TUNNET_LICENSE_ALLOW_INSECURE=1 to override)"
            );
            return LoadResult::Unavailable("insecure license URL".into());
        }
        match fetch_license(ref_).await {
            Ok(text) => LoadResult::Ok(text),
            Err(msg) => {
                tracing::warn!(error = %msg, "TUNNET_LICENSE fetch failed");
                LoadResult::Unavailable(msg)
            }
        }
    } else {
        match tokio::fs::read_to_string(ref_).await {
            Ok(text) => {
                if text.len() > MAX_TOKEN_LEN {
                    return LoadResult::TooLarge;
                }
                LoadResult::Ok(text.trim().to_string())
            }
            Err(e) => {
                tracing::warn!(?e, path = %ref_, "TUNNET_LICENSE file not found");
                LoadResult::Unavailable(e.to_string())
            }
        }
    }
}

async fn fetch_license(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/plain")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_TOKEN_LEN {
        return Err("license response too large".into());
    }
    let text = String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
}

/// Resolve entitlements from env, soft-failing to community on any error.
pub async fn resolve_entitlements_from_env() -> Entitlements {
    let raw = std::env::var("TUNNET_LICENSE").ok();
    match load_license_text(raw.as_deref()).await {
        LoadResult::NotConfigured => community(),
        LoadResult::TooLarge => {
            tracing::warn!("TUNNET_LICENSE too large; using community entitlements");
            fallback_community(LicenseFailureCode::TooLarge, false)
        }
        LoadResult::Unavailable(msg) => {
            tracing::warn!(error = %msg, "TUNNET_LICENSE source unavailable; using community");
            fallback_community(LicenseFailureCode::SourceUnavailable, true)
        }
        LoadResult::Ok(token) => verify_loaded_token(&token),
    }
}

fn verify_loaded_token(token: &str) -> Entitlements {
    let keyring = Keyring::default_tunnet();
    let now = chrono::Utc::now().timestamp();

    let deployment_id = std::env::var("TUNNET_DEPLOYMENT_ID").ok();
    let fp;
    let audience = match deployment_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(id) => {
            fp = deployment_fingerprint(id);
            Some(fp.as_str())
        }
        None => None,
    };

    let issuer = std::env::var("TUNNET_LICENSE_ISSUER")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_ISSUER.to_string());

    let mut opts = VerifyOptions::new(&keyring, now);
    opts.audience = audience;
    opts.expected_issuer = Some(issuer.as_str());

    match verify_license_token(token, opts) {
        Ok((license, status)) => {
            tracing::info!(
                tier = ?license.tier,
                license_id = %license.jti,
                status = ?status,
                "license active"
            );
            entitlements_from(&license, status, false)
        }
        Err(e) => {
            tracing::warn!(
                code = %e.code,
                message = %e.message,
                "TUNNET_LICENSE rejected; using community entitlements"
            );
            fallback_community(e.code, false)
        }
    }
}

/// Sync helper for callers that already hold entitlements.
pub fn feature_enabled(entitlements: &Entitlements, feature: Feature) -> bool {
    has_feature(entitlements, feature)
}
