import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, type ServiceProbe } from "@/lib/invoke";
import type { LocalEvent, MetaInfo, NodeSummary } from "@/lib/types";

const MAX_EVENTS = 20;
const POLL_MS = 3000;

export interface RecentEvent {
  id: number;
  at: number;
  event: LocalEvent;
  label: string;
}

function formatEventLabel(event: LocalEvent): string {
  switch (event.type) {
    case "daemon_ready":
      return "Daemon ready";
    case "daemon_mode_changed":
      return `Mode changed to ${event.mode}`;
    case "data_plane_changed":
      return event.up ? "Data plane connected" : "Data plane disconnected";
    case "network_added":
      return `Network added (${event.network_id.slice(0, 8)}…)`;
    case "network_removed":
      return `Network removed (${event.network_id.slice(0, 8)}…)`;
    case "peer_online":
      return `Peer online (${event.endpoint_id.slice(0, 8)}…)`;
    case "peer_offline":
      return `Peer offline (${event.endpoint_id.slice(0, 8)}…)`;
    case "peer_path_changed":
      return `Peer path → ${event.path}`;
    case "peer_metrics":
      return `Peer latency ${event.latency_ms} ms`;
    case "direct_join_requested":
      return `Join request from ${event.peer_id.slice(0, 8)}…`;
    case "transfer_created":
      return `Transfer created (${event.id.slice(0, 8)}…)`;
    case "transfer_progress":
      return `Transfer progress ${event.bytes} bytes`;
    case "transfer_completed":
      return `Transfer completed (${event.id.slice(0, 8)}…)`;
    case "control_connected":
      return "Control plane connected";
    case "control_disconnected":
      return "Control plane disconnected";
    case "update_available":
      return `Update available: ${event.version}`;
    case "core_update_changed":
      return `Core update: ${event.status.phase.replace(/_/g, " ")}`;
    default:
      return "Event";
  }
}

interface AppContextValue {
  meta: MetaInfo | null;
  node: NodeSummary | null;
  service: ServiceProbe | null;
  apiReachable: boolean;
  recentEvents: RecentEvent[];
  refreshNode: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshService: () => Promise<void>;
  refreshAll: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  loading: boolean;
  error: string | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [node, setNode] = useState<NodeSummary | null>(null);
  const [service, setService] = useState<ServiceProbe | null>(null);
  const [apiReachable, setApiReachable] = useState(false);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshService = useCallback(async () => {
    const next = await api.serviceProbe();
    setService(next);
  }, []);

  const refreshMeta = useCallback(async () => {
    const next = await api.meta();
    setMeta(next);
  }, []);

  const refreshNode = useCallback(async () => {
    const next = await api.node();
    setNode(next);
  }, []);

  const refreshAll = useCallback(async () => {
    const probe = await api.daemonProbe();
    setService(probe.service);
    setApiReachable(probe.reachable);
    if (probe.meta) setMeta(probe.meta);

    if (!probe.reachable) {
      setError(
        probe.service.active
          ? "Still connecting…"
          : "Tunnet isn’t running. Start it from Settings.",
      );
      return;
    }

    try {
      await Promise.all([refreshMeta(), refreshNode()]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshMeta, refreshNode]);

  const hasPermission = useCallback(
    (permission: string) => meta?.permissions.includes(permission) ?? false,
    [meta],
  );

  const pushEvent = useCallback((event: LocalEvent) => {
    setRecentEvents((prev) =>
      [
        {
          id: Date.now() + Math.random(),
          at: Date.now(),
          event,
          label: formatEventLabel(event),
        },
        ...prev,
      ].slice(0, MAX_EVENTS),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        await refreshService();
        try {
          await api.eventsSubscribe();
        } catch {
          // Events are best-effort; identity still loads via polling.
        }
        await refreshAll();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refreshAll, refreshService]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshAll();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshAll]);

  useEffect(() => {
    const unlisten = listen<LocalEvent>("tunnet://local-event", (payload) => {
      pushEvent(payload.payload);
      void refreshAll();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [pushEvent, refreshAll]);

  const value = useMemo(
    () => ({
      meta,
      node,
      service,
      apiReachable,
      recentEvents,
      refreshNode,
      refreshMeta,
      refreshService,
      refreshAll,
      hasPermission,
      loading,
      error,
    }),
    [
      meta,
      node,
      service,
      apiReachable,
      recentEvents,
      refreshNode,
      refreshMeta,
      refreshService,
      refreshAll,
      hasPermission,
      loading,
      error,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
