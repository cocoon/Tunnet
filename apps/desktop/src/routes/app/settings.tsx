import { createRoute, useNavigate } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Button } from "@tunnet/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { Label } from "@tunnet/ui/components/label";
import { Separator } from "@tunnet/ui/components/separator";
import { Switch } from "@tunnet/ui/components/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CapabilityGate } from "@/components/CapabilityGate";
import { ElevatedConfirm } from "@/components/ElevatedConfirm";
import { useApp } from "@/lib/app-context";
import { useDesktopUpdate } from "@/lib/desktop-update-context";
import { useDirectNetwork } from "@/lib/direct-network-context";
import { api, type CoreUpdateStatus } from "@/lib/invoke";
import type { LocalEvent } from "@/lib/types";
import { appRoute } from "../app";

export const Route = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
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

  function coreUpdateLabel(status: CoreUpdateStatus | null): string {
    if (!coreStatusLoaded) return "…";
    if (!status) {
      return service?.active
        ? "Can't reach Local API"
        : "Service is not running";
    }
    const percent =
      status.total != null && status.total > 0
        ? ` · ${Math.round((status.downloaded / status.total) * 100)}%`
        : "";
    const extra = status.error ? ` · ${status.error}` : "";
    switch (status.phase) {
      case "checking":
        return "Checking for updates";
      case "available":
        return status.available_version
          ? `Version ${status.available_version} is available`
          : "An update is available";
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
        return status.error ?? "Update failed";
      case "idle":
        return status.available_version
          ? `Version ${status.available_version} is available`
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

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preferences and connection controls for this device.
        </p>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Updates</CardTitle>
          <CardDescription>
            Desktop updates itself. Core updates itself; Check and Update talk
            to the running service.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Tunnet Desktop</p>
                <p className="text-xs text-muted-foreground">
                  Version {desktopUpdate.currentVersion}
                </p>
                <p className="text-xs text-muted-foreground">
                  {desktopUpdate.phase === "available"
                    ? `Version ${desktopUpdate.availableVersion} is available`
                    : desktopUpdate.phase === "ready"
                      ? `Version ${desktopUpdate.availableVersion} is downloaded and ready`
                      : desktopUpdate.phase === "downloading"
                        ? `Downloading ${Math.round(desktopUpdate.progress * 100)}%`
                        : desktopUpdate.phase === "checking"
                          ? "Checking for updates"
                          : (desktopUpdate.error ?? "Up to date")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  desktopUpdate.phase === "checking" ||
                  desktopUpdate.phase === "downloading" ||
                  desktopUpdate.phase === "installing"
                }
                onClick={() => void desktopUpdate.checkForUpdate()}
              >
                Check for updates
              </Button>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Background service</p>
                <p className="text-xs text-muted-foreground">
                  Version {agentVersion ?? "not installed"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {coreUpdateLabel(coreUpdate)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    coreUpdate?.phase === "checking" ||
                    coreUpdate?.phase === "downloading"
                  }
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
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="autostart">Start at startup</Label>
              <p className="text-xs text-muted-foreground">
                Launch Tunnet automatically when Windows starts.
              </p>
            </div>
            <Switch
              id="autostart"
              checked={autostart}
              disabled={autostartBusy}
              onCheckedChange={(checked) => void toggleAutostart(checked)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            Pause traffic without leaving the network, or remove this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CapabilityGate permission="data_plane.write">
            {node?.data_plane_up ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Pause connection
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void reconnect()}>
                Resume connection
              </Button>
            )}
          </CapabilityGate>
          <Separator />
          <CapabilityGate permission="lifecycle">
            <div className="flex flex-wrap gap-2">
              <ElevatedConfirm
                title="Leave this network?"
                description="This device will disconnect from the network. You can join again later with an invite."
                confirmLabel="Leave network"
                destructive
                disabled={busy}
                onConfirm={leaveNetwork}
              >
                Leave network
              </ElevatedConfirm>
              <ElevatedConfirm
                title="Reset this device?"
                description="Clears local Tunnet setup on this PC. This cannot be undone."
                confirmLabel="Reset"
                destructive
                disabled={busy}
                onConfirm={resetDevice}
              >
                Reset device
              </ElevatedConfirm>
            </div>
          </CapabilityGate>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Background service</CardTitle>
          <CardDescription>
            {service?.active
              ? "Running in the background"
              : "Not running - start it to use Tunnet"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
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
                  toast.error(err instanceof Error ? err.message : String(err));
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
                  toast.error(err instanceof Error ? err.message : String(err));
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
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restart
            </ElevatedConfirm>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
