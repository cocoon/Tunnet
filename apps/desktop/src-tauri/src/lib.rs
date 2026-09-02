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
    CoreUpdateStatus, DataPlaneStatus, DiagInfo, DirectFirewallAddRequest,
    DirectFirewallRemoveRequest, DirectInviteRequest, DirectInviteResponse, DirectPeerRequest,
    DirectPendingResponse, DnsStatusInfo, LocalEnrollRequest, LocalEvent, MetaInfo, NetcheckInfo,
    NetworkCreateRequest, NetworkJoinRequest, NetworkLeaveRequest, NetworksResponse, NodeSummary,
    OkResponse, PeersResponse, ResetRequest, RoutesInfo, SendFileRequest, ServeInfo,
    ServeStartRequest, ServesResponse, SshRecordingsResponse, SshSessionsResponse, TransferInfo,
    TransfersResponse, TunnelInfo, TunnelStartRequest, TunnelsResponse,
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
fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_releases(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://github.com/tunnetio/Tunnet/releases", None::<&str>)
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

#[tauri::command]
async fn core_update_status(state: State<'_, DesktopState>) -> Result<CoreUpdateStatus, String> {
    with_client(&state, |client| async move { client.update_status().await }).await
}

#[tauri::command]
async fn core_update_check(state: State<'_, DesktopState>) -> Result<CoreUpdateStatus, String> {
    with_client(&state, |client| async move { client.update_check().await }).await
}

#[tauri::command]
async fn core_update_install(
    state: State<'_, DesktopState>,
) -> Result<tunnet_common::local_api::CoreUpdateStatus, String> {
    elevated_rpc::run_elevated_op(elevated_rpc::ElevatedOp::CoreUpdateInstall).await?;
    with_client(&state, |client| async move { client.update_status().await }).await
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
            open_external_url,
            open_releases,
            events_subscribe,
            core_update_status,
            core_update_check,
            core_update_install,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
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
