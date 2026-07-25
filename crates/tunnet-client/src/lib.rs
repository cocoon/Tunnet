//! Typed HTTP client for the Tunnet Local Management API.
//!
//! Connect to a running `tunnetd` over a machine-local Unix socket or Windows
//! named pipe and call [`TunnetClient`] methods for each `/v1/...` endpoint.
//! Request and response types live in [`tunnet_common::local_api`].

mod client;
mod transport;

pub use client::{LocalApiClient, TunnetClient};
pub use transport::{default_api_path, endpoint_reachable};

pub use tunnet_common::local_api::{
    ApiError, ApiErrorCode, PingEvent, PingProbe, PingSummary, StatusInfo, format_api_error,
};
