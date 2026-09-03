import { useNavigate } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Button } from "@tunnet/ui/components/button";
import { Switch } from "@tunnet/ui/components/switch";
import { cn } from "@tunnet/ui/lib/utils";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { CapabilityGate } from "@/components/CapabilityGate";
import { ElevatedConfirm } from "@/components/ElevatedConfirm";
import { useApp } from "@/lib/app-context";
import { useDesktopUpdate } from "@/lib/desktop-update-context";
import { useDirectNetwork } from "@/lib/direct-network-context";
import { api, type CoreUpdateStatus } from "@/lib/invoke";
import type { LocalEvent } from "@/lib/types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-1 pb-2 text-sm font-semibold tracking-tight">
        {title}
      </h3>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

function Row({
  title,
  hint,
  control,
  destructive = false,
}: {
  title: string;
  hint?: string;
  control: ReactNode;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            destructive && "text-destructive",
          )}
        >
          {title}
        </p>
        {hint ? (
          <p className="mt-0.5 text-xs break-words text-muted-foreground [overflow-wrap:anywhere]">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function SettingsGeneral() {
  const navigate = useNavigate();
  const { node, meta, service, refreshNode, refreshAll } = useApp();
  const { activeNetwork } = useDirectNetwork();
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const desktopUpdate = useDesktopUpdate();
  const [coreUpdate, setCoreUpdate] = useState<CoreUpdateStatus | null>(null);
  const [coreStatusLoaded, setCoreStatusLoaded] = useState(false);

  useEffect(() => {
    void isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

  useEffect(() => {
    void api
      .coreUpdateStatus()
      .then(setCoreUpdate)
      .catch(() => undefined)
      .finally(() => setCoreStatusLoaded(true));
    const unlisten = listen<LocalEvent>(
      "tunnet://local-event",
      ({ payload }) => {
        if (payload.type === "core_update_changed")
          setCoreUpdate(payload.status);
      },
    );
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  async function toggleAutostart(checked: boolean) {
    setAutostartBusy(true);
    try {
      if (checked) await enable();
      else await disable();
      setAutostart(await isEnabled());
      toast.success(
        checked ? "Tunnet will open at sign-in" : "Autostart turned off",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAutostartBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.dataPlaneDown();
      await refreshNode();
      toast.success("Connection paused");
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    try {
      await api.dataPlaneUp();
      await refreshNode();
      toast.success("Connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function leaveNetwork() {
    setBusy(true);
    try {
      const network =
        activeNetwork?.network_id ??
        node?.networks.find((n) => n.mode === meta?.mode)?.network_id;
      await api.networkLeave({ network });
      await navigate({ to: "/setup" });
    } finally {
      setBusy(false);
    }
  }

  async function resetDevice() {
    setBusy(true);
    try {
      await api.reset({ yes: true });
      await navigate({ to: "/setup" });
    } finally {
      setBusy(false);
    }
  }

  const agentVersion = node?.daemon_version ?? meta?.daemon_version;
  const connected = node?.data_plane_up ?? false;

  function desktopStatus(): string {
    switch (desktopUpdate.phase) {
      case "available":
        return `Version ${desktopUpdate.availableVersion} available`;
      case "ready":
        return `Version ${desktopUpdate.availableVersion} ready to install`;
      case "downloading":
        return `Downloading ${Math.round(desktopUpdate.progress * 100)}%`;
      case "checking":
        return "Checking for updates";
      default:
        return desktopUpdate.error ?? "Up to date";
    }
  }

  function coreStatus(): string {
    if (!coreStatusLoaded) return "…";
    if (!coreUpdate) {
      return service?.active ? "Can't reach Local API" : "Service not running";
    }
    const percent =
      coreUpdate.total != null && coreUpdate.total > 0
        ? ` · ${Math.round((coreUpdate.downloaded / coreUpdate.total) * 100)}%`
        : "";
    const extra = coreUpdate.error ? ` · ${coreUpdate.error}` : "";
    switch (coreUpdate.phase) {
      case "checking":
        return "Checking for updates";
      case "available":
        return coreUpdate.available_version
          ? `Version ${coreUpdate.available_version} available`
          : "Update available";
      case "downloading":
        return `Downloading${percent}${extra}`;
      case "verifying":
        return `Verifying${extra}`;
      case "staged":
        return "Staged";
      case "activating":
        return "Activating";
      case "health_check":
        return "Health check";
      case "complete":
        return "Complete";
      case "rollback":
        return `Rolling back${extra}`;
      case "error":
        return coreUpdate.error ?? "Update failed";
      case "idle":
        return coreUpdate.available_version
          ? `Version ${coreUpdate.available_version} available`
          : "Up to date";
    }
  }

  async function checkDaemonUpdate() {
    try {
      setCoreUpdate(await api.coreUpdateCheck());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      void api.coreUpdateStatus().then(setCoreUpdate);
    }
  }

  async function installDaemonUpdate() {
    try {
      const result = await api.coreUpdateInstall();
      setCoreUpdate(result);
      toast.success("Core update started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      void api.coreUpdateStatus().then(setCoreUpdate);
    }
  }

  const desktopChecking =
    desktopUpdate.phase === "checking" ||
    desktopUpdate.phase === "downloading" ||
    desktopUpdate.phase === "installing";
  const coreChecking =
    coreUpdate?.phase === "checking" || coreUpdate?.phase === "downloading";

  return (
    <div className="space-y-6">
      <Section title="Updates">
        <Row
          title="Tunnet Desktop"
          hint={`Version ${desktopUpdate.currentVersion} · ${desktopStatus()}`}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={desktopChecking}
              onClick={() => void desktopUpdate.checkForUpdate()}
            >
              Check for updates
            </Button>
          }
        />
        <Row
          title="Background service"
          hint={`Version ${agentVersion ?? "not installed"} · ${coreStatus()}`}
          control={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={coreChecking}
                onClick={() => void checkDaemonUpdate()}
              >
                Check
              </Button>
              {coreUpdate?.phase === "available" ? (
                <Button size="sm" onClick={() => void installDaemonUpdate()}>
                  Update
                </Button>
              ) : null}
            </div>
          }
        />
      </Section>

      <Section title="Preferences">
        <Row
          title="Start at startup"
          hint="Launch Tunnet when Windows starts."
          control={
            <Switch
              aria-label="Start at startup"
              checked={autostart}
              disabled={autostartBusy}
              onCheckedChange={(checked) => void toggleAutostart(checked)}
            />
          }
        />
      </Section>

      <Section title="Connection">
        <Row
          title={connected ? "Connected" : "Paused"}
          hint={
            connected
              ? "Traffic is flowing on this device."
              : "Traffic is paused on this device."
          }
          control={
            <CapabilityGate
              permission="data_plane.write"
              fallback={
                <Button variant="outline" size="sm" disabled>
                  {connected ? "Pause" : "Resume"}
                </Button>
              }
            >
              {connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void reconnect()}
                >
                  Resume
                </Button>
              )}
            </CapabilityGate>
          }
        />
      </Section>

      <Section title="Background service">
        <Row
          title={service?.active ? "Running" : "Stopped"}
          hint={
            service?.active
              ? "Running in the background."
              : "Start it to use Tunnet."
          }
          control={
            <div className="flex gap-2">
              {!service?.active ? (
                <ElevatedConfirm
                  title="Start Tunnet?"
                  description="Windows may ask for permission to start the Tunnet background service."
                  confirmLabel="Start"
                  disabled={busy}
                  onConfirm={async () => {
                    setBusy(true);
                    try {
                      await api.serviceStart();
                      toast.success("Service started");
                      await refreshAll();
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Start
                </ElevatedConfirm>
              ) : null}
              {service?.active ? (
                <ElevatedConfirm
                  title="Stop Tunnet?"
                  description="Tunnet will stop until you start it again. Windows may ask for permission."
                  confirmLabel="Stop"
                  destructive
                  disabled={busy}
                  onConfirm={async () => {
                    setBusy(true);
                    try {
                      await api.serviceStop();
                      toast.success("Service stopped");
                      await refreshAll();
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Stop
                </ElevatedConfirm>
              ) : null}
              {service?.installed ? (
                <ElevatedConfirm
                  title="Restart Tunnet?"
                  description="Windows may ask for permission to restart the background service."
                  confirmLabel="Restart"
                  disabled={busy}
                  onConfirm={async () => {
                    setBusy(true);
                    try {
                      await api.serviceRestart();
                      toast.success("Service restarted");
                      await refreshAll();
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Restart
                </ElevatedConfirm>
              ) : null}
            </div>
          }
        />
      </Section>

      <Section title="Danger zone">
        <Row
          title="Leave network"
          hint="Disconnect this device from the network."
          destructive
          control={
            <CapabilityGate
              permission="lifecycle"
              fallback={
                <Button variant="outline" size="sm" disabled>
                  Leave
                </Button>
              }
            >
              <ElevatedConfirm
                title="Leave this network?"
                description="This device will disconnect from the network. You can join again later with an invite."
                confirmLabel="Leave network"
                destructive
                disabled={busy}
                onConfirm={leaveNetwork}
              >
                Leave
              </ElevatedConfirm>
            </CapabilityGate>
          }
        />
        <Row
          title="Reset device"
          hint="Clear all local Tunnet data. This cannot be undone."
          destructive
          control={
            <CapabilityGate
              permission="lifecycle"
              fallback={
                <Button variant="outline" size="sm" disabled>
                  Reset
                </Button>
              }
            >
              <ElevatedConfirm
                title="Reset this device?"
                description="Clears local Tunnet setup on this PC. This cannot be undone."
                confirmLabel="Reset"
                destructive
                disabled={busy}
                onConfirm={resetDevice}
              >
                Reset
              </ElevatedConfirm>
            </CapabilityGate>
          }
        />
      </Section>
    </div>
  );
}
