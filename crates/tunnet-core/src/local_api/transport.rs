//! Cross-platform Local Management API transport: Unix domain sockets / Windows named pipes.

use std::io;
use std::path::{Path, PathBuf};

/// Resolve the fixed Local Management API endpoint path / pipe marker.
pub fn default_api_path() -> PathBuf {
    if let Ok(override_path) = std::env::var("TUNNET_API_PATH") {
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

/// Alias for callers still using the old name.
pub fn default_ipc_path() -> PathBuf {
    default_api_path()
}

/// Prefer system runtime dir when present (systemd `RuntimeDirectory=tunnet`), else `/tmp`.
#[cfg(unix)]
pub fn unix_api_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut push = |p: PathBuf| {
        if !paths.iter().any(|x| x == &p) {
            paths.push(p);
        }
    };

    if let Ok(override_path) = std::env::var("TUNNET_API_PATH") {
        push(PathBuf::from(override_path));
    }
    if let Ok(dir) = std::env::var("TUNNET_RUNTIME_DIR") {
        push(PathBuf::from(dir).join("tunnetd.sock"));
    }
    push(PathBuf::from("/run/tunnet/tunnetd.sock"));
    push(PathBuf::from("/tmp/tunnetd.sock"));
    paths
}

/// Path used when *binding* the listener (single socket).
#[cfg(unix)]
fn unix_bind_path() -> PathBuf {
    if let Ok(override_path) = std::env::var("TUNNET_API_PATH") {
        return PathBuf::from(override_path);
    }
    if let Ok(dir) = std::env::var("TUNNET_RUNTIME_DIR") {
        return PathBuf::from(dir).join("tunnetd.sock");
    }
    let run_dir = Path::new("/run/tunnet");
    if run_dir.is_dir() {
        return run_dir.join("tunnetd.sock");
    }
    PathBuf::from("/tmp/tunnetd.sock")
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
pub fn pipe_name_for() -> String {
    r"\\.\pipe\tunnetd".to_string()
}

/// Abstract listener accepting Local API connections.
pub struct ApiListener {
    #[cfg(unix)]
    unix: tokio::net::UnixListener,
    #[cfg(windows)]
    windows: WindowsListener,
    path: PathBuf,
}

#[cfg(windows)]
struct WindowsListener {
    /// Next server instance waiting for a client.
    pending: tokio::sync::Mutex<Option<tokio::net::windows::named_pipe::NamedPipeServer>>,
    marker: PathBuf,
}

/// Accepted duplex connection.
pub enum ApiStream {
    #[cfg(unix)]
    Unix(tokio::net::UnixStream),
    #[cfg(windows)]
    Windows(tokio::net::windows::named_pipe::NamedPipeServer),
}

impl ApiListener {
    pub async fn bind() -> anyhow::Result<(Self, PathBuf)> {
        #[cfg(unix)]
        let path = unix_bind_path();
        #[cfg(not(unix))]
        let path = default_api_path();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            if path.exists() {
                let _ = std::fs::remove_file(&path);
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let unix = tokio::net::UnixListener::bind(&path)?;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o660));
            tracing::info!(path = %path.display(), "Local API listening (unix)");
            Ok((
                Self {
                    unix,
                    path: path.clone(),
                },
                path,
            ))
        }
        #[cfg(windows)]
        {
            let marker = resolve_bind_marker(&path)?;
            if let Some(parent) = marker.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let name = pipe_name_for();
            std::fs::write(&marker, &name)?;
            let first = create_server_pipe(&name, true)?;
            tracing::info!(pipe = %name, marker = %marker.display(), "Local API listening (windows)");
            Ok((
                Self {
                    windows: WindowsListener {
                        pending: tokio::sync::Mutex::new(Some(first)),
                        marker: marker.clone(),
                    },
                    path: marker.clone(),
                },
                marker,
            ))
        }
        #[cfg(not(any(unix, windows)))]
        {
            anyhow::bail!("Local API not supported on this platform");
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn accept(&self) -> anyhow::Result<ApiStream> {
        #[cfg(unix)]
        {
            let (stream, _) = self.unix.accept().await?;
            Ok(ApiStream::Unix(stream))
        }
        #[cfg(windows)]
        {
            let name = pipe_name_for();
            let mut guard = self.windows.pending.lock().await;
            let server = guard.take().ok_or_else(|| {
                anyhow::anyhow!("Local API listener has no pending named pipe instance")
            })?;
            drop(guard);

            // Wait for the client on this instance first. Creating the next
            // instance before connect() races clients onto an unserved pipe.
            server.connect().await?;

            let next = create_server_pipe(&name, false)?;
            *self.windows.pending.lock().await = Some(next);
            Ok(ApiStream::Windows(server))
        }
        #[cfg(not(any(unix, windows)))]
        {
            anyhow::bail!("Local API not supported on this platform");
        }
    }
}

#[cfg(windows)]
fn resolve_bind_marker(preferred: &Path) -> io::Result<PathBuf> {
    if let Some(parent) = preferred.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(preferred.to_path_buf())
}

/// Create a named-pipe server instance that Authenticated Users can open.
///
/// Default SECURITY_ATTRIBUTES under Local System only allow SYSTEM, so a
/// normal user CLI (`tunnet status`) gets Access Denied even when the service
/// is healthy.
#[cfg(windows)]
fn create_server_pipe(
    name: &str,
    first_instance: bool,
) -> io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use tokio::net::windows::named_pipe::ServerOptions;
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows::core::w;

    // SYSTEM + Administrators + Authenticated Users: full access.
    // GRGW alone is not enough for CreateFile(GENERIC_READ|GENERIC_WRITE) on
    // named pipes under Local System - user CLIs get Access Denied.
    let sddl = w!("D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;IU)");
    let mut sd = PSECURITY_DESCRIPTOR::default();
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &mut sd, None)
            .map_err(|e| io::Error::other(format!("pipe SDDL: {e}")))?;
    }

    let mut attrs = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: sd.0,
        bInheritHandle: false.into(),
    };

    let result = unsafe {
        let mut opts = ServerOptions::new();
        if first_instance {
            opts.first_pipe_instance(true);
        }
        opts.create_with_security_attributes_raw(name, (&raw mut attrs).cast())
    };

    unsafe {
        let _ = LocalFree(Some(HLOCAL(sd.0 as _)));
    }

    result
}

