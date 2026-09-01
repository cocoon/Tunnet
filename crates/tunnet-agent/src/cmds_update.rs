//! `tunnet update` - download a newer release from GitHub and replace this binary.
//!
//! On Linux the default is a graceful reload (SIGHUP / `systemctl reload`),
//! which triggers ecdysis in the running agent. Pass `--restart` for a hard restart.

#[cfg(target_os = "linux")]
use anyhow::Context;
#[cfg(not(windows))]
use anyhow::Result;

#[cfg(not(windows))]
pub fn apply_service_reload(force_restart: bool) -> Result<()> {
    let probe = tunnet_service::probe();
    if !probe.installed {
        tracing::info!("service not installed; binary updated in place");
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        if force_restart {
            tracing::info!("restarting tunnet service");
            tunnet_service::restart(None)?;
        } else if std::path::Path::new("/etc/systemd/system/tunnet.service").exists() {
            tracing::info!("reloading tunnet service (graceful)");
            if tunnet_service::is_root() {
                let _ = tunnet_service::refresh_unit(None);
            }
            let status = std::process::Command::new("systemctl")
                .args(["reload", "tunnet"])
                .status()
                .context("systemctl reload")?;
            if !status.success() {
                anyhow::bail!("systemctl reload failed ({status})");
            }
        } else {
            tracing::warn!("service unit missing; start with: tunnet service start");
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let _ = force_restart;
        tracing::info!("restarting tunnet service");
        tunnet_service::restart(None)?;
        Ok(())
    }

    #[cfg(windows)]
    {
        let _ = force_restart;
        tracing::info!("restarting tunnet service");
        tunnet_service::restart(None)?;
        Ok(())
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = force_restart;
        Ok(())
    }
}
