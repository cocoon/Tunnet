//! Wait until the Local Management API endpoint accepts connections.
//!
//! SCM / systemd "running" is not enough — clients need the named pipe / socket.

use std::path::PathBuf;
use std::time::{Duration, Instant};

/// Candidate Local API paths (mirrors tunnet-core / tunnet-client).
fn api_candidates() -> Vec<PathBuf> {
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
    #[cfg(unix)]
    {
        if let Ok(dir) = std::env::var("TUNNET_RUNTIME_DIR") {
            push(PathBuf::from(dir).join("tunnetd.sock"));
        }
        push(PathBuf::from("/run/tunnet/tunnetd.sock"));
        push(PathBuf::from("/tmp/tunnetd.sock"));
    }
    #[cfg(windows)]
    {
        let base = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".into());
        push(
            PathBuf::from(base)
                .join("tunnet")
                .join("ipc")
                .join("tunnetd.pipe"),
        );
    }
    #[cfg(not(any(unix, windows)))]
    {
        push(PathBuf::from("tunnetd.api"));
    }
    paths
}

fn try_connect() -> bool {
    #[cfg(unix)]
    {
        for path in api_candidates() {
            if std::os::unix::net::UnixStream::connect(&path).is_ok() {
                return true;
            }
        }
        false
    }
    #[cfg(windows)]
    {
        try_connect_windows()
    }
    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}

#[cfg(windows)]
fn try_connect_windows() -> bool {
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    let mut names = Vec::new();
    for marker in api_candidates() {
        if let Ok(s) = std::fs::read_to_string(&marker) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                names.push(trimmed.to_string());
            }
        }
    }
    names.push(r"\\.\pipe\tunnetd".to_string());

    for name in names {
        let wide: Vec<u16> = std::ffi::OsStr::new(&name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: CreateFileW with a null-terminated pipe path; we close the handle if valid.
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                std::ptr::null_mut(),
            )
        };
        if handle != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(handle) };
            return true;
        }
    }
    false
}

/// Block until the Local API accepts a connection, or fail after `timeout`.
pub fn wait_for_local_api(timeout: Duration) -> anyhow::Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if try_connect() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            anyhow::bail!(
                "tunnetd Local API did not become ready within {}s.\n\
                 Check `tunnet status` or the service log under the state directory.",
                timeout.as_secs()
            );
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}
