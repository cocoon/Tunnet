import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@tunnet/ui/components/breadcrumb";
import { Button } from "@tunnet/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { Input } from "@tunnet/ui/components/input";
import { Label } from "@tunnet/ui/components/label";
import { Skeleton } from "@tunnet/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tunnet/ui/components/tabs";
import { formatDistanceToNow } from "date-fns";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { CopyField } from "@/components/app/copy-field";
import { EntityStatus } from "@/components/app/entity-status";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/hooks/use-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  useConnectivityRelay,
  useConnectivityRelayHealth,
  useOrgRelayMutations,
} from "@/lib/queries/management";

export const Route = createFileRoute("/_app/relays/$relayId")({
  component: RelayDetailPage,
});

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border/50 py-3 last:border-0">
      <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  );
}

function RelayDetailPage() {
  const { relayId } = Route.useParams();
  const navigate = useNavigate();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canManage = false } = useCan(orgId, "relay", "update");
  const {
    data: relay,
    isPending,
    isError,
    error,
  } = useConnectivityRelay(orgId, relayId);
  const { data: health } = useConnectivityRelayHealth(orgId, relayId);
  const mutations = useOrgRelayMutations(orgId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!relay) return;
    setName(relay.name);
    setRegion(relay.region);
    setUrl(relay.url);
  }, [relay]);

  const heartbeats = useMemo(
    () => [...(health?.heartbeats ?? [])].reverse(),
    [health],
  );

  if (!orgId || isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (isError || !relay) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          {isError && error instanceof Error
            ? error.message
            : "Relay not found."}
        </p>
        <Button nativeButton={false} render={<Link to="/relays" />}>
          Back to relays
        </Button>
      </div>
    );
  }

  const isSuspended = relay.status === "suspended";

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/relays" />}>
              Relays
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRightIcon className="size-4" />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage>{relay.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={relay.name}
        description={`${relay.region} · Connectivity relay`}
        actions={<EntityStatus status={relay.status} />}
      />

      <Tabs defaultValue="overview" variant="underline" className="gap-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          {canManage ? (
            <TabsTrigger value="settings">Settings</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Relay info</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailRow label="Status">
                  <EntityStatus status={relay.status} />
                </DetailRow>
                <DetailRow label="Region">{relay.region}</DetailRow>
                <DetailRow label="Access mode">
                  <span className="capitalize">
                    {relay.accessMode.replace("_", " ")}
                  </span>
                </DetailRow>
                <DetailRow label="QAD">
                  {relay.qadEnabled ? "Enabled" : "Disabled"}
                </DetailRow>
                <DetailRow label="Last heartbeat">
                  {relay.lastHeartbeatAt
                    ? formatDistanceToNow(new Date(relay.lastHeartbeatAt), {
                        addSuffix: true,
                      })
                    : "—"}
                </DetailRow>
                {relay.suspendedAt ? (
                  <DetailRow label="Suspended at">
                    {formatDistanceToNow(new Date(relay.suspendedAt), {
                      addSuffix: true,
                    })}
                  </DetailRow>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Endpoints</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {relay.url ? (
                  <CopyField label="URL" value={relay.url} />
                ) : (
                  <DetailRow label="URL">Not set</DetailRow>
                )}
                {relay.metricsUrl ? (
                  <CopyField label="Metrics URL" value={relay.metricsUrl} />
                ) : null}
                <CopyField label="Relay ID" value={relay.id} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="health">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Heartbeat history</CardTitle>
            </CardHeader>
            <CardContent>
              {heartbeats.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No heartbeats recorded yet.
                </p>
              ) : (
                <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto text-sm">
                  {[...(health?.heartbeats ?? [])].slice(0, 24).map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="text-muted-foreground text-xs">
                        {formatDistanceToNow(new Date(h.recordedAt), {
                          addSuffix: true,
                        })}
                      </span>
                      <span className="font-mono text-xs">
                        {h.metrics
                          ? JSON.stringify(h.metrics).slice(0, 80)
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canManage ? (
          <TabsContent value="settings">
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">General</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void mutations.update
                        .mutateAsync({
                          relayId,
                          body: {
                            name: name.trim(),
                            region: region.trim(),
                            url: url.trim(),
                          },
                        })
                        .then(() => toast.success("Relay updated"))
                        .catch((err: Error) => toast.error(err.message));
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="relay-settings-name">Name</Label>
                      <Input
                        id="relay-settings-name"
                        value={name}
                        onChange={setName}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="relay-settings-region">Region</Label>
                      <Input
                        id="relay-settings-region"
                        value={region}
                        onChange={setRegion}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="relay-settings-url">URL</Label>
                      <Input
                        id="relay-settings-url"
                        value={url}
                        onChange={setUrl}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        disabled={mutations.update.isPending}
                      >
                        {mutations.update.isPending
                          ? "Saving..."
                          : "Save changes"}
                      </Button>
                      {isSuspended ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void mutations.update
                              .mutateAsync({
                                relayId,
                                body: { status: "healthy" },
                              })
                              .then(() => toast.success("Relay resumed"))
                              .catch((err: Error) => toast.error(err.message));
                          }}
                        >
                          Resume relay
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setConfirmSuspend(true)}
                        >
                          Suspend relay
                        </Button>
                      )}
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">
                    Danger zone
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    Deleting this relay removes it from the organization. Agents
                    using it for connectivity may fall back to Cloud relays
                    depending on policy.
                  </p>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete relay
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <ConfirmDialog
        open={confirmSuspend}
        onOpenChange={setConfirmSuspend}
        title="Suspend relay"
        description={`Suspend ${relay.name}? Agents will stop using this org relay.`}
        confirmLabel="Suspend"
        destructive
        loading={mutations.update.isPending}
        onConfirm={async () => {
          try {
            await mutations.update.mutateAsync({
              relayId,
              body: { status: "suspended" },
            });
            toast.success("Relay suspended");
            setConfirmSuspend(false);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to suspend",
            );
          }
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete relay"
        description={`Delete ${relay.name}? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={async () => {
          try {
            await mutations.remove.mutateAsync(relayId);
            toast.success("Relay deleted");
            void navigate({ to: "/relays" });
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to delete",
            );
          }
        }}
      />
    </>
  );
}
