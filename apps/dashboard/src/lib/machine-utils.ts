import type { Device, Network } from "@tunnet/api/management";
import { formatDistanceToNow } from "date-fns";

import type { LivePresenceDevice } from "@/hooks/use-live-presence";

export type AggregatedMachine = Device & {
  networkName: string;
};

export function aggregateMachines(
  networks: Network[],
  devicesByNetwork: Map<string, Device[]>,
): AggregatedMachine[] {
  const machines: AggregatedMachine[] = [];

  for (const network of networks) {
    const devices = devicesByNetwork.get(network.id) ?? [];
    for (const device of devices) {
      machines.push({ ...device, networkName: network.name });
    }
  }

  return machines.sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
  );
}

export type MachinePresence =
  | "online"
  | "degraded"
  | "connecting"
  | "offline"
  | "unknown"
  | "suspended"
  | "pending"
  | "expired";

/** Server clears `agentConnected` after ~90s without heartbeat. Also age client-side
 *  so a stuck WS / stale REST cache cannot keep showing Online forever. */
export const HEARTBEAT_ONLINE_MS = 90_000;
/** Heartbeat age above this (but still connected) shows as degraded. */
export const HEARTBEAT_DEGRADED_MS = 45_000;
/** Recent connect without a heartbeat yet → connecting. */
export const CONNECTING_WINDOW_MS = 30_000;

export function getMachinePresence(
  device: Pick<
    Device,
    "status" | "agentConnected" | "lastHeartbeatAt" | "connectedAt"
  >,
  now = Date.now(),
): MachinePresence {
  if (device.status === "expired") return "expired";
  if (device.status === "suspended") return "suspended";
  if (device.status === "pending") return "pending";

  if (!device.agentConnected) {
    return "offline";
  }

  if (!device.lastHeartbeatAt) {
    if (device.connectedAt) {
      const connectedAt = new Date(device.connectedAt).getTime();
      if (
        !Number.isNaN(connectedAt) &&
        now - connectedAt <= CONNECTING_WINDOW_MS
      ) {
        return "connecting";
      }
    }
    return "unknown";
  }

  const heartbeatAt = new Date(device.lastHeartbeatAt).getTime();
  if (Number.isNaN(heartbeatAt) || now - heartbeatAt > HEARTBEAT_ONLINE_MS) {
    return "offline";
  }

  if (now - heartbeatAt > HEARTBEAT_DEGRADED_MS) {
    return "degraded";
  }

  return "online";
}

export function formatHeartbeatAge(
  lastHeartbeatAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!lastHeartbeatAt) return null;
  const at = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(at)) return null;
  const secs = Math.max(0, Math.floor((now - at) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return formatDistanceToNow(new Date(at), { addSuffix: true });
}

export function formatLastSeenLabel(
  device: Pick<
    LivePresenceDevice,
    | "status"
    | "lastSeen"
    | "agentConnected"
    | "lastHeartbeatAt"
    | "disconnectedAt"
    | "connectedAt"
  >,
  now = Date.now(),
): string {
  const presence = getMachinePresence(device, now);
  if (presence === "online" || presence === "degraded") {
    return formatHeartbeatAge(device.lastHeartbeatAt, now) ?? "Now";
  }
  if (presence === "connecting") {
    return "Connecting…";
  }

  const at = device.disconnectedAt ?? device.lastHeartbeatAt ?? device.lastSeen;

  return formatDistanceToNow(new Date(at), { addSuffix: true });
}
