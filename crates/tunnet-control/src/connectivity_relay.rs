//! Connectivity-relay (iroh DERP) registration + heartbeat for agents' mesh fallback.

use axum::Json;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::state::SharedState;
use crate::token_hash::hash_token;

type RegistrationTokenRow = (
    Uuid,
    String,
    String,
    Option<chrono::DateTime<chrono::Utc>>,
    Option<String>,
);

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "error": msg }))).into_response()
}

fn bearer_token(req: &Request<Body>) -> Option<String> {
    req.headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ").map(str::to_string))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityRelayRegisterBody {
    pub url: String,
    #[serde(default = "default_region")]
    pub region: String,
    #[serde(default)]
    pub qad_enabled: bool,
    pub metrics_url: Option<String>,
    #[serde(default = "default_access_mode")]
    pub access_mode: String,
}

fn default_region() -> String {
    "unknown".into()
}

fn default_access_mode() -> String {
    "open".into()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityRelayRegisterResponse {
    pub relay_id: String,
    pub name: String,
    pub url: String,
    pub metering_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityRelayHeartbeatBody {
    pub status: Option<String>,
    pub metrics: Option<serde_json::Value>,
}

pub async fn connectivity_relay_register_handler(
    State(state): State<SharedState>,
    req: Request<Body>,
) -> Response {
    let token = match bearer_token(&req) {
        Some(t) => t,
        None => return err(StatusCode::UNAUTHORIZED, "missing Bearer token"),
    };
    let body_bytes = match axum::body::to_bytes(req.into_body(), 64 * 1024).await {
        Ok(b) => b,
        Err(_) => return err(StatusCode::BAD_REQUEST, "invalid body"),
    };
    let body: ConnectivityRelayRegisterBody = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "invalid json"),
    };
    if body.url.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "url is required");
    }
    let access_mode = body.access_mode.as_str();
    if !matches!(access_mode, "open" | "shared_token" | "http") {
        return err(
            StatusCode::BAD_REQUEST,
            "accessMode must be open, shared_token, or http",
        );
    }

    let token_hash = hash_token(&token);
    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}")),
    };

    let row: Option<RegistrationTokenRow> = match sqlx::query_as(
        "SELECT t.relay_id, r.name, r.url, t.used_at, t.organization_id \
         FROM relay_registration_tokens t \
         JOIN relays r ON r.id = t.relay_id \
         WHERE t.token_hash = $1 AND t.expires_at > now() \
           AND (r.suspended_at IS NULL)",
    )
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(r) => r,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}")),
    };

    let Some((relay_id, name, _existing_url, used_at, organization_id)) = row else {
        return err(
            StatusCode::UNAUTHORIZED,
            "invalid or expired relay registration token",
        );
    };

    if let Err(e) = sqlx::query(
        "UPDATE relays SET url = $2, region = $3, qad_enabled = $4, \
         metrics_url = $5, access_mode = $6, status = 'healthy', \
         last_heartbeat_at = now(), updated_at = now() \
         WHERE id = $1",
    )
    .bind(relay_id)
    .bind(&body.url)
    .bind(&body.region)
    .bind(body.qad_enabled)
    .bind(body.metrics_url.as_deref())
    .bind(access_mode)
    .execute(&mut *tx)
    .await
    {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}"));
    }

    if used_at.is_none()
        && let Err(e) = sqlx::query(
            "UPDATE relay_registration_tokens SET used_at = now() WHERE token_hash = $1",
        )
        .bind(&token_hash)
        .execute(&mut *tx)
        .await
    {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}"));
    }

    if let Err(e) = tx.commit().await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}"));
    }

    if let Some(org_id) = organization_id.as_deref() {
        let _ =
            crate::entity_notify::emit_relay_changed(&state.pool, org_id, &relay_id.to_string())
                .await;
    }

    (
        StatusCode::OK,
        Json(ConnectivityRelayRegisterResponse {
            relay_id: relay_id.to_string(),
            name,
            url: body.url,
            metering_enabled: crate::relay_map::license_tier()
                == tunnet_license::LicenseTier::Cloud
                && organization_id.is_none(),
        }),
    )
        .into_response()
}

