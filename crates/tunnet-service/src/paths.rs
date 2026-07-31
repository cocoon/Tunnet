use std::path::PathBuf;

#[cfg(windows)]
use std::path::Path;

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
    if let Some(path) = find_on_path(name) {
        return Ok(path);
    }
    anyhow::bail!("could not find {name}; place it next to tunnet or on PATH")
}

#[cfg(windows)]
pub fn daemon_outdated(state_dir: Option<&str>) -> anyhow::Result<bool> {
    let source = resolve_daemon_exe()?;
    let dest = installed_daemon_exe(state_dir);
    if !dest.is_file() {
        return Ok(true);
    }
    Ok(!same_artifact(&source, &dest))
}

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
    atomic_copy(&source, &dest)?;

    #[cfg(windows)]
    if let Some(dir) = source.parent() {
        let dll = dir.join("wintun.dll");
        if dll.is_file() {
            atomic_copy(&dll, &dest_dir.join("wintun.dll"))?;
        }
    }

    Ok(dest)
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
