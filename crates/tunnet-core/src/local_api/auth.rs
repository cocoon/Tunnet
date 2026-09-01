//! Peer identity and role checks for Local Management API connections.

use tunnet_common::local_api::permissions::{
    self, DATA_PLANE_WRITE, DIAG_READ, DNS_READ, EVENTS_READ, FIREWALL_WRITE, LIFECYCLE,
    NETWORK_ADMIT, NETWORK_INVITE, POLICY_WRITE, ROUTES_READ, SEND, SERVE, SSH, STATUS_READ,
    TUNNEL,
};
use tunnet_common::local_api::{ApiError, ApiErrorCode};

/// OS-level identity of the connecting peer.
#[derive(Debug, Clone)]
pub struct PeerIdentity {
    #[cfg(unix)]
    pub uid: u32,
    #[cfg(unix)]
    pub gid: u32,
    #[cfg(unix)]
    pub pid: u32,
    /// True when the peer is Administrators / SYSTEM (Windows) or root (Unix).
    pub elevated: bool,
    /// True when the peer is the same OS user as the daemon process.
    /// Lets a user-mode `tunnetd` accept lifecycle commands from its owner
    /// without requiring a second elevation step.
    pub same_user: bool,
}

/// Authorization role derived from [`PeerIdentity`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalRole {
    Observer,
    Operator,
    NetworkAdmin,
    SystemAdmin,
}

impl LocalRole {
    pub fn capabilities(&self) -> Vec<&'static str> {
        let mut caps = vec![STATUS_READ, EVENTS_READ, DNS_READ, ROUTES_READ, DIAG_READ];
        match self {
            LocalRole::Observer => {}
            LocalRole::Operator => {
                caps.extend([DATA_PLANE_WRITE, SEND, SSH, SERVE, TUNNEL]);
            }
            LocalRole::NetworkAdmin => {
                caps.extend([
                    DATA_PLANE_WRITE,
                    SEND,
                    SSH,
                    SERVE,
                    TUNNEL,
                    NETWORK_INVITE,
                    NETWORK_ADMIT,
                    FIREWALL_WRITE,
                    POLICY_WRITE,
                ]);
            }
            LocalRole::SystemAdmin => {
                caps.extend([
                    DATA_PLANE_WRITE,
                    SEND,
                    SSH,
                    SERVE,
                    TUNNEL,
                    NETWORK_INVITE,
                    NETWORK_ADMIT,
                    FIREWALL_WRITE,
                    POLICY_WRITE,
                    LIFECYCLE,
                ]);
            }
        }
        caps
    }
}

impl PeerIdentity {
    pub fn role(&self) -> LocalRole {
        if self.elevated || self.same_user {
            LocalRole::SystemAdmin
        } else {
            LocalRole::NetworkAdmin
        }
    }

    pub fn capabilities(&self) -> Vec<&'static str> {
        self.role().capabilities()
    }

    pub fn require_cap(&self, cap: &str) -> Result<(), ApiError> {
        if self.capabilities().contains(&cap) {
            return Ok(());
        }
        let message = if cap == permissions::LIFECYCLE {
            elevated_required_message().into()
        } else {
            format!("missing capability: {cap}")
        };
        Err(ApiError {
            code: ApiErrorCode::Denied,
            message,
        })
    }

    /// Require at least `status.read`.
    pub fn require_standard(&self) -> Result<(), ApiError> {
        self.require_cap(STATUS_READ)
    }

    /// Require `lifecycle` (enroll / reset / create).
    pub fn require_elevated(&self) -> Result<(), ApiError> {
        self.require_cap(LIFECYCLE)
    }
}

fn elevated_required_message() -> &'static str {
    #[cfg(windows)]
    {
        "elevated privileges required (re-run from an elevated prompt, or approve UAC)"
    }
    #[cfg(not(windows))]
    {
        "elevated privileges required (re-run with sudo)"
    }
}

/// Extract peer credentials from an accepted Unix stream (`SO_PEERCRED`).
#[cfg(unix)]
pub fn peer_identity_from_unix(stream: &tokio::net::UnixStream) -> PeerIdentity {
    let daemon_uid = unsafe { libc::geteuid() };
    match stream.peer_cred() {
        Ok(cred) => {
            let uid = cred.uid();
            PeerIdentity {
                uid,
                gid: cred.gid(),
                pid: cred.pid().unwrap_or(0) as u32,
                elevated: uid == 0,
                same_user: uid == daemon_uid,
            }
        }
        Err(e) => {
            tracing::warn!(?e, "failed to read SO_PEERCRED; treating as observer");
            PeerIdentity {
                uid: u32::MAX,
                gid: u32::MAX,
                pid: 0,
                elevated: false,
                same_user: false,
            }
        }
    }
}

