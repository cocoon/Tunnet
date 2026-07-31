//! Daemon entry (`tunnetd`) - run args and agent lifecycle.

use anyhow::Context;
use clap::Parser;
use tunnet_core::{PersistedState, SealPolicy, StatePaths, load_agent};

#[derive(Parser, Debug)]
#[command(
    name = "tunnetd",
    about = "Tunnet mesh agent daemon",
    version = env!("CARGO_PKG_VERSION")
)]
pub struct DaemonCli {
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
    #[arg(long, env = "TUNNET_JSON_LOGS")]
    pub json_logs: bool,
    #[cfg(windows)]
    #[arg(long, hide = true)]
    pub service: bool,
    #[command(flatten)]
    pub run: RunArgs,
}

#[derive(Parser, Debug)]
pub struct RunArgs {
    #[arg(long, env = "TUNNET_IFNAME", default_value = "tunnet0")]
    pub ifname: String,
    #[arg(long, env = "TUNNET_POLL_SECS", default_value_t = 30)]
    pub poll_secs: u64,
    #[arg(long, env = "TUNNET_METRICS_BIND", default_value = "127.0.0.1:9100")]
    pub metrics_bind: String,
    #[arg(long, env = "TUNNET_DISABLE_GOSSIP")]
    pub disable_gossip: bool,
    #[arg(long, env = "TUNNET_RECORDER")]
    pub recorder: bool,
    #[arg(long, env = "TUNNET_NO_MDNS")]
    pub no_mdns: bool,
    #[arg(long, env = "TUNNET_KEEP_ALIVE")]
    pub keep_alive: bool,
    #[arg(long, env = "TUNNET_NO_ENCRYPT_STATE")]
    pub no_encrypt_state: bool,
    #[cfg(windows)]
    #[arg(long, env = "TUNNET_WINTUN_FILE")]
    pub wintun_file: Option<String>,
}

pub fn init_logging(cli: &DaemonCli) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new("info,tunnet_agent=debug,tunnet_core=debug")
    });

    #[cfg(windows)]
    if std::env::var_os("TUNNET_SERVICE_MODE").is_some() {
        use std::fs::OpenOptions;
        use std::sync::{Arc, Mutex};

        let path = tunnet_core::StatePaths::system_dir().join("service.log");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(file) = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
        {
            #[derive(Clone)]
            struct FileWriter(Arc<Mutex<std::fs::File>>);
            impl std::io::Write for FileWriter {
                fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                    self.0.lock().unwrap_or_else(|e| e.into_inner()).write(buf)
                }
                fn flush(&mut self) -> std::io::Result<()> {
                    self.0.lock().unwrap_or_else(|e| e.into_inner()).flush()
                }
            }
            impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for FileWriter {
                type Writer = FileWriter;
                fn make_writer(&'a self) -> Self::Writer {
                    self.clone()
                }
            }

            let writer = FileWriter(Arc::new(Mutex::new(file)));
            let _ = tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_ansi(false)
                .with_writer(writer)
                .try_init();
            return;
        }
    }

    let sub = tracing_subscriber::fmt().with_env_filter(filter);
    if cli.json_logs {
        let _ = sub.json().try_init();
    } else {
        let _ = sub.try_init();
    }
}

fn paths(cli_state_dir: Option<&str>) -> StatePaths {
    StatePaths::resolve(cli_state_dir)
}

pub async fn run(state_dir: Option<&str>, args: RunArgs) -> anyhow::Result<()> {
    run_with_shutdown(args, state_dir, None, None).await
}

pub async fn run_with_shutdown(
    args: RunArgs,
    state_dir: Option<&str>,
    shutdown: Option<tokio_util::sync::CancellationToken>,
    mut on_ready: Option<tokio::sync::oneshot::Sender<()>>,
) -> anyhow::Result<()> {
    let paths = paths(state_dir);
    paths.ensure()?;

    let bootstrap_api = if !has_network_state(&paths) {
        let handle = start_idle_bootstrap(&paths, &mut on_ready).await?;
        wait_for_network_state(&paths, shutdown.as_ref()).await?;
        Some(handle)
    } else {
        None
    };
    if let Some(handle) = bootstrap_api {
        handle.abort();
        // Let the pipe / socket release before the full API rebinds.
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    if let Some(token) = &shutdown
        && token.is_cancelled()
    {
        return Ok(());
    }

    let policy = SealPolicy::from_env_and_flag(args.no_encrypt_state);
    let (identity, persisted, tier) = load_agent(&paths, policy).with_context(|| {
        format!(
            "no persisted identity in {}; run `tunnet enroll` or `tunnet create` first",
            paths.dir.display()
        )
    })?;
    match &persisted {
        PersistedState::Managed(m) => {
            tracing::info!(
                endpoint_id = %identity.endpoint_id_hex(),
                network = %m.network_name,
                control = %m.control_url,
                mode = "managed",
                seal = %tier.as_str(),
                "starting agent",
            );
        }
        PersistedState::Direct { networks } => {
            let names: Vec<_> = networks.iter().map(|d| d.network_name.as_str()).collect();
            tracing::info!(
                endpoint_id = %identity.endpoint_id_hex(),
                networks = %names.join(","),
                mode = "direct",
                seal = %tier.as_str(),
                "starting agent",
            );
        }
    }
    crate::runtime::run(identity, persisted, paths, args, shutdown, on_ready).await
}

fn has_network_state(paths: &StatePaths) -> bool {
    paths.secrets_file().is_file() && matches!(PersistedState::try_load(paths), Ok(Some(_)))
}

async fn start_idle_bootstrap(
    paths: &StatePaths,
    on_ready: &mut Option<tokio::sync::oneshot::Sender<()>>,
) -> anyhow::Result<tokio::task::JoinHandle<()>> {
    use std::sync::Arc;

    use tunnet_core::local_api::{BootstrapApiState, spawn_bootstrap_api};

    let bootstrap = Arc::new(crate::api_bootstrap::AgentBootstrapOps::new(paths.clone()));
    let (events_tx, _) = tokio::sync::broadcast::channel(256);
    let handle = spawn_bootstrap_api(BootstrapApiState {
        bootstrap,
        daemon_version: env!("CARGO_PKG_VERSION").to_string(),
        events: events_tx,
    })
    .await
    .context("start idle Local Management API")?;
    if let Some(tx) = on_ready.take() {
        let _ = tx.send(());
    }
    #[cfg(unix)]
    crate::sd_notify::ready("idle - Local API ready");
    Ok(handle)
}

async fn wait_for_network_state(
    paths: &StatePaths,
    shutdown: Option<&tokio_util::sync::CancellationToken>,
) -> anyhow::Result<()> {
    let mut logged = false;
    loop {
        if let Some(token) = shutdown
            && token.is_cancelled()
        {
            return Ok(());
        }
        let has_secrets = paths.secrets_file().is_file();
        if has_secrets && let Ok(Some(_)) = PersistedState::try_load(paths) {
            // Allow in-flight create/enroll HTTP responses to finish before we
            // tear down the bootstrap API listener.
            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
            return Ok(());
        }
        if !logged {
            tracing::info!(
                dir = %paths.dir.display(),
                "agent idle - waiting for `tunnet create`, `tunnet enroll`, or `tunnet join`"
            );
            logged = true;
        }
        if let Some(token) = shutdown {
            tokio::select! {
                _ = token.cancelled() => {
                    return Ok(());
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
            }
        } else {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }
}
