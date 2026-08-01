use std::path::{Path, PathBuf};

/// System-wide state directory used by the Tunnet service.
pub fn system_state_dir() -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from("/var/lib/tunnet")
    }
    #[cfg(windows)]
    {
        let base = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".into());
        PathBuf::from(base).join("tunnet")
    }
    #[cfg(not(any(unix, windows)))]
    {
        PathBuf::from("./tunnet-state")
    }
}

pub fn resolve_state_dir(state_dir: Option<&str>) -> PathBuf {
    state_dir
        .map(PathBuf::from)
        .unwrap_or_else(system_state_dir)
}

fn daemon_name() -> &'static str {
    if cfg!(windows) {
        "tunnetd.exe"
    } else {
        "tunnetd"
    }
}

#[cfg(windows)]
fn cli_name() -> &'static str {
    "tunnet.exe"
}

/// Canonical directory for service/daemon binaries on Windows.
///
/// Layout (Windows): `%ProgramData%\tunnet\bin\` holds the *active* copies of
/// `tunnet.exe`, `tunnetd.exe`, and `wintun.dll`. SCM always points at
/// `tunnetd.exe` here. The desktop app may live under Program Files / NSIS
/// `$INSTDIR`; install/update paths must stage into this directory via
/// [`stage_daemon_exe`] so users never have competing "active" daemon copies.
#[cfg(windows)]
pub fn installed_bin_dir(state_dir: Option<&str>) -> PathBuf {
    resolve_state_dir(state_dir).join("bin")
}

#[cfg(windows)]
pub fn installed_daemon_exe(state_dir: Option<&str>) -> PathBuf {
    installed_bin_dir(state_dir).join(daemon_name())
}

pub fn resolve_daemon_exe() -> anyhow::Result<PathBuf> {
    let name = daemon_name();
    if let Ok(current) = std::env::current_exe()
        && let Some(dir) = current.parent()
    {
        let beside = dir.join(name);
        if beside.is_file() {
            return Ok(beside);
        }
    }
    #[cfg(windows)]
    {
        let staged = installed_daemon_exe(None);
        if staged.is_file() {
            return Ok(staged);
        }
    }
    if let Some(path) = find_on_path(name) {
        return Ok(path);
    }
    anyhow::bail!("could not find {name}; place it next to tunnet or on PATH")
}

#[cfg(windows)]
pub fn daemon_outdated(state_dir: Option<&str>) -> anyhow::Result<bool> {
    let source = resolve_daemon_exe()?;
    let dest = installed_daemon_exe(state_dir);
    // Source may already *be* the staged binary (e.g. running from ProgramData).
    let source_canon = source.canonicalize().unwrap_or_else(|_| source.clone());
    let dest_canon = dest.canonicalize().unwrap_or_else(|_| dest.clone());
    if source_canon == dest_canon {
        return Ok(false);
    }
    if !dest.is_file() {
        return Ok(true);
    }
    Ok(!same_artifact(&source, &dest))
}

/// Stage daemon (+ CLI + wintun) into [`installed_bin_dir`] and return the
/// staged `tunnetd` path. This is the only path SCM should run.
#[cfg(windows)]
pub fn stage_daemon_exe(state_dir: Option<&str>) -> anyhow::Result<PathBuf> {
    let source = {
        let s = resolve_daemon_exe()?;
        s.canonicalize().unwrap_or(s)
    };
    let dest_dir = installed_bin_dir(state_dir);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| anyhow::anyhow!("create {}: {e}", dest_dir.display()))?;
    let dest = installed_daemon_exe(state_dir);

    let source_is_dest = source
        .canonicalize()
        .ok()
        .zip(dest.canonicalize().ok())
        .is_some_and(|(a, b)| a == b);
    if !source_is_dest {
        atomic_copy(&source, &dest)?;
    }

    if let Some(dir) = source.parent() {
        let cli = dir.join(cli_name());
        if cli.is_file() {
            atomic_copy(&cli, &dest_dir.join(cli_name()))?;
        }
        let dll = dir.join("wintun.dll");
        if dll.is_file() {
            atomic_copy(&dll, &dest_dir.join("wintun.dll"))?;
        }
    }

    Ok(dest)
}

/// Wipe enrollment/config state under `dir`, preserving `bin/` (staged service binaries).
pub fn wipe_state_dir(dir: &Path) -> anyhow::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in
        std::fs::read_dir(dir).map_err(|e| anyhow::anyhow!("read {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| anyhow::anyhow!("read {}: {e}", dir.display()))?;
        let path = entry.path();
        if entry.file_name() == "bin" {
            continue;
        }
        if path.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                anyhow::anyhow!("wipe {} (is tunnetd still running?): {e}", path.display())
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                anyhow::anyhow!("wipe {} (is tunnetd still running?): {e}", path.display())
            })?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn atomic_copy(source: &Path, dest: &Path) -> anyhow::Result<()> {
    if dest.is_file() && same_artifact(source, dest) {
        return Ok(());
    }
    let tmp = dest.with_extension("staging");
    std::fs::copy(source, &tmp)
        .map_err(|e| anyhow::anyhow!("copy {} → {}: {e}", source.display(), tmp.display()))?;
    #[cfg(windows)]
    {
        // On Windows, replace via remove+rename; ReplaceFile is overkill here.
        if dest.exists() {
            std::fs::remove_file(dest).map_err(|e| {
                anyhow::anyhow!(
                    "replace {}: {e} (stop the tunnet service first)",
                    dest.display()
                )
            })?;
        }
        std::fs::rename(&tmp, dest)
            .map_err(|e| anyhow::anyhow!("rename {} → {}: {e}", tmp.display(), dest.display()))?;
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(&tmp, dest)
            .map_err(|e| anyhow::anyhow!("rename {} → {}: {e}", tmp.display(), dest.display()))?;
    }
    Ok(())
}

#[cfg(windows)]
fn same_artifact(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else {
        return false;
    };
    if ma.len() != mb.len() {
        return false;
    }
    match (ma.modified(), mb.modified()) {
        (Ok(ta), Ok(tb)) => ta == tb,
        _ => false,
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::system_state_dir;

    #[test]
    fn system_dir_matches_platform() {
        #[cfg(unix)]
        assert_eq!(
            system_state_dir(),
            std::path::PathBuf::from("/var/lib/tunnet")
        );
        #[cfg(windows)]
        {
            let dir = system_state_dir();
            assert!(dir.ends_with("tunnet"), "got {}", dir.display());
        }
    }
}
