use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tunnet_core::{StatePaths, TunnetConfig};

#[cfg(not(windows))]
use crate::cmds_update::apply_service_reload;

const DEFAULT_HEALTH_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingUpdate {
    #[serde(with = "jiff::fmt::serde::timestamp::second::required")]
    installed_at_unix: jiff::Timestamp,
    from_version: String,
    to_version: String,
    api_version: u32,
    health_window_secs: u64,
    boots: u32,
}

pub fn on_agent_start(paths: &StatePaths) -> Result<()> {
    let pending_path = paths.update_pending_file();
    if !pending_path.exists() {
        return Ok(());
    }

    let mut pending: PendingUpdate =
        serde_json::from_slice(&std::fs::read(&pending_path).context("read update pending")?)
            .context("parse update pending")?;

    if pending.to_version != env!("CARGO_PKG_VERSION")
        || pending.api_version != tunnet_common::local_api::API_VERSION
    {
        tracing::error!(expected = %pending.to_version, running = env!("CARGO_PKG_VERSION"), "activated Core unit failed version/API verification; rolling back");
        rollback(paths, &pending)?;
        return Ok(());
    }

    let elapsed = jiff::Timestamp::now()
        .duration_since(pending.installed_at_unix)
        .as_secs()
        .max(0) as u64;
    let window = pending.health_window_secs.max(1);

    pending.boots = pending.boots.saturating_add(1);
    write_pending(paths, &pending)?;

    if pending.boots > 1 && elapsed < window {
        tracing::error!(
            boots = pending.boots,
            elapsed_secs = elapsed,
            window_secs = window,
            from = %pending.from_version,
            to = %pending.to_version,
            "new version unstable within health window; reverting"
        );
        rollback(paths, &pending)?;
        return Ok(());
    }

    if elapsed >= window {
        mark_update_success(paths, &pending)?;
        return Ok(());
    }

    let remaining = window - elapsed;
    let paths = paths.clone();
    let pending_clone = pending.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(remaining)).await;
        if let Err(e) = mark_update_success(&paths, &pending_clone) {
            tracing::warn!(?e, "failed to clear update pending after health window");
        } else {
            tracing::info!(
                to = %pending_clone.to_version,
                "auto-update healthy; previous binary discarded"
            );
            crate::core_update::publish_complete().await;
        }
    });

    Ok(())
}

fn mark_update_success(paths: &StatePaths, pending: &PendingUpdate) -> Result<()> {
    let pending_path = paths.update_pending_file();
    if !pending_path.exists() {
        return Ok(());
    }
    if let Ok(bytes) = std::fs::read(&pending_path)
        && let Ok(current) = serde_json::from_slice::<PendingUpdate>(&bytes)
        && current.to_version != pending.to_version
    {
        return Ok(());
    }
    let _ = std::fs::remove_file(&pending_path);
    let prev = paths.update_previous_dir();
    if prev.exists() {
        let _ = std::fs::remove_dir_all(&prev);
    }
    Ok(())
}

fn rollback(paths: &StatePaths, pending: &PendingUpdate) -> Result<()> {
    #[cfg(windows)]
    {
        let _ = pending;
        crate::core_update::schedule_rollback(paths)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        revert_to_previous(paths, Some(pending))
    }
}

pub fn revert_to_previous_worker(paths: &StatePaths) -> Result<()> {
    revert_to_previous(paths, None)
}

fn revert_to_previous(paths: &StatePaths, pending: Option<&PendingUpdate>) -> Result<()> {
    let previous = paths.update_previous_dir();
    if !previous.exists() {
        tracing::error!("cannot roll back Core update: previous installation unit missing");
        let _ = std::fs::remove_file(paths.update_pending_file());
        return Ok(());
    }

    #[cfg(windows)]
    let install = tunnet_service::installed_bin_dir(None);
    #[cfg(not(windows))]
    let install = std::env::current_exe()?
        .parent()
        .context("current_exe has no parent")?
        .to_path_buf();
    restore_unit(&previous, &install, core_unit_names())?;
    let _ = std::fs::remove_dir_all(&previous);
    let _ = std::fs::remove_file(paths.update_pending_file());

    if let Some(pending) = pending {
        tracing::warn!(restored = %pending.from_version, rejected = %pending.to_version, "reverted Core update; restarting service");
    } else {
        tracing::warn!("reverted Core update; restarting service");
    }
    #[cfg(windows)]
    let _ = tunnet_service::start(None);
    #[cfg(not(windows))]
    let _ = apply_service_reload(true);
    Ok(())
}

