mod elevated_rpc;
mod state;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use state::DesktopState;
use tauri::{
    AppHandle, Emitter, Manager, State,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_opener::OpenerExt;
use tunnet_client::{TunnetClient, endpoint_reachable};
use tunnet_common::local_api::{
    DataPlaneStatus, DiagInfo, DirectFirewallAddRequest, DirectFirewallRemoveRequest,
    DirectInviteRequest, DirectInviteResponse, DirectPeerRequest, DirectPendingResponse,
    DnsStatusInfo, LocalEnrollRequest, LocalEvent, MetaInfo, NetcheckInfo, NetworkCreateRequest,
    NetworkJoinRequest, NetworkLeaveRequest, NetworksResponse, NodeSummary, OkResponse,
    PeersResponse, ResetRequest, RoutesInfo, SendFileRequest, ServeInfo, ServeStartRequest,
    ServesResponse, SshRecordingsResponse, SshSessionsResponse, TransferInfo, TransfersResponse,
    TunnelInfo, TunnelStartRequest, TunnelsResponse,
};
use tunnet_service::{self, ServiceProbe};

#[derive(Serialize)]
struct ServiceProbeDto {
    installed: bool,
    active: bool,
    state: String,
}

impl From<ServiceProbe> for ServiceProbeDto {
    fn from(value: ServiceProbe) -> Self {
        Self {
            installed: value.installed,
            active: value.active,
            state: value.state,
        }
    }
}

#[derive(Serialize)]
struct DaemonProbeResult {
    reachable: bool,
    service: ServiceProbeDto,
    meta: Option<MetaInfo>,
}

static EVENTS_RUNNING: AtomicBool = AtomicBool::new(false);

async fn with_client<T, F, Fut>(state: &State<'_, DesktopState>, f: F) -> Result<T, String>
where
    F: FnOnce(TunnetClient) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<T>>,
{
    let client = state.client().await.map_err(|e| e.to_string())?;
    f(client).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn daemon_probe(state: State<'_, DesktopState>) -> Result<DaemonProbeResult, String> {
    let service = tunnet_service::probe();
    let path = state.api_path();
    let reachable = endpoint_reachable(&path).await;
    let meta = if reachable {
        match state.client().await {
            Ok(client) => client.meta().await.ok(),
            Err(_) => None,
        }
    } else {
        None
    };
    Ok(DaemonProbeResult {
        reachable,
        service: service.into(),
        meta,
    })
}

#[tauri::command]
async fn meta(state: State<'_, DesktopState>) -> Result<MetaInfo, String> {
    with_client(&state, |c| async move { c.meta().await }).await
}

#[tauri::command]
async fn node(state: State<'_, DesktopState>) -> Result<NodeSummary, String> {
    with_client(&state, |c| async move { c.node().await }).await
}

#[tauri::command]
async fn networks(state: State<'_, DesktopState>) -> Result<NetworksResponse, String> {
    with_client(&state, |c| async move { c.networks().await }).await
}

#[tauri::command]
async fn network_peers(
    state: State<'_, DesktopState>,
    network_id: String,
) -> Result<PeersResponse, String> {
    with_client(
        &state,
        |c| async move { c.network_peers(&network_id).await },
    )
    .await
}

#[tauri::command]
async fn network_routes(
    state: State<'_, DesktopState>,
    network_id: String,
) -> Result<RoutesInfo, String> {
    with_client(
        &state,
        |c| async move { c.network_routes(&network_id).await },
    )
    .await
}

#[tauri::command]
async fn network_firewall(
    state: State<'_, DesktopState>,
    network_id: String,
) -> Result<tunnet_common::local_api::DirectFirewallResponse, String> {
    with_client(
        &state,
        |c| async move { c.network_firewall(&network_id).await },
    )
    .await
}

#[tauri::command]
async fn network_join_requests(
    state: State<'_, DesktopState>,
    network_id: String,
) -> Result<DirectPendingResponse, String> {
    with_client(&state, |c| async move {
        c.network_join_requests(&network_id).await
    })
    .await
}

#[tauri::command]
async fn network_join_accept(
    state: State<'_, DesktopState>,
    network_id: String,
    peer_id: String,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.network_join_accept(&network_id, &peer_id).await
    })
    .await
}

#[tauri::command]
async fn network_join_deny(
    state: State<'_, DesktopState>,
    network_id: String,
    peer_id: String,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.network_join_deny(&network_id, &peer_id).await
    })
    .await
}

