use std::path::PathBuf;

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

/// Locate `tunnetd` next to the current executable (typically `tunnet`) or on `PATH`.
pub fn resolve_daemon_exe() -> anyhow::Result<PathBuf> {
    let name = if cfg!(windows) {
        "tunnetd.exe"
    } else {
        "tunnetd"
    };

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

    anyhow::bail!("could not find {name}; install tunnetd next to tunnet or on PATH")
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
