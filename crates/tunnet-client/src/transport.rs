//! Client-side Local Management API transport: Unix sockets / Windows named pipes.

use std::io;
use std::path::{Path, PathBuf};

/// Resolve the fixed Local Management API endpoint path / pipe marker.
pub fn default_api_path() -> PathBuf {
    if let Ok(override_path) =
        std::env::var("TUNNET_API_PATH").or_else(|_| std::env::var("TUNNET_IPC_PATH"))
    {
        return PathBuf::from(override_path);
    }
    #[cfg(unix)]
    {
        unix_api_candidates()
            .into_iter()
            .next()
            .unwrap_or_else(|| PathBuf::from("/tmp/tunnetd.sock"))
    }
    #[cfg(windows)]
    {
        system_api_marker_path()
    }
    #[cfg(not(any(unix, windows)))]
    {
        PathBuf::from("tunnetd.api")
    }
}

#[cfg(unix)]
fn unix_api_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut push = |p: PathBuf| {
        if !paths.iter().any(|x| x == &p) {
            paths.push(p);
        }
    };
    if let Ok(override_path) =
        std::env::var("TUNNET_API_PATH").or_else(|_| std::env::var("TUNNET_IPC_PATH"))
    {
        push(PathBuf::from(override_path));
    }
    if let Ok(dir) = std::env::var("TUNNET_RUNTIME_DIR") {
        push(PathBuf::from(dir).join("tunnetd.sock"));
    }
    push(PathBuf::from("/run/tunnet/tunnetd.sock"));
    push(PathBuf::from("/tmp/tunnetd.sock"));
    paths
}

#[cfg(windows)]
fn system_api_marker_path() -> PathBuf {
    let base = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".into());
    PathBuf::from(base)
        .join("tunnet")
        .join("ipc")
        .join("tunnetd.pipe")
}

#[cfg(windows)]
fn pipe_name_for() -> String {
    r"\\.\pipe\tunnetd".to_string()
}

/// Client-side connect to a running Local API endpoint.
pub async fn connect(path: &Path) -> io::Result<ClientStream> {
    #[cfg(unix)]
    {
        let mut last = None;
        let mut tried = std::collections::HashSet::new();
        for candidate in std::iter::once(path.to_path_buf()).chain(unix_api_candidates()) {
            if !tried.insert(candidate.clone()) {
                continue;
            }
            match tokio::net::UnixStream::connect(&candidate).await {
                Ok(stream) => return Ok(ClientStream::Unix(stream)),
                Err(e) => last = Some(e),
            }
        }
        Err(last.unwrap_or_else(|| io::Error::other("unix socket connect failed")))
    }
    #[cfg(windows)]
    {
        use std::time::Duration;
        use tokio::net::windows::named_pipe::ClientOptions;

        let mut last = None;
        for _ in 0..40 {
            for pipe_name in windows_pipe_candidates(path) {
                match ClientOptions::new().open(&pipe_name) {
                    Ok(pipe) => return Ok(ClientStream::Windows(pipe)),
                    Err(e) => last = Some(e),
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err(last.unwrap_or_else(|| io::Error::other("named pipe connect failed")))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Local API not supported on this platform",
        ))
    }
}

/// Prefer a live pipe: try marker files (system then user) then the default name.
#[cfg(windows)]
fn windows_pipe_candidates(preferred_marker: &Path) -> Vec<String> {
    let mut names = Vec::new();
    let mut push = |n: String| {
        if !names.iter().any(|x| x == &n) {
            names.push(n);
        }
    };

    for candidate in [preferred_marker.to_path_buf(), system_api_marker_path()] {
        if let Ok(s) = std::fs::read_to_string(&candidate) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                push(trimmed.to_string());
            }
        }
    }
    push(pipe_name_for());
    names
}

/// Returns true when a live Local API endpoint is reachable.
pub async fn endpoint_reachable(path: &Path) -> bool {
    connect(path).await.is_ok()
}

pub enum ClientStream {
    #[cfg(unix)]
    Unix(tokio::net::UnixStream),
    #[cfg(windows)]
    Windows(tokio::net::windows::named_pipe::NamedPipeClient),
}