#[tauri::command]
async fn data_plane_up(state: State<'_, DesktopState>) -> Result<OkResponse, String> {
    with_client(&state, |c| async move { c.data_plane_up().await }).await
}

#[tauri::command]
async fn data_plane_down(state: State<'_, DesktopState>) -> Result<OkResponse, String> {
    with_client(&state, |c| async move { c.data_plane_down().await }).await
}

#[tauri::command]
async fn data_plane_status(state: State<'_, DesktopState>) -> Result<DataPlaneStatus, String> {
    with_client(&state, |c| async move { c.data_plane_status().await }).await
}

#[tauri::command]
async fn network_create(
    _state: State<'_, DesktopState>,
    body: NetworkCreateRequest,
) -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::NetworkCreate { body }).await
}

#[tauri::command]
async fn network_join(
    _state: State<'_, DesktopState>,
    body: NetworkJoinRequest,
) -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::NetworkJoin { body }).await
}

#[tauri::command]
async fn enroll(
    _state: State<'_, DesktopState>,
    body: LocalEnrollRequest,
) -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::Enroll { body }).await
}

#[tauri::command]
async fn network_leave(
    _state: State<'_, DesktopState>,
    body: NetworkLeaveRequest,
) -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::NetworkLeave { body }).await
}

#[tauri::command]
async fn reset(_state: State<'_, DesktopState>, body: ResetRequest) -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::Reset { body }).await
}

#[tauri::command]
async fn direct_invite(
    state: State<'_, DesktopState>,
    body: DirectInviteRequest,
) -> Result<DirectInviteResponse, String> {
    with_client(&state, |c| async move { c.direct_invite(&body).await }).await
}

#[tauri::command]
async fn direct_accept(
    state: State<'_, DesktopState>,
    body: DirectPeerRequest,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.direct_accept(&body.peer_id, body.network.as_deref())
            .await
    })
    .await
}

#[tauri::command]
async fn direct_deny(
    state: State<'_, DesktopState>,
    body: DirectPeerRequest,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.direct_deny(&body.peer_id, body.network.as_deref()).await
    })
    .await
}

#[tauri::command]
async fn direct_kick(
    state: State<'_, DesktopState>,
    body: DirectPeerRequest,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.direct_kick(&body.peer_id, body.network.as_deref()).await
    })
    .await
}

#[tauri::command]
async fn direct_firewall_show(
    state: State<'_, DesktopState>,
    network: Option<String>,
) -> Result<tunnet_common::local_api::DirectFirewallResponse, String> {
    with_client(&state, |c| async move {
        c.direct_firewall_show(network.as_deref()).await
    })
    .await
}

#[tauri::command]
async fn direct_firewall_add(
    state: State<'_, DesktopState>,
    body: DirectFirewallAddRequest,
) -> Result<OkResponse, String> {
    with_client(
        &state,
        |c| async move { c.direct_firewall_add(&body).await },
    )
    .await
}

#[tauri::command]
async fn direct_firewall_remove(
    state: State<'_, DesktopState>,
    body: DirectFirewallRemoveRequest,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.direct_firewall_remove(body.index, body.network.as_deref())
            .await
    })
    .await
}

#[tauri::command]
async fn direct_firewall_off(
    state: State<'_, DesktopState>,
    network: Option<String>,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.direct_firewall_off(network.as_deref()).await
    })
    .await
}

#[tauri::command]
async fn direct_firewall_reset(
    state: State<'_, DesktopState>,
    network: Option<String>,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.direct_firewall_reset(network.as_deref()).await
    })
    .await
}

#[tauri::command]
async fn serves_list(state: State<'_, DesktopState>) -> Result<ServesResponse, String> {
    with_client(&state, |c| async move { c.serves_list().await }).await
}

#[tauri::command]
async fn serves_start(
    state: State<'_, DesktopState>,
    body: ServeStartRequest,
) -> Result<ServeInfo, String> {
    with_client(&state, |c| async move { c.serves_start(&body).await }).await
}

