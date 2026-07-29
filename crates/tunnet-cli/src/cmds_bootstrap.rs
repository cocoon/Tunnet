//! Bootstrap commands via the Local API (`tunnetd` must be running).

use std::collections::HashMap;

use anyhow::Context;
use clap::Args;
use tunnet_common::local_api::{
    AuthLoginRequest, DeviceExpiryRequest, DeviceLabelDeleteRequest, DeviceLabelRequest,
    DeviceTagAddRequest, DeviceTagRemoveRequest, LocalEnrollRequest, UpdateRequest,
};

use crate::cmds::ipc_or_err;

#[derive(Args, Debug)]
pub struct EnrollArgs {
    #[arg(
        long,
        env = "CONTROL_PLANE_URL",
        default_value = "http://127.0.0.1:8080"
    )]
    pub control_url: String,
    #[arg(long, env = "TUNNET_ENROLL_TOKEN", conflicts_with = "org")]
    pub token: Option<String>,
    #[arg(long, env = "TUNNET_ORG_SLUG", conflicts_with = "token")]
    pub org: Option<String>,
    #[arg(long, env = "TUNNET_NETWORK")]
    pub network: Option<String>,
    #[arg(long, env = "TUNNET_HOSTNAME")]
    pub hostname: Option<String>,
    #[arg(long, default_value_t = 600)]
    pub wait_secs: u64,
    #[arg(long, env = "TUNNET_LABELS", conflicts_with = "labels_json")]
    pub labels: Option<String>,
    #[arg(long, env = "TUNNET_LABELS_JSON", conflicts_with = "labels")]
    pub labels_json: Option<String>,
    #[arg(long, env = "TUNNET_EXPIRES_IN")]
    pub expires_in: Option<String>,
    #[arg(long, env = "TUNNET_NO_ENCRYPT_STATE")]
    pub no_encrypt_state: bool,
}

#[derive(Args, Debug)]
pub struct ResetArgs {
    #[arg(long)]
    pub yes: bool,
}

#[derive(Args, Debug)]
pub struct LoginArgs {
    #[arg(long, env = "MANAGEMENT_URL")]
    pub management_url: Option<String>,
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
}

#[derive(Args, Debug)]
pub struct LogoutArgs {
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
}

pub async fn run_enroll(args: EnrollArgs, state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = crate::cmds::ensure_daemon_running(state_dir, "enroll").await?;
    tunnet_service::ensure_admin()?;
    let labels = parse_labels(&args)?;
    let body = LocalEnrollRequest {
        control_url: args.control_url,
        token: args.token,
        org: args.org,
        network: args.network,
        hostname: args.hostname,
        wait_secs: args.wait_secs,
        labels,
        expires_in: args.expires_in,
        no_encrypt_state: args.no_encrypt_state,
    };
    let resp = match client.enroll(&body).await {
        Ok(resp) => resp,
        Err(e) if crate::cmds::is_api_connection_closed(&e) => {
            return crate::cmds::recover_bootstrap_result(state_dir, "enrolled", e).await;
        }
        Err(e) => return Err(e),
    };
    println!("{}", resp.message);
    Ok(())
}

pub async fn run_reset(args: ResetArgs, state_dir: Option<&str>) -> anyhow::Result<()> {
    tunnet_service::ensure_admin()?;

    let targets: Vec<std::path::PathBuf> = if let Some(dir) = state_dir {
        vec![std::path::PathBuf::from(dir)]
    } else if let Ok(env_dir) = std::env::var("TUNNET_STATE_DIR") {
        let env_dir = std::path::PathBuf::from(env_dir);
        let system = crate::state::StatePaths::system_dir();
        if env_dir == system {
            vec![system]
        } else {
            vec![system, env_dir]
        }
    } else {
        vec![crate::state::StatePaths::system_dir()]
    };

    if !args.yes {
        eprintln!("Re-run with --yes to wipe:");
        for dir in &targets {
            eprintln!("  {}", dir.display());
        }
        return Ok(());
    }

    // Daemon holds open files under the state dir; stop it before wiping.
    match tunnet_service::stop_for_reset() {
        Ok(()) => {
            if tunnet_service::probe().installed {
                println!("Stopped tunnet service.");
            }
        }
        Err(e) => {
            eprintln!("warning: could not stop service before reset: {e:#}");
        }
    }
    // Give the process a moment to release file handles.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Discard leftover per-user state from older installs (never migrate it back).
    discard_legacy_user_state();

    let mut wiped_any = false;
    for dir in &targets {
        if !dir.exists() {
            continue;
        }
        std::fs::remove_dir_all(dir)
            .with_context(|| format!("wipe {} (is tunnetd still running?)", dir.display()))?;
        println!("Wiped {}", dir.display());
        wiped_any = true;
    }
    if !wiped_any {
        println!("Nothing to wipe.");
    }
    Ok(())
}

