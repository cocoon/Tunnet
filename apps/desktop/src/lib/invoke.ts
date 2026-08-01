import { invoke } from "@tauri-apps/api/core";
import type {
  DataPlaneStatus,
  DiagInfo,
  DirectFirewallAddRequest,
  DirectFirewallRemoveRequest,
  DirectFirewallResponse,
  DirectInviteRequest,
  DirectInviteResponse,
  DirectPeerRequest,
  DirectPendingResponse,
  DnsStatusInfo,
  LocalEnrollRequest,
  LocalEvent,
  MetaInfo,
  NetcheckInfo,
  NetworkCreateRequest,
  NetworkJoinRequest,
  NetworkLeaveRequest,
  NetworksResponse,
  NodeSummary,
  OkResponse,
  PeersResponse,
  ResetRequest,
  RoutesInfo,
  SendFileRequest,
  ServeInfo,
  ServeStartRequest,
  ServesResponse,
  SshRecordingsResponse,
  SshSessionsResponse,
  TransferInfo,
  TransfersResponse,
  TunnelInfo,
  TunnelStartRequest,
  TunnelsResponse,
} from "./types";

export interface ServiceProbe {
  installed: boolean;
  active: boolean;
  state: string;
}

export interface DaemonProbeResult {
  reachable: boolean;
  service: ServiceProbe;
  meta?: MetaInfo;
}

export interface InstallResult {
  message: string;
  opened_releases: boolean;
}

export const api = {
  daemonProbe: () => invoke<DaemonProbeResult>("daemon_probe"),
  meta: () => invoke<MetaInfo>("meta"),
  node: () => invoke<NodeSummary>("node"),
  networks: () => invoke<NetworksResponse>("networks"),
  networkPeers: (networkId: string) =>
    invoke<PeersResponse>("network_peers", { networkId }),
  networkRoutes: (networkId: string) =>
    invoke<RoutesInfo>("network_routes", { networkId }),
  networkFirewall: (networkId: string) =>
    invoke<DirectFirewallResponse>("network_firewall", { networkId }),
  networkJoinRequests: (networkId: string) =>
    invoke<DirectPendingResponse>("network_join_requests", { networkId }),
  networkJoinAccept: (networkId: string, peerId: string) =>
    invoke<OkResponse>("network_join_accept", { networkId, peerId }),
  networkJoinDeny: (networkId: string, peerId: string) =>
    invoke<OkResponse>("network_join_deny", { networkId, peerId }),
  dataPlaneUp: () => invoke<OkResponse>("data_plane_up"),
  dataPlaneDown: () => invoke<OkResponse>("data_plane_down"),
  dataPlaneStatus: () => invoke<DataPlaneStatus>("data_plane_status"),
  networkCreate: (body: NetworkCreateRequest) =>
    invoke<OkResponse>("network_create", { body }),
  networkJoin: (body: NetworkJoinRequest) =>
    invoke<OkResponse>("network_join", { body }),
  enroll: (body: LocalEnrollRequest) => invoke<OkResponse>("enroll", { body }),
  networkLeave: (body: NetworkLeaveRequest) =>
    invoke<OkResponse>("network_leave", { body }),
  reset: (body: ResetRequest) => invoke<OkResponse>("reset", { body }),
  directInvite: (body: DirectInviteRequest) =>
    invoke<DirectInviteResponse>("direct_invite", { body }),
  directAccept: (body: DirectPeerRequest) =>
    invoke<OkResponse>("direct_accept", { body }),
  directDeny: (body: DirectPeerRequest) =>
    invoke<OkResponse>("direct_deny", { body }),
  directKick: (body: DirectPeerRequest) =>
    invoke<OkResponse>("direct_kick", { body }),
  directFirewallShow: (network?: string) =>
    invoke<DirectFirewallResponse>("direct_firewall_show", { network }),
  directFirewallAdd: (body: DirectFirewallAddRequest) =>
    invoke<OkResponse>("direct_firewall_add", { body }),
  directFirewallRemove: (body: DirectFirewallRemoveRequest) =>
    invoke<OkResponse>("direct_firewall_remove", { body }),
  directFirewallOff: (network?: string) =>
    invoke<OkResponse>("direct_firewall_off", { network }),
  directFirewallReset: (network?: string) =>
    invoke<OkResponse>("direct_firewall_reset", { network }),
  servesList: () => invoke<ServesResponse>("serves_list"),
  servesStart: (body: ServeStartRequest) =>
    invoke<ServeInfo>("serves_start", { body }),
  servesOff: (port: number) => invoke<ServeInfo>("serves_off", { port }),
  tunnelsList: () => invoke<TunnelsResponse>("tunnels_list"),
  tunnelsStart: (body: TunnelStartRequest) =>
    invoke<TunnelInfo>("tunnels_start", { body }),
  tunnelsOff: (port: number) => invoke<TunnelInfo>("tunnels_off", { port }),
  transfersList: () => invoke<TransfersResponse>("transfers_list"),
  transfersSend: (body: SendFileRequest) =>
    invoke<TransfersResponse>("transfers_send", { body }),
  transfersAccept: (transferId: string) =>
    invoke<TransferInfo>("transfers_accept", { transferId }),
  transfersReject: (transferId: string, reason?: string) =>
    invoke<OkResponse>("transfers_reject", { transferId, reason }),
  diag: () => invoke<DiagInfo>("diag"),
  netcheck: () => invoke<NetcheckInfo>("netcheck"),
  dns: () => invoke<DnsStatusInfo>("dns"),
  routesList: (networkId?: string) =>
    invoke<RoutesInfo>("routes_list", { networkId }),
  sshSessions: (params?: { limit?: number; status?: string }) =>
    invoke<SshSessionsResponse>("ssh_sessions", {
      limit: params?.limit,
      status: params?.status,
    }),
  sshRecordings: (params?: { limit?: number }) =>
    invoke<SshRecordingsResponse>("ssh_recordings", {
      limit: params?.limit,
    }),
  serviceProbe: () => invoke<ServiceProbe>("service_probe"),
  serviceStart: () => invoke<OkResponse>("service_start"),
  serviceStop: () => invoke<OkResponse>("service_stop"),
  serviceRestart: () => invoke<OkResponse>("service_restart"),
  serviceInstallAndStart: () => invoke<OkResponse>("service_install_and_start"),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openReleases: () => invoke<void>("open_releases"),
  eventsSubscribe: () => invoke<void>("events_subscribe"),
  installDaemonFromGithub: () =>
    invoke<InstallResult>("install_daemon_from_github"),
};

export type { LocalEvent };
