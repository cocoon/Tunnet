//! Bootstrap-only Local Management API (no mesh / CoreNode yet).
//!
//! Used while the agent is idle waiting for create / enroll / join so the
//! Windows service can leave StartPending and the CLI can call lifecycle APIs.

use std::sync::Arc;

use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use tunnet_common::local_api::{
    ApiError, ApiErrorCode, AuthLoginRequest, LocalEnrollRequest, NetworkCreateRequest,
    NetworkJoinRequest, NetworkLeaveRequest, NetworkUpgradeRequest, OkResponse, ResetRequest,
    UpdateRequest, ValidateConfigRequest,
};

use super::auth::PeerIdentity;
use super::bootstrap::BootstrapOps;

#[derive(Clone)]
pub struct BootstrapApiState {
    pub bootstrap: Arc<dyn BootstrapOps>,
}

type ApiState = BootstrapApiState;

pub fn bootstrap_app(state: ApiState) -> Router {
    Router::new()
        .route("/v1/status", get(idle_status))
        .route("/v1/enroll", post(enroll))
        .route("/v1/networks", post(network_create))
        .route("/v1/networks/join", post(network_join))
        .route("/v1/networks/leave", post(network_leave))
        .route("/v1/networks/upgrade", post(network_upgrade))
        .route("/v1/reset", post(reset))
        .route("/v1/config/validate", post(validate_config))
        .route("/v1/auth/login", post(auth_login))
        .route("/v1/auth/logout", post(auth_logout))
        .route("/v1/update", post(update))
        .with_state(state)
}

fn api_status(code: &ApiErrorCode) -> StatusCode {
    match code {
        ApiErrorCode::DaemonNotRunning => StatusCode::SERVICE_UNAVAILABLE,
        ApiErrorCode::DataPlaneDown => StatusCode::SERVICE_UNAVAILABLE,
        ApiErrorCode::NotEnrolled => StatusCode::CONFLICT,
        ApiErrorCode::NotFound => StatusCode::NOT_FOUND,
        ApiErrorCode::Denied => StatusCode::FORBIDDEN,
        ApiErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        ApiErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

struct ApiErrorResponse(ApiError);

impl IntoResponse for ApiErrorResponse {
    fn into_response(self) -> Response {
        let status = api_status(&self.0.code);
        (status, Json(self.0)).into_response()
    }
}

impl From<ApiError> for ApiErrorResponse {
    fn from(e: ApiError) -> Self {
        Self(e)
    }
}

type ApiResult<T> = Result<T, ApiErrorResponse>;

async fn idle_status() -> ApiResult<Json<serde_json::Value>> {
    Ok(Json(serde_json::json!({
        "connected": false,
        "idle": true,
        "message": "waiting for create, enroll, or join",
    })))
}

async fn enroll(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<LocalEnrollRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_elevated()?;
    Ok(Json(state.bootstrap.enroll(body).await?))
}

async fn network_create(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<NetworkCreateRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_elevated()?;
    Ok(Json(state.bootstrap.network_create(body).await?))
}

async fn network_join(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<NetworkJoinRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_elevated()?;
    Ok(Json(state.bootstrap.network_join(body).await?))
}

async fn network_leave(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<NetworkLeaveRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_elevated()?;
    Ok(Json(state.bootstrap.network_leave(body).await?))
}

async fn network_upgrade(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<NetworkUpgradeRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_elevated()?;
    Ok(Json(state.bootstrap.network_upgrade(body).await?))
}

async fn reset(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<ResetRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_elevated()?;
    Ok(Json(state.bootstrap.reset(body).await?))
}

async fn validate_config(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<ValidateConfigRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_standard()?;
    Ok(Json(state.bootstrap.validate_config(body).await?))
}

async fn auth_login(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<AuthLoginRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_standard()?;
    Ok(Json(state.bootstrap.auth_login(body).await?))
}

async fn auth_logout(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_standard()?;
    Ok(Json(state.bootstrap.auth_logout().await?))
}

async fn update(
    Extension(peer): Extension<PeerIdentity>,
    State(state): State<ApiState>,
    Json(body): Json<UpdateRequest>,
) -> ApiResult<Json<OkResponse>> {
    peer.require_elevated()?;
    Ok(Json(state.bootstrap.update(body).await?))
}