/// Classify a Windows named-pipe peer.
///
/// Uses the client process token when available. Administrators and SYSTEM are
/// elevated; other Authenticated Users are standard unless they match the
/// daemon's user (user-mode `tunnetd`).
#[cfg(windows)]
pub fn peer_identity_from_windows(
    pipe: &tokio::net::windows::named_pipe::NamedPipeServer,
) -> PeerIdentity {
    match windows_peer_identity(pipe) {
        Ok(id) => id,
        Err(e) => {
            tracing::warn!(
                ?e,
                "failed to classify named-pipe peer; treating as observer"
            );
            PeerIdentity {
                elevated: false,
                same_user: false,
            }
        }
    }
}

#[cfg(windows)]
fn windows_peer_identity(
    pipe: &tokio::net::windows::named_pipe::NamedPipeServer,
) -> std::io::Result<PeerIdentity> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        EqualSid, GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER, TokenElevation,
        TokenUser,
    };
    use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = HANDLE(pipe.as_raw_handle());
    let mut pid = 0u32;
    unsafe {
        GetNamedPipeClientProcessId(handle, &mut pid)
            .map_err(|e| std::io::Error::other(format!("GetNamedPipeClientProcessId: {e}")))?;
    }
    if pid == 0 {
        return Ok(PeerIdentity {
            elevated: false,
            same_user: false,
        });
    }

    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .map_err(|e| std::io::Error::other(format!("OpenProcess: {e}")))?;
        let mut token = HANDLE::default();
        let open_ok = OpenProcessToken(process, TOKEN_QUERY, &mut token);
        let _ = CloseHandle(process);
        open_ok.map_err(|e| std::io::Error::other(format!("OpenProcessToken: {e}")))?;

        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret_len = 0u32;
        let info_ok = GetTokenInformation(
            token,
            TokenElevation,
            Some((&raw mut elevation).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        );
        if info_ok.is_err() {
            let _ = CloseHandle(token);
            return Err(std::io::Error::other(format!(
                "GetTokenInformation: {}",
                info_ok.err().unwrap()
            )));
        }
        let elevated = elevation.TokenIsElevated != 0;

        // TokenUser is variable-sized; allocate a buffer.
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        let mut buf = vec![0u8; needed as usize];
        GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr().cast()),
            needed,
            &mut needed,
        )
        .map_err(|e| std::io::Error::other(format!("TokenUser: {e}")))?;
        let peer_user = &*(buf.as_ptr() as *const TOKEN_USER);
        let peer_sid = peer_user.User.Sid;

        let mut self_token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut self_token)
            .map_err(|e| std::io::Error::other(format!("OpenProcessToken(self): {e}")))?;
        let mut self_needed = 0u32;
        let _ = GetTokenInformation(self_token, TokenUser, None, 0, &mut self_needed);
        let mut self_buf = vec![0u8; self_needed as usize];
        let self_ok = GetTokenInformation(
            self_token,
            TokenUser,
            Some(self_buf.as_mut_ptr().cast()),
            self_needed,
            &mut self_needed,
        );
        let _ = CloseHandle(self_token);
        let _ = CloseHandle(token);
        self_ok.map_err(|e| std::io::Error::other(format!("TokenUser(self): {e}")))?;
        let self_user = &*(self_buf.as_ptr() as *const TOKEN_USER);
        // windows-rs EqualSid: Ok(()) means SIDs are equal.
        let same_user = EqualSid(peer_sid, self_user.User.Sid).is_ok();

        Ok(PeerIdentity {
            elevated,
            same_user,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_user_can_read_but_cannot_install_updates() {
        let peer = PeerIdentity {
            #[cfg(unix)]
            uid: 1000,
            #[cfg(unix)]
            gid: 1000,
            #[cfg(unix)]
            pid: 1,
            elevated: false,
            same_user: false,
        };

        assert!(peer.require_cap(STATUS_READ).is_ok());
        assert!(peer.require_elevated().is_err());
    }
}