#[tauri::command]
async fn serves_off(state: State<'_, DesktopState>, port: u16) -> Result<ServeInfo, String> {
    with_client(&state, |c| async move { c.serves_off(port).await }).await
}

#[tauri::command]
async fn tunnels_list(state: State<'_, DesktopState>) -> Result<TunnelsResponse, String> {
    with_client(&state, |c| async move { c.tunnels_list().await }).await
}

#[tauri::command]
async fn tunnels_start(
    state: State<'_, DesktopState>,
    body: TunnelStartRequest,
) -> Result<TunnelInfo, String> {
    with_client(&state, |c| async move { c.tunnels_start(&body).await }).await
}

#[tauri::command]
async fn tunnels_off(state: State<'_, DesktopState>, port: u16) -> Result<TunnelInfo, String> {
    with_client(&state, |c| async move { c.tunnels_off(port).await }).await
}

#[tauri::command]
async fn transfers_list(state: State<'_, DesktopState>) -> Result<TransfersResponse, String> {
    with_client(&state, |c| async move { c.transfers_list().await }).await
}

#[tauri::command]
async fn transfers_send(
    state: State<'_, DesktopState>,
    body: SendFileRequest,
) -> Result<TransfersResponse, String> {
    with_client(&state, |c| async move { c.transfers_send(&body).await }).await
}

#[tauri::command]
async fn transfers_accept(
    state: State<'_, DesktopState>,
    transfer_id: String,
) -> Result<TransferInfo, String> {
    with_client(
        &state,
        |c| async move { c.transfers_accept(&transfer_id).await },
    )
    .await
}

#[tauri::command]
async fn transfers_reject(
    state: State<'_, DesktopState>,
    transfer_id: String,
    reason: Option<String>,
) -> Result<OkResponse, String> {
    with_client(&state, |c| async move {
        c.transfers_reject(&transfer_id, reason).await
    })
    .await
}

#[tauri::command]
async fn diag(state: State<'_, DesktopState>) -> Result<DiagInfo, String> {
    with_client(&state, |c| async move { c.diag().await }).await
}

#[tauri::command]
async fn netcheck(state: State<'_, DesktopState>) -> Result<NetcheckInfo, String> {
    with_client(&state, |c| async move { c.netcheck().await }).await
}

#[tauri::command]
async fn dns(state: State<'_, DesktopState>) -> Result<DnsStatusInfo, String> {
    with_client(&state, |c| async move { c.dns().await }).await
}

#[tauri::command]
async fn routes_list(
    state: State<'_, DesktopState>,
    network_id: Option<String>,
) -> Result<RoutesInfo, String> {
    with_client(&state, |c| async move {
        c.routes_list(network_id.as_deref()).await
    })
    .await
}

#[tauri::command]
async fn ssh_sessions(
    state: State<'_, DesktopState>,
    limit: Option<u32>,
    status: Option<String>,
) -> Result<SshSessionsResponse, String> {
    let limit = limit.unwrap_or(50);
    with_client(&state, |c| async move {
        c.ssh_sessions(limit, status.as_deref()).await
    })
    .await
}

#[tauri::command]
async fn ssh_recordings(
    state: State<'_, DesktopState>,
    limit: Option<u32>,
) -> Result<SshRecordingsResponse, String> {
    let limit = limit.unwrap_or(50);
    with_client(&state, |c| async move { c.ssh_recordings(limit).await }).await
}

#[tauri::command]
fn service_probe() -> Result<ServiceProbeDto, String> {
    Ok(tunnet_service::probe().into())
}

#[tauri::command]
async fn service_start() -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::ServiceStart).await
}

#[tauri::command]
async fn service_stop() -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::ServiceStop).await
}

#[tauri::command]
async fn service_restart() -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::ServiceRestart).await
}

