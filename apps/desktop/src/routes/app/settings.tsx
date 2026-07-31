import { createRoute, useNavigate } from "@tanstack/react-router";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CapabilityGate } from "@/components/CapabilityGate";
import { ElevatedConfirm } from "@/components/ElevatedConfirm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app-context";
import { useDirectNetwork } from "@/lib/direct-network-context";
import { api } from "@/lib/invoke";
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

  useEffect(() => {
    void isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(false));
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
      await navigate({ to: "/" });
    } finally {
      setBusy(false);
    }
  }

  const agentVersion = node?.daemon_version ?? meta?.daemon_version;

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
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="autostart">Open at sign-in</Label>
              <p className="text-xs text-muted-foreground">
                Launch Tunnet when you sign in to Windows.
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
              : "Not running — start it to use Tunnet"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ElevatedConfirm
            title="Start Tunnet?"
            description="Windows may ask for permission to start the Tunnet background service."
            confirmLabel="Start"
            disabled={busy || !!service?.active}
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
          <ElevatedConfirm
            title="Stop Tunnet?"
            description="Tunnet will stop until you start it again. Windows may ask for permission."
            confirmLabel="Stop"
            destructive
            disabled={busy || !service?.active}
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
          <ElevatedConfirm
            title="Restart Tunnet?"
            description="Windows may ask for permission to restart the background service."
            confirmLabel="Restart"
            disabled={busy || !service?.installed}
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
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Tunnet agent {agentVersion || "—"}
      </p>
    </div>
  );
}