impl Drop for ApiListener {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            let _ = std::fs::remove_file(&self.path);
        }
        #[cfg(windows)]
        {
            let _ = std::fs::remove_file(&self.windows.marker);
        }
    }
}

impl ApiStream {
    pub fn split(
        self,
    ) -> (
        Box<dyn tokio::io::AsyncRead + Unpin + Send>,
        Box<dyn tokio::io::AsyncWrite + Unpin + Send>,
    ) {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => {
                let (r, w) = stream.into_split();
                (Box::new(r), Box::new(w))
            }
            #[cfg(windows)]
            Self::Windows(pipe) => {
                let (r, w) = tokio::io::split(pipe);
                (Box::new(r), Box::new(w))
            }
        }
    }
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

        let pipe_name = resolve_windows_pipe_name(path);

        let mut last = None;
        for _ in 0..40 {
            match ClientOptions::new().open(&pipe_name) {
                Ok(pipe) => return Ok(ClientStream::Windows(pipe)),
                Err(e) => {
                    last = Some(e);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
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

#[cfg(windows)]
fn resolve_windows_pipe_name(path: &Path) -> String {
    let candidates = [path.to_path_buf(), system_api_marker_path()];
    for candidate in &candidates {
        if let Ok(s) = std::fs::read_to_string(candidate) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    // Named pipe is machine-global even when no marker is visible to this user.
    pipe_name_for()
}

/// Returns true when a live Local API endpoint is reachable.
pub async fn endpoint_reachable(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ClientOptions;
        let pipe_name = resolve_windows_pipe_name(path);
        ClientOptions::new().open(&pipe_name).is_ok()
    }
    #[cfg(unix)]
    {
        let _ = path;
        for candidate in unix_api_candidates() {
            if tokio::net::UnixStream::connect(&candidate).await.is_ok() {
                return true;
            }
        }
        false
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        false
    }
}

pub enum ClientStream {
    #[cfg(unix)]
    Unix(tokio::net::UnixStream),
    #[cfg(windows)]
    Windows(tokio::net::windows::named_pipe::NamedPipeClient),
}

impl ClientStream {
    pub fn split(
        self,
    ) -> (
        Box<dyn tokio::io::AsyncRead + Unpin + Send>,
        Box<dyn tokio::io::AsyncWrite + Unpin + Send>,
    ) {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => {
                let (r, w) = stream.into_split();
                (Box::new(r), Box::new(w))
            }
            #[cfg(windows)]
            Self::Windows(pipe) => {
                let (r, w) = tokio::io::split(pipe);
                (Box::new(r), Box::new(w))
            }
        }
    }
}
