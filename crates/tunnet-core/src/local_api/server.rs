//! Local Management API HTTP server over Unix socket / Windows named pipe.

use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use axum::Extension;
use axum::Router;
use hyper::body::Incoming;
use hyper_util::rt::TokioIo;
use hyper_util::server::conn::auto::Builder as HyperBuilder;
use tower::Service;

use super::bootstrap_router::{self, BootstrapApiState};
use super::router;
use super::state::LocalApiState;
use super::transport::{ApiListener, ApiStream};

/// Spawn the Local Management API listener (full mesh runtime).
///
/// Binds before returning so callers can treat the API as ready.
pub async fn spawn(state: Arc<LocalApiState>) -> anyhow::Result<tokio::task::JoinHandle<()>> {
    spawn_listener(move |peer| router::app(state.clone()).layer(Extension(peer))).await
}

/// Spawn a bootstrap-only API (idle agent waiting for create / enroll / join).
pub async fn spawn_bootstrap(
    state: BootstrapApiState,
) -> anyhow::Result<tokio::task::JoinHandle<()>> {
    spawn_listener(move |peer| {
        bootstrap_router::bootstrap_app(state.clone()).layer(Extension(peer))
    })
    .await
}

async fn spawn_listener<F>(make_app: F) -> anyhow::Result<tokio::task::JoinHandle<()>>
where
    F: Fn(super::auth::PeerIdentity) -> Router + Send + Sync + 'static,
{
    let (listener, path) = ApiListener::bind()
        .await
        .context("bind Local Management API listener")?;
    tracing::info!(path = %path.display(), "Local Management API ready");
    let make_app = Arc::new(make_app);
    Ok(tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok(stream) => {
                    let make_app = make_app.clone();
                    tokio::spawn(async move {
                        if let Err(e) = serve_connection(stream, make_app.as_ref()).await {
                            tracing::debug!(?e, "Local API client session ended");
                        }
                    });
                }
                Err(e) => {
                    tracing::warn!(?e, "Local API accept failed");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        }
    }))
}

async fn serve_connection<F>(stream: ApiStream, make_app: &F) -> anyhow::Result<()>
where
    F: Fn(super::auth::PeerIdentity) -> Router,
{
    #[cfg(unix)]
    let peer = match &stream {
        ApiStream::Unix(s) => super::auth::peer_identity_from_unix(s),
    };
    #[cfg(windows)]
    let peer = match &stream {
        ApiStream::Windows(p) => super::auth::peer_identity_from_windows(p),
    };

    let app = make_app(peer);

    match stream {
        #[cfg(unix)]
        ApiStream::Unix(unix) => {
            let io = TokioIo::new(unix);
            HyperBuilder::new(hyper_util::rt::TokioExecutor::new())
                .serve_connection(
                    io,
                    hyper::service::service_fn(move |req: axum::http::Request<Incoming>| {
                        let mut svc = app.clone();
                        async move {
                            Ok::<_, InfallibleWrap>(
                                Service::call(&mut svc, req)
                                    .await
                                    .unwrap_or_else(|e| match e {}),
                            )
                        }
                    }),
                )
                .await
                .map_err(|e| anyhow::anyhow!("http serve: {e}"))?;
        }
        #[cfg(windows)]
        ApiStream::Windows(pipe) => {
            let io = TokioIo::new(pipe);
            HyperBuilder::new(hyper_util::rt::TokioExecutor::new())
                .serve_connection(
                    io,
                    hyper::service::service_fn(move |req: axum::http::Request<Incoming>| {
                        let mut svc = app.clone();
                        async move {
                            Ok::<_, InfallibleWrap>(
                                Service::call(&mut svc, req)
                                    .await
                                    .unwrap_or_else(|e| match e {}),
                            )
                        }
                    }),
                )
                .await
                .map_err(|e| anyhow::anyhow!("http serve: {e}"))?;
        }
    }
    Ok(())
}

/// hyper service errors must be Infallible for this wiring.
#[derive(Debug)]
struct InfallibleWrap;

impl std::fmt::Display for InfallibleWrap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "infallible")
    }
}

impl std::error::Error for InfallibleWrap {}