fn discard_legacy_user_state() {
    let Some(user) = legacy_user_state_dir() else {
        return;
    };
    if user == crate::state::StatePaths::system_dir() || !user.exists() {
        return;
    }
    match std::fs::remove_dir_all(&user) {
        Ok(()) => println!("Discarded legacy user state {}", user.display()),
        Err(e) => eprintln!(
            "warning: could not remove legacy user state {}: {e}",
            user.display()
        ),
    }
}

fn legacy_user_state_dir() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|b| std::path::PathBuf::from(b).join("tunnet"))
    }
    #[cfg(unix)]
    {
        if let Ok(xdg) = std::env::var("XDG_STATE_HOME") {
            return Some(std::path::PathBuf::from(xdg).join("tunnet"));
        }
        std::env::var("HOME")
            .ok()
            .map(|h| std::path::PathBuf::from(h).join(".local/state/tunnet"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

pub async fn run_login(args: LoginArgs, state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir.or(args.state_dir.as_deref())).await?;
    let body = AuthLoginRequest {
        management_url: args.management_url,
    };
    let resp = client.auth_login(&body).await?;
    println!("{}", resp.message);
    Ok(())
}

pub async fn run_logout(args: LogoutArgs, state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir.or(args.state_dir.as_deref())).await?;
    let resp = client.auth_logout().await?;
    println!("{}", resp.message);
    Ok(())
}

pub async fn run_update(
    args: crate::cmds_update::UpdateArgs,
    state_dir: Option<&str>,
) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir).await?;
    let body = UpdateRequest {
        check: args.check,
        force: args.force,
        restart: args.restart,
        version: args.version,
    };
    let resp = client.update(&body).await?;
    println!("{}", resp.message);
    Ok(())
}

pub async fn device_labels_set(pairs: &[String], state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir).await?;
    let labels = parse_label_pairs(pairs)?;
    let resp = client
        .device_labels_set(&DeviceLabelRequest { labels })
        .await?;
    println!("{}", resp.message);
    Ok(())
}

pub async fn device_labels_delete(key: &str, state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir).await?;
    let resp = client
        .device_labels_delete(&DeviceLabelDeleteRequest {
            key: key.to_string(),
        })
        .await?;
    println!("{}", resp.message);
    Ok(())
}

pub async fn device_tags_add(tag: &str, state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir).await?;
    let resp = client
        .device_tags_add(&DeviceTagAddRequest {
            tag: tag.to_string(),
        })
        .await?;
    println!("{}", resp.message);
    Ok(())
}

pub async fn device_tags_remove(tag: &str, state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir).await?;
    let resp = client
        .device_tags_remove(&DeviceTagRemoveRequest {
            tag: tag.to_string(),
        })
        .await?;
    println!("{}", resp.message);
    Ok(())
}

pub async fn device_expiry(duration: &str, state_dir: Option<&str>) -> anyhow::Result<()> {
    let client = ipc_or_err(state_dir).await?;
    let resp = client
        .device_expiry(&DeviceExpiryRequest {
            duration: duration.to_string(),
        })
        .await?;
    println!("{}", resp.message);
    Ok(())
}

fn parse_labels(args: &EnrollArgs) -> anyhow::Result<Option<HashMap<String, String>>> {
    match (&args.labels, &args.labels_json) {
        (Some(csv), None) => Ok(Some(parse_label_csv(csv)?)),
        (None, Some(json)) => Ok(Some(parse_labels_json(json)?)),
        (None, None) => Ok(None),
        _ => unreachable!("clap conflicts_with"),
    }
}

fn parse_label_csv(csv: &str) -> anyhow::Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    for part in csv.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (k, v) = part
            .split_once('=')
            .with_context(|| format!("invalid label pair {part:?} (expected key=value)"))?;
        out.insert(k.trim().to_string(), v.trim().to_string());
    }
    Ok(out)
}

fn parse_labels_json(json: &str) -> anyhow::Result<HashMap<String, String>> {
    serde_json::from_str(json).context("parse labels JSON")
}

fn parse_label_pairs(pairs: &[String]) -> anyhow::Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    for p in pairs {
        let (k, v) = p
            .split_once('=')
            .with_context(|| format!("invalid label {p:?} (expected key=value)"))?;
        out.insert(k.to_string(), v.to_string());
    }
    Ok(out)
}
