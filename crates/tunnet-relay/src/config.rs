//! Build an [`iroh_relay::server::ServerConfig`] from CLI + optional TOML.
//!
//! Config shape mirrors the upstream `iroh-relay` binary so existing iroh-relay
//! TOML files can be reused. Tunnet-specific flags (control plane, region, etc.)
//! live on the CLI in `main.rs`.

use std::net::{Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, bail};
use iroh_relay::defaults::{
    DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT, DEFAULT_METRICS_PORT, DEFAULT_RELAY_QUIC_PORT,
};
use iroh_relay::server::{
    Access, AccessControl, AllowAll, CertConfig, ClientRequest, QuicConfig, RelayConfig,
    ServerConfig, TlsConfig,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use serde::{Deserialize, Serialize};

/// Default HTTP port in `--dev` mode (matches upstream iroh-relay).
pub const DEV_MODE_HTTP_PORT: u16 = 3340;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileConfig {
    #[serde(default = "default_true")]
    pub enable_relay: bool,
    pub http_bind_addr: Option<SocketAddr>,
    pub tls: Option<FileTlsConfig>,
    #[serde(default)]
    pub enable_quic_addr_discovery: bool,
    #[serde(default = "default_true")]
    pub enable_metrics: bool,
    pub metrics_bind_addr: Option<SocketAddr>,
    pub key_cache_capacity: Option<usize>,
    #[serde(default)]
    pub access: AccessConfig,
}

fn default_true() -> bool {
    true
}

impl Default for FileConfig {
    fn default() -> Self {
        Self {
            enable_relay: true,
            http_bind_addr: None,
            tls: None,
            enable_quic_addr_discovery: false,
            enable_metrics: true,
            metrics_bind_addr: None,
            key_cache_capacity: None,
            access: AccessConfig::Everyone,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTlsConfig {
    pub https_bind_addr: Option<SocketAddr>,
    pub quic_bind_addr: Option<SocketAddr>,
    #[serde(default)]
    pub cert_mode: CertMode,
    pub cert_dir: Option<PathBuf>,
    pub manual_cert_path: Option<PathBuf>,
    pub manual_key_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum CertMode {
    #[default]
    Manual,
    Reloading,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccessConfig {
    #[default]
    Everyone,
    #[serde(rename = "shared_token")]
    SharedToken(Vec<String>),
}

/// Resolved runtime settings after merging file + CLI.
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub http_bind_addr: SocketAddr,
    pub https_bind_addr: Option<SocketAddr>,
    pub quic_bind_addr: Option<SocketAddr>,
    pub enable_qad: bool,
    pub metrics_bind_addr: Option<SocketAddr>,
    pub tls_cert: Option<PathBuf>,
    pub tls_key: Option<PathBuf>,
    pub access_token: Option<String>,
    pub key_cache_capacity: Option<usize>,
    pub enable_relay: bool,
    pub dev: bool,
}

impl FileConfig {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("read config {}", path.display()))?;
        toml::from_str(&text).context("parse relay config toml")
    }

    pub fn http_bind_addr(&self) -> SocketAddr {
        self.http_bind_addr
            .unwrap_or((Ipv6Addr::UNSPECIFIED, DEFAULT_HTTP_PORT).into())
    }

    pub fn metrics_bind_addr(&self) -> SocketAddr {
        self.metrics_bind_addr
            .unwrap_or_else(|| SocketAddr::new(self.http_bind_addr().ip(), DEFAULT_METRICS_PORT))
    }
}

impl FileTlsConfig {
    fn cert_dir(&self) -> PathBuf {
        self.cert_dir.clone().unwrap_or_else(|| PathBuf::from("."))
    }

    pub fn cert_path(&self) -> PathBuf {
        self.manual_cert_path
            .clone()
            .unwrap_or_else(|| self.cert_dir().join("default.crt"))
    }

    pub fn key_path(&self) -> PathBuf {
        self.manual_key_path
            .clone()
            .unwrap_or_else(|| self.cert_dir().join("default.key"))
    }

    pub fn https_bind_addr(&self, http: SocketAddr) -> SocketAddr {
        self.https_bind_addr
            .unwrap_or_else(|| SocketAddr::new(http.ip(), DEFAULT_HTTPS_PORT))
    }

    pub fn quic_bind_addr(&self, http: SocketAddr) -> SocketAddr {
        self.quic_bind_addr.unwrap_or_else(|| {
            SocketAddr::new(self.https_bind_addr(http).ip(), DEFAULT_RELAY_QUIC_PORT)
        })
    }
}

/// Merge file config with CLI overrides into a resolved runtime config.
pub fn resolve(file: FileConfig, cli: CliOverrides) -> anyhow::Result<ResolvedConfig> {
    let mut http = cli.http_bind.unwrap_or_else(|| file.http_bind_addr());
    if cli.dev && cli.http_bind.is_none() && file.http_bind_addr.is_none() {
        http = (Ipv6Addr::UNSPECIFIED, DEV_MODE_HTTP_PORT).into();
    }

    let enable_qad = cli.enable_qad || file.enable_quic_addr_discovery;

    let (tls_cert, tls_key, https_bind, quic_bind) = if let Some(tls) = &file.tls {
        let cert = cli.tls_cert.clone().unwrap_or_else(|| tls.cert_path());
        let key = cli.tls_key.clone().unwrap_or_else(|| tls.key_path());
        let https = cli.https_bind.unwrap_or_else(|| tls.https_bind_addr(http));
        let quic = tls.quic_bind_addr(http);
        (Some(cert), Some(key), Some(https), Some(quic))
    } else if cli.tls_cert.is_some() || cli.tls_key.is_some() {
        let cert = cli
            .tls_cert
            .clone()
            .context("--tls-cert required when configuring Manual TLS")?;
        let key = cli
            .tls_key
            .clone()
            .context("--tls-key required when configuring Manual TLS")?;
        let https = cli
            .https_bind
            .unwrap_or_else(|| SocketAddr::new(http.ip(), DEFAULT_HTTPS_PORT));
        let quic = SocketAddr::new(https.ip(), DEFAULT_RELAY_QUIC_PORT);
        (Some(cert), Some(key), Some(https), Some(quic))
    } else {
        (None, None, cli.https_bind, None)
    };

    let metrics = if let Some(addr) = cli.metrics_bind {
        Some(addr)
    } else if file.enable_metrics {
        Some(file.metrics_bind_addr())
    } else {
        None
    };

    let access_token = cli.access_token.or_else(|| match file.access {
        AccessConfig::SharedToken(tokens) => tokens.into_iter().next(),
        AccessConfig::Everyone => None,
    });

    if enable_qad && tls_cert.is_none() && !cli.dev {
        bail!("TLS (--tls-cert/--tls-key or config tls section) is required when QAD is enabled");
    }

    Ok(ResolvedConfig {
        http_bind_addr: http,
        https_bind_addr: https_bind,
        quic_bind_addr: quic_bind,
        enable_qad,
        metrics_bind_addr: metrics,
        tls_cert,
        tls_key,
        access_token,
        key_cache_capacity: file.key_cache_capacity,
        enable_relay: file.enable_relay,
        dev: cli.dev,
    })
}

#[derive(Debug, Clone, Default)]
pub struct CliOverrides {
    pub http_bind: Option<SocketAddr>,
    pub https_bind: Option<SocketAddr>,
    pub enable_qad: bool,
    pub metrics_bind: Option<SocketAddr>,
    pub access_token: Option<String>,
    pub tls_cert: Option<PathBuf>,
    pub tls_key: Option<PathBuf>,
    pub dev: bool,
}

fn load_certs(path: &Path) -> anyhow::Result<Vec<CertificateDer<'static>>> {
    CertificateDer::pem_file_iter(path)
        .with_context(|| format!("open cert {}", path.display()))?
        .collect::<Result<Vec<_>, _>>()
        .with_context(|| format!("read certs from {}", path.display()))
}

fn load_key(path: &Path) -> anyhow::Result<PrivateKeyDer<'static>> {
    PrivateKeyDer::from_pem_file(path).with_context(|| format!("read key from {}", path.display()))
}

fn rustls_server_config(
    certs: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
) -> anyhow::Result<rustls::ServerConfig> {
    let builder = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .context("rustls protocol versions")?
    .with_no_client_auth();
    builder
        .with_single_cert(certs, key)
        .context("build rustls ServerConfig")
}

#[derive(Debug)]
struct SharedTokenAccess(Vec<String>);

impl AccessControl for SharedTokenAccess {
    async fn on_connect(&self, request: &ClientRequest) -> Access {
        match request.auth_token() {
            Some(token) if self.0.iter().any(|t| t.as_str() == token) => Access::Allow,
            _ => Access::Deny { reason: None },
        }
    }
}

fn self_signed_server_config() -> anyhow::Result<rustls::ServerConfig> {
    let cert = rcgen::generate_simple_self_signed(vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "::1".to_string(),
    ])
    .context("generate self-signed cert")?;
    let rustls_cert = CertificateDer::from(cert.cert);
    let private_key = PrivateKeyDer::from(rustls::pki_types::PrivatePkcs8KeyDer::from(
        cert.signing_key.serialize_der(),
    ));
    rustls_server_config(vec![rustls_cert], private_key)
}