fn restore_unit(
    previous: &std::path::Path,
    install: &std::path::Path,
    names: &[&str],
) -> Result<()> {
    for name in names {
        let source = previous.join(name);
        if source.is_file() {
            replace_file(&source, &install.join(name))?;
        }
    }
    Ok(())
}

fn replace_file(src: &std::path::Path, dest: &std::path::Path) -> Result<()> {
    let staged = dest.with_extension("rollback");
    let rejected = dest.with_extension("rejected");
    let _ = std::fs::remove_file(&staged);
    let _ = std::fs::remove_file(&rejected);
    std::fs::copy(src, &staged)?;
    if dest.exists() {
        std::fs::rename(dest, &rejected)?;
    }
    std::fs::rename(staged, dest)?;
    let _ = std::fs::remove_file(rejected);
    Ok(())
}

#[cfg(windows)]
fn core_unit_names() -> &'static [&'static str] {
    &["tunnet.exe", "tunnetd.exe", "wintun.dll"]
}
#[cfg(not(windows))]
fn core_unit_names() -> &'static [&'static str] {
    &["tunnet", "tunnetd"]
}

fn write_pending(paths: &StatePaths, pending: &PendingUpdate) -> Result<()> {
    std::fs::create_dir_all(paths.update_dir())?;
    let json = serde_json::to_vec_pretty(pending)?;
    std::fs::write(paths.update_pending_file(), json)?;
    Ok(())
}

pub fn stage_pending(
    paths: &StatePaths,
    from: &str,
    to: &str,
    health_window_secs: u64,
) -> Result<()> {
    std::fs::create_dir_all(paths.update_dir())?;
    write_pending(
        paths,
        &PendingUpdate {
            installed_at_unix: jiff::Timestamp::now(),
            from_version: from.into(),
            to_version: to.into(),
            api_version: crate::core_update::SUPPORTED_API_VERSION,
            health_window_secs: if health_window_secs == 0 {
                DEFAULT_HEALTH_SECS
            } else {
                health_window_secs
            },
            boots: 0,
        },
    )
}

pub fn spawn(
    paths: StatePaths,
    store: Option<tunnet_core::EffectiveConfigStore>,
    updater: Arc<crate::core_update::CoreUpdater>,
) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            let (enabled, interval_hours) = if let Some(store) = &store {
                let effective = store.load();
                (
                    effective.effective.auto_update_enabled.value,
                    effective.effective.auto_update_check_interval_hours.value,
                )
            } else {
                let config = TunnetConfig::try_load(&paths)
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                (
                    config.update.enabled.unwrap_or(false),
                    config.update.check_interval_hours.unwrap_or(6),
                )
            };
            if enabled && !paths.update_pending_file().exists() {
                match updater.check().await {
                    Ok(status)
                        if status.phase == tunnet_common::local_api::CoreUpdatePhase::Available =>
                    {
                        if let Err(error) = updater.stage_and_activate(false).await {
                            tracing::warn!(?error, "automatic Core update failed");
                        }
                    }
                    Err(error) => tracing::warn!(?error, "automatic Core update check failed"),
                    _ => {}
                }
            }
            tokio::time::sleep(Duration::from_secs(if enabled {
                interval_hours.max(1) * 3600
            } else {
                3600
            }))
            .await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollback_restores_the_complete_previous_unit() {
        let temp = tempfile::tempdir().unwrap();
        let previous = temp.path().join("previous");
        let install = temp.path().join("bin");
        std::fs::create_dir_all(&previous).unwrap();
        std::fs::create_dir_all(&install).unwrap();
        for name in ["tunnet", "tunnetd", "wintun.dll"] {
            std::fs::write(previous.join(name), format!("old-{name}")).unwrap();
            std::fs::write(install.join(name), format!("new-{name}")).unwrap();
        }
        restore_unit(&previous, &install, &["tunnet", "tunnetd", "wintun.dll"]).unwrap();
        for name in ["tunnet", "tunnetd", "wintun.dll"] {
            assert_eq!(
                std::fs::read_to_string(install.join(name)).unwrap(),
                format!("old-{name}")
            );
        }
    }
}