#[tauri::command]
async fn service_install_and_start() -> Result<OkResponse, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::ServiceInstallAndStart).await
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_releases(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(
            "https://github.com/tunnetio/Tunnet/releases/latest",
            None::<&str>,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn events_subscribe(app: AppHandle, state: State<'_, DesktopState>) -> Result<(), String> {
    if EVENTS_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let client = state.client().await.map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let error_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let result = client
            .events(move |event: LocalEvent| {
                let _ = app_handle.emit("tunnet://local-event", &event);
                Ok(())
            })
            .await;

        if let Err(err) = result {
            let _ = error_handle.emit("tunnet://local-event-error", err.to_string());
        }
        EVENTS_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[derive(Serialize)]
struct InstallResult {
    message: String,
    opened_releases: bool,
}

#[cfg(windows)]
fn service_bin_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("TUNNET_INSTALL_DIR") {
        return std::path::PathBuf::from(dir);
    }
    tunnet_service::installed_bin_dir(None)
}

fn find_file_recursive(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    let direct = dir.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir()
            && let Some(found) = find_file_recursive(&path, name)
        {
            return Some(found);
        }
    }
    None
}

#[cfg(windows)]
fn append_machine_path(dir: &std::path::Path) -> Result<(), String> {
    use winreg::enums::KEY_READ;
    use winreg::enums::KEY_WRITE;

    let dir_str = dir.to_string_lossy();
    let env = winreg::HKLM
        .open_subkey_with_flags(
            "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
            KEY_READ | KEY_WRITE,
        )
        .map_err(|e| format!("open machine PATH: {e}"))?;

    let current: String = env.get_value("Path").unwrap_or_default();
    let already_present = current
        .split(';')
        .any(|entry| entry.eq_ignore_ascii_case(dir_str.as_ref()));
    if already_present {
        return Ok(());
    }

    let new_path = if current.is_empty() {
        dir_str.to_string()
    } else {
        format!("{};{}", current, dir_str)
    };
    env.set_value("Path", &new_path)
        .map_err(|e| format!("set machine PATH: {e}"))?;

    let process_path = std::env::var("Path").unwrap_or_default();
    if !process_path
        .split(';')
        .any(|entry| entry.eq_ignore_ascii_case(dir_str.as_ref()))
    {
        unsafe {
            std::env::set_var("Path", format!("{};{}", dir_str, process_path));
        }
    }

    Ok(())
}

/// Register SCM against the staged daemon in `install_dir` (ProgramData bin).
/// Runs `tunnet.exe service install|start` from that directory so staging and
/// PathName stay unified.
#[cfg(windows)]
fn install_service_from_dir(install_dir: &std::path::Path) -> Result<(), String> {
    let tunnet = install_dir.join("tunnet.exe");
    if !tunnet.is_file() {
        return Err(format!("tunnet.exe not found in {}", install_dir.display()));
    }
    let daemon = install_dir.join("tunnetd.exe");
    if !daemon.is_file() {
        return Err(format!(
            "tunnetd.exe not found in {}",
            install_dir.display()
        ));
    }

    // Prefer elevated_rpc path when called from Tauri commands; this helper is
    // used from install_daemon_from_github which may already be elevated.
    if !tunnet_service::is_admin() {
        return Err("administrator required to install the Tunnet service".into());
    }

    let install = std::process::Command::new(&tunnet)
        .args(["service", "install"])
        .current_dir(install_dir)
        .status()
        .map_err(|e| e.to_string())?;
    if !install.success() {
        return Err("service install failed".into());
    }

    let start = std::process::Command::new(&tunnet)
        .args(["service", "start"])
        .current_dir(install_dir)
        .status()
        .map_err(|e| e.to_string())?;
    if !start.success() {
        return Err("service start failed".into());
    }

    Ok(())
}

#[cfg(windows)]
fn copy_release_binaries(
    extract_root: &std::path::Path,
    install_dir: &std::path::Path,
) -> Result<(), String> {
    std::fs::create_dir_all(install_dir).map_err(|e| e.to_string())?;

    let mut copied_daemon = false;
    for name in ["tunnet.exe", "tunnetd.exe", "wintun.dll"] {
        if let Some(src) = find_file_recursive(extract_root, name) {
            let dst = install_dir.join(name);
            std::fs::copy(&src, &dst).map_err(|e| format!("copy {name}: {e}"))?;
            if name == "tunnetd.exe" {
                copied_daemon = true;
            }
        }
    }

    if !copied_daemon {
        return Err("tunnetd.exe not found in release archive".into());
    }

    Ok(())
}

#[tauri::command]
async fn install_daemon_from_github(app: AppHandle) -> Result<InstallResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("tunnet-desktop")
        .build()
        .map_err(|e| e.to_string())?;

    let release: serde_json::Value = client
        .get("https://api.github.com/repos/tunnetio/Tunnet/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let assets = release
        .get("assets")
        .and_then(|a| a.as_array())
        .ok_or_else(|| "no release assets found".to_string())?;

    let asset = assets
        .iter()
        .find(|asset| {
            let name = asset
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            name.contains("windows")
                && (name.contains("x86_64") || name.contains("x64"))
                && name.ends_with(".zip")
        })
        .ok_or_else(|| "no Windows x86_64 zip asset found".to_string())?;

    let download_url = asset
        .get("browser_download_url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| "missing download URL".to_string())?;

    let bytes = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let temp_dir = std::env::temp_dir().join("tunnet-install");
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let zip_path = temp_dir.join("tunnet-headless.zip");
    std::fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;

    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    archive.extract(&temp_dir).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        // Stage into %ProgramData%\tunnet\bin - the only active daemon location.
        let install_dir = service_bin_dir();
        let _ = tunnet_service::stop(None);
        copy_release_binaries(&temp_dir, &install_dir)?;

        let elevated =
            elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::InstallServiceFromDir {
                dir: install_dir.display().to_string(),
            })
            .await;
        match elevated {
            Ok(_) => {
                let _ = append_machine_path(&install_dir);
                return Ok(InstallResult {
                    message: format!(
                        "Installed to {} and started the Tunnet service",
                        install_dir.display()
                    ),
                    opened_releases: false,
                });
            }
            Err(_) => {
                // Fall through: try direct install if already admin, else open releases.
                if tunnet_service::is_admin() && install_service_from_dir(&install_dir).is_ok() {
                    let _ = append_machine_path(&install_dir);
                    return Ok(InstallResult {
                        message: format!(
                            "Installed to {} and started the Tunnet service",
                            install_dir.display()
                        ),
                        opened_releases: false,
                    });
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let install_result = (|| -> Result<(), String> {
            tunnet_service::ensure_admin().map_err(|e| e.to_string())?;
            tunnet_service::install(None).map_err(|e| e.to_string())?;
            tunnet_service::start(None).map_err(|e| e.to_string())
        })();

        if install_result.is_ok() {
            return Ok(InstallResult {
                message: "Daemon installed and started".into(),
                opened_releases: false,
            });
        }
    }

    let _ = open_releases(app.clone());
    Ok(InstallResult {
        message: format!(
            "Downloaded release to {}. Service install needs admin - opened releases page.",
            temp_dir.display()
        ),
        opened_releases: true,
    })
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Tunnet", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("missing default window icon")))?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Tunnet")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Headless elevated Local API worker - must run before single-instance / GUI.
    elevated_rpc::maybe_run_worker();

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(DesktopState::new())
        .invoke_handler(tauri::generate_handler![
            daemon_probe,
            meta,
            node,
            networks,
            network_peers,
            network_routes,
            network_firewall,
            network_join_requests,
            network_join_accept,
            network_join_deny,
            data_plane_up,
            data_plane_down,
            data_plane_status,
            network_create,
            network_join,
            enroll,
            network_leave,
            reset,
            direct_invite,
            direct_accept,
            direct_deny,
            direct_kick,
            direct_firewall_show,
            direct_firewall_add,
            direct_firewall_remove,
            direct_firewall_off,
            direct_firewall_reset,
            serves_list,
            serves_start,
            serves_off,
            tunnels_list,
            tunnels_start,
            tunnels_off,
            transfers_list,
            transfers_send,
            transfers_accept,
            transfers_reject,
            diag,
            netcheck,
            dns,
            routes_list,
            ssh_sessions,
            ssh_recordings,
            service_probe,
            service_start,
            service_stop,
            service_restart,
            service_install_and_start,
            open_url,
            open_releases,
            events_subscribe,
            install_daemon_from_github,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None::<Vec<&str>>,
                ))?;
            }
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
