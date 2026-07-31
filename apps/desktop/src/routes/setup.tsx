import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ElevatedConfirm } from "@/components/ElevatedConfirm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/invoke";
import { cn } from "@/lib/utils";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: SetupPage,
});

type Mode = "direct" | "managed";

function SetupPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("direct");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState("");
  const [joinHostname, setJoinHostname] = useState("");
  const [autoAcceptFirewall, setAutoAcceptFirewall] = useState(false);

  const [networkName, setNetworkName] = useState("");
  const [createHostname, setCreateHostname] = useState("");
  const [openNetwork, setOpenNetwork] = useState(true);
  const [secret, setSecret] = useState("");

  const [controlUrl, setControlUrl] = useState("");
  const [token, setToken] = useState("");
  const [org, setOrg] = useState("");
  const [managementUrl, setManagementUrl] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("");

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await fn();
      toast.success("Network configured");
      await navigate({ to: "/app" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative mx-auto flex min-h-svh w-full max-w-2xl flex-col px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,oklch(0.28_0_0),transparent_70%)]"
      />

      <header className="relative mb-5 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Connect this device
        </h1>
      </header>

      <div
        role="tablist"
        aria-label="Connection mode"
        className="relative mx-auto mb-5 grid w-full max-w-md grid-cols-2 gap-1.5 rounded-full border border-border bg-muted/60 p-1.5 shadow-[inset_0_1px_0_oklch(1_0_0/6%)]"
      >
        <ModeTab
          active={mode === "direct"}
          onClick={() => setMode("direct")}
          title="Direct"
          subtitle="Peer mesh"
        />
        <ModeTab
          active={mode === "managed"}
          onClick={() => setMode("managed")}
          title="Managed"
          subtitle="Organization"
        />
      </div>

      {error ? (
        <div className="relative mb-6 rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="relative">
        {mode === "direct" ? (
          <Tabs defaultValue="join" className="gap-5">
            <TabsList
              variant="line"
              className="mx-auto h-auto w-full max-w-xs justify-center gap-6 bg-transparent p-0"
            >
              <TabsTrigger
                value="join"
                className="rounded-none px-3 py-2 text-sm data-active:text-foreground"
              >
                Join
              </TabsTrigger>
              <TabsTrigger
                value="create"
                className="rounded-none px-3 py-2 text-sm data-active:text-foreground"
              >
                Create
              </TabsTrigger>
            </TabsList>

            <TabsContent value="join">
              <Card className="rounded-2xl border-border/80 shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Join direct network</CardTitle>
                  <CardDescription>
                    Paste an invite code from a network coordinator. Windows may
                    ask for administrator approval.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="invite">Invite code</Label>
                    <Input
                      id="invite"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="tn_…"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="join-hostname">Hostname (optional)</Label>
                    <Input
                      id="join-hostname"
                      value={joinHostname}
                      onChange={(e) => setJoinHostname(e.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 px-4 py-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-firewall">
                        Auto-accept firewall
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Apply suggested firewall rules on join.
                      </p>
                    </div>
                    <Switch
                      id="auto-firewall"
                      checked={autoAcceptFirewall}
                      onCheckedChange={setAutoAcceptFirewall}
                    />
                  </div>
                  <ElevatedConfirm
                    title="Administrator permission required"
                    description="Windows will prompt for elevation so Tunnet can configure the data plane and firewall for this join."
                    confirmLabel="Continue"
                    className="h-11 w-full rounded-xl"
                    onConfirm={() =>
                      run("join", async () => {
                        await api.networkJoin({
                          invite_code: inviteCode.trim(),
                          hostname: joinHostname.trim() || undefined,
                          auto_accept_firewall: autoAcceptFirewall,
                        });
                      })
                    }
                    disabled={busy !== null || !inviteCode.trim()}
                  >
                    {busy === "join" ? "Joining…" : "Join network"}
                  </ElevatedConfirm>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="create">
              <Card className="rounded-2xl border-border/80 shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">
                    Create direct network
                  </CardTitle>
                  <CardDescription>
                    Start a private mesh and invite peers with a code. Windows
                    may ask for administrator approval.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="network-name">Network name</Label>
                    <Input
                      id="network-name"
                      value={networkName}
                      onChange={(e) => setNetworkName(e.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-hostname">Hostname (optional)</Label>
                    <Input
                      id="create-hostname"
                      value={createHostname}
                      onChange={(e) => setCreateHostname(e.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 px-4 py-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="open-network">Open network</Label>
                      <p className="text-xs text-muted-foreground">
                        Allow peers to join without manual approval.
                      </p>
                    </div>
                    <Switch
                      id="open-network"
                      checked={openNetwork}
                      onCheckedChange={setOpenNetwork}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secret">Secret (optional)</Label>
                    <Input
                      id="secret"
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <ElevatedConfirm
                    title="Administrator permission required"
                    description="Windows will prompt for elevation so Tunnet can create the network and configure the data plane."
                    confirmLabel="Continue"
                    className="h-11 w-full rounded-xl"
                    onConfirm={() =>
                      run("create", async () => {
                        await api.networkCreate({
                          network_name: networkName.trim() || undefined,
                          hostname: createHostname.trim() || undefined,
                          open: openNetwork,
                          secret: secret.trim() || undefined,
                        });
                      })
                    }
                    disabled={busy !== null}
                  >
                    {busy === "create" ? "Creating…" : "Create network"}
                  </ElevatedConfirm>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="rounded-2xl border-border/80 shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Managed enrollment</CardTitle>
              <CardDescription>
                Connect this device to your organization control plane. Windows
                may ask for administrator approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="control-url">Control URL</Label>
                <Input
                  id="control-url"
                  value={controlUrl}
                  onChange={(e) => setControlUrl(e.target.value)}
                  placeholder="https://control.example.com"
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token">Enrollment token</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org">Organization (optional)</Label>
                <Input
                  id="org"
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="management-url">
                  Management URL (optional)
                </Label>
                <Input
                  id="management-url"
                  value={managementUrl}
                  onChange={(e) => setManagementUrl(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dashboard-url">Dashboard URL (optional)</Label>
                <Input
                  id="dashboard-url"
                  value={dashboardUrl}
                  onChange={(e) => setDashboardUrl(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <ElevatedConfirm
                title="Administrator permission required"
                description="Windows will prompt for elevation so Tunnet can enroll this device and configure the data plane."
                confirmLabel="Continue"
                className="h-11 w-full rounded-xl"
                onConfirm={() =>
                  run("enroll", async () => {
                    await api.enroll({
                      control_url: controlUrl.trim(),
                      token: token.trim(),
                      org: org.trim() || undefined,
                      management_url: managementUrl.trim() || undefined,
                      dashboard_url: dashboardUrl.trim() || undefined,
                    });
                  })
                }
                disabled={busy !== null || !controlUrl.trim() || !token.trim()}
              >
                {busy === "enroll" ? "Enrolling…" : "Enroll device"}
              </ElevatedConfirm>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center rounded-full px-3 py-3.5 text-center transition-colors",
        active
          ? "bg-background text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="text-sm font-semibold tracking-tight">{title}</span>
      <span
        className={cn(
          "mt-0.5 text-[11px]",
          active ? "text-muted-foreground" : "text-muted-foreground/80",
        )}
      >
        {subtitle}
      </span>
    </button>
  );
}