pub async fn connectivity_relay_heartbeat_handler(
    State(state): State<SharedState>,
    req: Request<Body>,
) -> Response {
    let token = match bearer_token(&req) {
        Some(t) => t,
        None => return err(StatusCode::UNAUTHORIZED, "missing Bearer token"),
    };
    let body_bytes = match axum::body::to_bytes(req.into_body(), 64 * 1024).await {
        Ok(b) => b,
        Err(_) => return err(StatusCode::BAD_REQUEST, "invalid body"),
    };
    let body: ConnectivityRelayHeartbeatBody = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "invalid json"),
    };

    let token_hash = hash_token(&token);
    let row: Option<(Uuid, Option<String>)> = match sqlx::query_as(
        "SELECT r.id, r.organization_id FROM relays r \
         JOIN relay_registration_tokens t ON t.relay_id = r.id \
         WHERE t.token_hash = $1 \
           AND r.status <> 'suspended' \
           AND r.suspended_at IS NULL",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}")),
    };

    let Some((relay_id, organization_id)) = row else {
        return err(StatusCode::UNAUTHORIZED, "unknown relay");
    };

    let status = body
        .status
        .as_deref()
        .filter(|s| matches!(*s, "healthy" | "degraded" | "offline" | "pending"))
        .unwrap_or("healthy");

    if let Err(e) = sqlx::query(
        "UPDATE relays SET last_heartbeat_at = now(), status = $2, updated_at = now() \
         WHERE id = $1",
    )
    .bind(relay_id)
    .bind(status)
    .execute(&state.pool)
    .await
    {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}"));
    }

    if let Err(e) = sqlx::query("INSERT INTO relay_heartbeats (relay_id, metrics) VALUES ($1, $2)")
        .bind(relay_id)
        .bind(body.metrics.unwrap_or_else(|| json!({ "ok": true })))
        .execute(&state.pool)
        .await
    {
        tracing::warn!(?e, %relay_id, "failed to record relay heartbeat history");
    }

    if let Some(org_id) = organization_id.as_deref() {
        let _ =
            crate::entity_notify::emit_relay_changed(&state.pool, org_id, &relay_id.to_string())
                .await;
    }

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityRelayUsageEntry {
    /// Organization that the relayed traffic belongs to.
    pub organization_id: String,
    pub bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityRelayUsageBody {
    pub entries: Vec<ConnectivityRelayUsageEntry>,
}

/// Batched relay-byte accounting from Tunnet Cloud deployment relays only.
/// Self-hosted org relays are rejected for metering (accepted=0).
pub async fn connectivity_relay_usage_handler(
    State(state): State<SharedState>,
    req: Request<Body>,
) -> Response {
    let token = match bearer_token(&req) {
        Some(t) => t,
        None => return err(StatusCode::UNAUTHORIZED, "missing Bearer token"),
    };
    let body_bytes = match axum::body::to_bytes(req.into_body(), 2 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return err(StatusCode::BAD_REQUEST, "invalid body"),
    };
    let body: ConnectivityRelayUsageBody = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "invalid json"),
    };
    if body.entries.is_empty() {
        return err(StatusCode::BAD_REQUEST, "entries must not be empty");
    }
    if body.entries.len() > 500 {
        return err(StatusCode::BAD_REQUEST, "too many entries (max 500)");
    }

    if crate::relay_map::license_tier() != tunnet_license::LicenseTier::Cloud {
        return (
            StatusCode::OK,
            Json(json!({ "ok": true, "accepted": 0, "metering": false })),
        )
            .into_response();
    }

    let token_hash = hash_token(&token);
    let row: Option<(Uuid, Option<String>)> = match sqlx::query_as(
        "SELECT r.id, r.organization_id FROM relays r \
         JOIN relay_registration_tokens t ON t.relay_id = r.id \
         WHERE t.token_hash = $1 \
           AND r.status <> 'suspended' \
           AND r.suspended_at IS NULL",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("db: {e}")),
    };
    let Some((_relay_id, organization_id)) = row else {
        return err(StatusCode::UNAUTHORIZED, "unknown relay");
    };
    if organization_id.is_some() {
        return (
            StatusCode::OK,
            Json(json!({ "ok": true, "accepted": 0, "metering": false })),
        )
            .into_response();
    }

    let month = chrono::Utc::now().format("%Y%m").to_string();
    let month_i: i32 = month.parse().unwrap_or(0);
    let mut accepted = 0u32;
    for entry in &body.entries {
        if entry.bytes == 0 || entry.organization_id.is_empty() {
            continue;
        }
        if let Err(e) = sqlx::query(
            "INSERT INTO org_usage_monthly \
               (organization_id, month, relay_bytes, public_tunnel_bytes, updated_at) \
             VALUES ($1, $2, $3, 0, now()) \
             ON CONFLICT (organization_id, month) DO UPDATE SET \
               relay_bytes = org_usage_monthly.relay_bytes + EXCLUDED.relay_bytes, \
               updated_at = now()",
        )
        .bind(&entry.organization_id)
        .bind(month_i)
        .bind(entry.bytes as i64)
        .execute(&state.pool)
        .await
        {
            tracing::warn!(
                ?e,
                org = %entry.organization_id,
                "failed to increment relay usage"
            );
            continue;
        }
        accepted += 1;
    }

    (
        StatusCode::OK,
        Json(json!({ "ok": true, "accepted": accepted, "metering": true })),
    )
        .into_response()
}
