//! Wait until the Local Management API is actually serving HTTP.
//!
//! SCM / systemd "running" only means the process exists. Ready means
//! `GET /v1/meta` succeeds over the named pipe / Unix socket.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn api_path() -> PathBuf {
    if let Ok(path) = std::env::var("TUNNET_API_PATH") {
        return PathBuf::from(path);
    }
    #[cfg(unix)]
    {
        if let Ok(dir) = std::env::var("TUNNET_RUNTIME_DIR") {
            return PathBuf::from(dir).join("tunnetd.sock");
        }
        let run = PathBuf::from("/run/tunnet/tunnetd.sock");
        if run.parent().is_some_and(|p| p.is_dir()) {
            return run;
        }
        PathBuf::from("/tmp/tunnetd.sock")
    }
    #[cfg(windows)]
    {
        let base = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".into());
        PathBuf::from(base)
            .join("tunnet")
            .join("ipc")
            .join("tunnetd.pipe")
    }
    #[cfg(not(any(unix, windows)))]
    {
        PathBuf::from("tunnetd.api")
    }
}

fn meta_ready() -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;
        let path = api_path();
        let Ok(mut stream) = UnixStream::connect(&path) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        http_ok(&mut stream, "/v1/meta")
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::io::{FromRawHandle, RawHandle};

        use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::Storage::FileSystem::{
            CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        };

        let marker = api_path();
        let pipe = std::fs::read_to_string(&marker)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| r"\\.\pipe\tunnetd".into());

        let wide: Vec<u16> = std::ffi::OsStr::new(&pipe)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: null-terminated pipe path; File takes ownership on success.
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
        if handle == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut file = unsafe { std::fs::File::from_raw_handle(handle as RawHandle) };
        http_ok(&mut file, "/v1/meta")
    }
    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}

fn http_ok(stream: &mut (impl Read + Write), path: &str) -> bool {
    let req = format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() || stream.flush().is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    if n < 12 {
        return false;
    }
    // "HTTP/1.1 200"
    let head = match std::str::from_utf8(&buf[..n]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    head.as_bytes().get(9).is_some_and(|b| *b == b'2')
}

/// Block until `GET /v1/meta` succeeds, or fail after `timeout`.
pub fn wait_for_local_api(timeout: Duration) -> anyhow::Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if meta_ready() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            anyhow::bail!(
                "tunnetd Local API did not become ready within {}s (`GET /v1/meta`).\n\
                 Check `tunnet status` or the service log under the state directory.",
                timeout.as_secs()
            );
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}