/// Construct the iroh-relay [`ServerConfig`] and spawn-ready access mode label.
pub async fn build_server_config(cfg: &ResolvedConfig) -> anyhow::Result<(ServerConfig, String)> {
    let access: Arc<dyn iroh_relay::server::DynAccessControl> =
        if let Some(ref token) = cfg.access_token {
            if token.is_empty() {
                bail!("access token must not be empty");
            }
            Arc::new(SharedTokenAccess(vec![token.clone()]))
        } else {
            Arc::new(AllowAll)
        };

    let access_mode = if cfg.access_token.is_some() {
        "shared_token".to_string()
    } else {
        "open".to_string()
    };

    let manual_tls = match (&cfg.tls_cert, &cfg.tls_key) {
        (Some(cert_path), Some(key_path)) => {
            let cert_path = cert_path.clone();
            let key_path = key_path.clone();
            let (certs, key) = tokio::task::spawn_blocking(move || {
                let certs = load_certs(&cert_path)?;
                let key = load_key(&key_path)?;
                anyhow::Ok((certs, key))
            })
            .await
            .context("join tls load")??;
            Some(rustls_server_config(certs, key)?)
        }
        _ if cfg.dev && cfg.enable_qad => Some(self_signed_server_config()?),
        _ => None,
    };

    let (relay_tls, quic) = if cfg.dev {
        // Plaintext HTTP relay; QAD may still use self-signed / manual TLS on QUIC.
        let quic = if cfg.enable_qad {
            let bind = cfg.quic_bind_addr.unwrap_or_else(|| {
                SocketAddr::new(cfg.http_bind_addr.ip(), DEFAULT_RELAY_QUIC_PORT)
            });
            let mut q = QuicConfig::new(bind);
            q.server_config = manual_tls;
            Some(q)
        } else {
            None
        };
        (None, quic)
    } else if let Some(server_config) = manual_tls {
        let https_bind = cfg
            .https_bind_addr
            .unwrap_or_else(|| SocketAddr::new(cfg.http_bind_addr.ip(), DEFAULT_HTTPS_PORT));
        let tls = TlsConfig::new(
            https_bind,
            CertConfig::Manual {
                server_config: server_config.clone(),
            },
        );
        let quic = if cfg.enable_qad {
            let bind = cfg
                .quic_bind_addr
                .unwrap_or_else(|| SocketAddr::new(https_bind.ip(), DEFAULT_RELAY_QUIC_PORT));
            Some(QuicConfig::new(bind))
        } else {
            None
        };
        (Some(tls), quic)
    } else {
        if cfg.enable_qad {
            bail!("QAD requires TLS certificates outside --dev mode");
        }
        (None, None)
    };

    let relay = if cfg.enable_relay {
        let mut relay = RelayConfig::new(cfg.http_bind_addr);
        relay.tls = relay_tls;
        relay.key_cache_capacity = cfg.key_cache_capacity;
        relay.access = access;
        Some(relay)
    } else {
        None
    };

    let mut server = ServerConfig::default();
    server.relay = relay;
    server.quic = quic;
    server.metrics_addr = cfg.metrics_bind_addr;

    Ok((server, access_mode))
}
