//! Tunnet connectivity relay - thin wrapper around the official `iroh-relay` server.

mod config;
mod control;

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use iroh_relay::server::Server;
use tracing_subscriber::EnvFilter;

use crate::config::{CliOverrides, FileConfig};
use crate::control::ControlClient;

#[derive(Parser, Debug)]
#[command(
    name = "tunnet-relay",
    about = "Tunnet connectivity relay (iroh-relay wrapper)"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Start the iroh connectivity relay
    Run(RunArgs),
}

#[derive(Parser, Debug)]
struct RunArgs {
    /// Path to an iroh-relay-compatible TOML config
    #[arg(long, short = 'c', env = "TUNNET_RELAY_CONFIG")]
    config: Option<PathBuf>,

    /// HTTP bind address (plaintext / captive portal)
    #[arg(long, env = "TUNNET_RELAY_HTTP_BIND")]
    http_bind: Option<SocketAddr>,

    /// HTTPS bind address (requires TLS certs)
    #[arg(long, env = "TUNNET_RELAY_HTTPS_BIND")]
    https_bind: Option<SocketAddr>,

    /// Enable QUIC address discovery (requires TLS outside --dev)
    #[arg(long, env = "TUNNET_RELAY_ENABLE_QAD", default_value_t = false)]
    enable_qad: bool,

    /// Prometheus metrics bind address (iroh-relay metrics server)
    #[arg(long, env = "TUNNET_RELAY_METRICS_BIND")]
    metrics_bind: Option<SocketAddr>,

    /// Shared access token for clients (also IROH_RELAY_ACCESS_TOKEN)
    #[arg(long, env = "IROH_RELAY_ACCESS_TOKEN")]
    access_token: Option<String>,

    /// TLS certificate PEM path (Manual mode)
    #[arg(long, env = "TUNNET_RELAY_TLS_CERT")]
    tls_cert: Option<PathBuf>,

    /// TLS private key PEM path (Manual mode)
    #[arg(long, env = "TUNNET_RELAY_TLS_KEY")]
    tls_key: Option<PathBuf>,

    /// Tunnet control plane base URL (optional; standalone without CP)
    #[arg(long, env = "TUNNET_CONTROL_URL")]
    control_url: Option<String>,

    /// Relay registration token for the control plane
    #[arg(long, env = "TUNNET_RELAY_TOKEN")]
    token: Option<String>,

    /// Public relay URL advertised to the control plane
    #[arg(long, env = "TUNNET_RELAY_URL")]
    relay_url: Option<String>,

    /// Region label advertised to the control plane
    #[arg(long, env = "TUNNET_RELAY_REGION", default_value = "unknown")]
    region: String,

    /// Optional public metrics URL for CP registration
    #[arg(long, env = "TUNNET_RELAY_METRICS_URL")]
    metrics_url: Option<String>,

    /// Plaintext / localhost development mode (like iroh-relay --dev)
    #[arg(long, default_value_t = false)]
    dev: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tunnet_relay=debug,iroh_relay=info")),
        )
        .with_writer(std::io::stderr)
        .init();

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("failed to set default crypto provider");

    let cli = Cli::parse();
    match cli.command {
        Commands::Run(args) => run(args).await,
    }
}

async fn run(args: RunArgs) -> anyhow::Result<()> {
    let file = if let Some(path) = &args.config {
        FileConfig::load(path)?
    } else {
        FileConfig::default()
    };

    let resolved = config::resolve(
        file,
        CliOverrides {
            http_bind: args.http_bind,
            https_bind: args.https_bind,
            enable_qad: args.enable_qad,
            metrics_bind: args.metrics_bind,
            access_token: args.access_token,
            tls_cert: args.tls_cert,
            tls_key: args.tls_key,
            dev: args.dev,
        },
    )?;

    let (server_config, access_mode) = config::build_server_config(&resolved).await?;
    tracing::debug!(?server_config, %access_mode, "spawning iroh-relay server");

    let mut server = Server::spawn(server_config)
        .await
        .map_err(|e| anyhow::anyhow!("iroh-relay spawn: {e:#}"))?;

    if let Some(addr) = server.http_addr() {
        tracing::info!(%addr, "relay HTTP listening");
    }
    if let Some(addr) = server.https_addr() {
        tracing::info!(%addr, "relay HTTPS listening");
    }
    if let Some(addr) = resolved.metrics_bind_addr {
        tracing::info!(%addr, "metrics listening (iroh-relay)");
    }

    let mut heartbeat_task = None;
    match (&args.control_url, &args.token) {
        (Some(control_url), Some(token)) => {
            let relay_url = args
                .relay_url
                .clone()
                .or_else(|| public_url_hint(&server))
                .context(
                    "--relay-url is required when registering with the control plane \
                     (could not infer from bind addresses)",
                )?;
            let client = ControlClient::new(control_url.clone(), token.clone())?;
            let reg = client
                .register(
                    &relay_url,
                    &args.region,
                    resolved.enable_qad,
                    args.metrics_url.as_deref(),
                    &access_mode,
                )
                .await?;
            tracing::info!(
                relay_id = %reg.relay_id,
                name = %reg.name,
                url = %reg.url,
                "registered with control plane"
            );
            heartbeat_task = Some(client.spawn_heartbeat_loop());
        }
        (None, None) => {
            tracing::info!("running standalone (no control-url / token)");
        }
        _ => {
            anyhow::bail!("both --control-url and --token are required to register with CP");
        }
    }

    tracing::info!("tunnet-relay ready (iroh connectivity)");

    tokio::select! {
        biased;
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("shutdown signal");
        }
        res = server.join() => {
            match res {
                Ok(Ok(())) => tracing::info!("relay server exited"),
                Ok(Err(e)) => tracing::error!(?e, "relay supervisor error"),
                Err(e) => tracing::error!(?e, "relay join error"),
            }
        }
    }

    if let Some(t) = heartbeat_task {
        t.abort();
    }
    server
        .shutdown()
        .await
        .map_err(|e| anyhow::anyhow!("iroh-relay shutdown: {e:#}"))?;
    Ok(())
}

fn public_url_hint(server: &Server) -> Option<String> {
    if let Some(addr) = server.https_addr() {
        return Some(format!("https://{addr}"));
    }
    if let Some(addr) = server.http_addr() {
        return Some(format!("http://{addr}"));
    }
    None
}
