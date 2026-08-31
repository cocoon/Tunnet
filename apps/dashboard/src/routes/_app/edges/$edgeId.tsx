import { createFileRoute, Link } from "@tanstack/react-router";
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
import {
  DataTable,
  type DataTableColumnDef,
} from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { EntityStatus } from "@/components/app/entity-status";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/hooks/use-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  useEdge,
  useEdgeHealth,
  useEdgeMutations,
  useTunnels,
} from "@/lib/queries/management";

export const Route = createFileRoute("/_app/edges/$edgeId")({
  component: EdgeDetailPage,
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

function EdgeDetailPage() {
  const { edgeId } = Route.useParams();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canManage = false } = useCan(orgId, "edge", "update");
  const { data: edge, isPending, isError, error } = useEdge(orgId, edgeId);
  const { data: health } = useEdgeHealth(orgId, edgeId);
  const { data: tunnels } = useTunnels(orgId);
  const mutations = useEdgeMutations(orgId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [capacity, setCapacity] = useState("");

  useEffect(() => {
    if (!edge) return;
    setName(edge.name);
    setRegion(edge.region);
    setCapacity(String(edge.capacityLimit));
  }, [edge]);

  const edgeTunnels = useMemo(
    () => (tunnels ?? []).filter((t) => t.edgeId === edgeId),
    [tunnels, edgeId],
  );

  const heartbeats = useMemo(
    () => [...(health?.heartbeats ?? [])].reverse(),
    [health],
  );
  const maxActive = useMemo(
    () => Math.max(1, ...heartbeats.map((h) => h.activeTunnels)),
    [heartbeats],
  );

  const tunnelColumns = useMemo<
    DataTableColumnDef<(typeof edgeTunnels)[number]>[]
  >(
    () => [
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <EntityStatus status={row.original.status} />,
      },
      {
        id: "url",
        header: "URL",
        cell: ({ row }) => (
          <Link
            to="/tunnels/$tunnelId"
            params={{ tunnelId: row.original.id }}
            className="font-mono text-xs hover:underline"
          >
            https://{row.original.publicHostname}
          </Link>
        ),
      },
      {
        id: "machine",
        header: "Machine",
        cell: ({ row }) => row.original.hostname ?? "—",
      },
      {
        id: "port",
        header: "Port",
        accessorKey: "localPort",
      },
      {
        id: "protocol",
        header: "Protocol",
        cell: ({ row }) => row.original.protocol.toUpperCase(),
      },
    ],
    [],
  );

  if (!orgId || isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (isError || !edge) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          {isError && error instanceof Error
            ? error.message
            : "Edge not found."}
        </p>
        <Button nativeButton={false} render={<Link to="/edges" />}>
          Back to edges
        </Button>
      </div>
    );
  }

  const capacityPct =
    edge.capacityLimit > 0
      ? Math.round((edge.activeTunnels / edge.capacityLimit) * 100)
      : 0;

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/edges" />}>Edges</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRightIcon className="size-4" />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage>{edge.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={edge.name}
        description={`${edge.region} · ${edge.domain}`}
        actions={<EntityStatus status={edge.status} />}
      />

      <Tabs defaultValue="overview" variant="underline" className="gap-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tunnels">Tunnels</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          {canManage ? (
            <TabsTrigger value="settings">Settings</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Edge info</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailRow label="Status">
                  <EntityStatus status={edge.status} />
                </DetailRow>
                <DetailRow label="Kind">
                  {edge.kind.replace("_", " ")}
                </DetailRow>
                <DetailRow label="Region">{edge.region}</DetailRow>
                <DetailRow label="Capacity">
                  {edge.activeTunnels}/{edge.capacityLimit} ({capacityPct}%)
                </DetailRow>
                <DetailRow label="Last heartbeat">
                  {edge.lastHeartbeatAt
                    ? formatDistanceToNow(new Date(edge.lastHeartbeatAt), {
                        addSuffix: true,
                      })
                    : "—"}
                </DetailRow>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Endpoints</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <CopyField label="Domain" value={edge.domain} />
                {edge.publicIp ? (
                  <CopyField label="Public IP" value={edge.publicIp} />
                ) : (
                  <DetailRow label="Public IP">Not set</DetailRow>
                )}
                <CopyField label="Edge ID" value={edge.id} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tunnels">
          {edgeTunnels.length === 0 ? (
            <EmptyState
              title="No tunnels on this edge"
              description="Tunnels assigned to this edge will appear here."
            />
          ) : (
            <DataTable
              columns={tunnelColumns}
              data={edgeTunnels}
              getRowId={(r) => r.id}
            />
          )}
        </TabsContent>

        <TabsContent value="health">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">TLS certificate</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailRow label="Status">
                  <EntityStatus status={health?.status ?? edge.status} />
                </DetailRow>
                <DetailRow label="Active tunnels">
                  {health?.activeTunnels ?? edge.activeTunnels}
                </DetailRow>
                <DetailRow label="Cert valid until">
                  {health?.cert.validUntil
                    ? formatDistanceToNow(new Date(health.cert.validUntil), {
                        addSuffix: true,
                      })
                    : "Unknown"}
                </DetailRow>
                <DetailRow label="Last heartbeat">
                  {health?.lastHeartbeatAt
                    ? formatDistanceToNow(new Date(health.lastHeartbeatAt), {
                        addSuffix: true,
                      })
                    : "—"}
                </DetailRow>
              </CardContent>
            </Card>
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
                  <div className="space-y-3">
                    <div className="flex h-24 items-end gap-0.5">
                      {heartbeats.slice(-40).map((sample) => (
                        <div
                          key={sample.id}
                          className="bg-foreground/70 min-w-0 flex-1 rounded-t-sm"
                          style={{
                            height: `${Math.max(8, (sample.activeTunnels / maxActive) * 100)}%`,
                          }}
                          title={`${sample.activeTunnels} tunnels · ${new Date(sample.recordedAt).toLocaleString()}`}
                        />
                      ))}
                    </div>
                    <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto text-sm">
                      {[...(health?.heartbeats ?? [])].slice(0, 12).map((h) => (
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
                            {h.activeTunnels} tunnels
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
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
                          edgeId,
                          body: {
                            name: name.trim(),
                            region: region.trim(),
                            capacityLimit:
                              Number(capacity) || edge.capacityLimit,
                          },
                        })
                        .then(() => toast.success("Edge updated"))
                        .catch((err: Error) => toast.error(err.message));
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="edge-settings-name">Name</Label>
                      <Input
                        id="edge-settings-name"
                        value={name}
                        onChange={setName}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edge-settings-region">Region</Label>
                      <Input
                        id="edge-settings-region"
                        value={region}
                        onChange={setRegion}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edge-settings-capacity">Capacity</Label>
                      <Input
                        id="edge-settings-capacity"
                        type="number"
                        min={1}
                        value={capacity}
                        onChange={setCapacity}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Input value={edge.status} disabled />
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
                      {edge.status !== "disabled" ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setConfirmDisable(true)}
                        >
                          Disable edge
                        </Button>
                      ) : null}
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
                    Deleting this edge removes it from the organization. Active
                    tunnels on it will fail over or stop.
                  </p>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete edge
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title="Disable edge"
        description={`Disable ${edge.name}? New tunnels will not be assigned to it.`}
        confirmLabel="Disable"
        destructive
        loading={mutations.update.isPending}
        onConfirm={async () => {
          try {
            await mutations.update.mutateAsync({
              edgeId,
              body: { status: "disabled" },
            });
            toast.success("Edge disabled");
            setConfirmDisable(false);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to disable",
            );
          }
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete edge"
        description={`Delete ${edge.name}? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={async () => {
          try {
            await mutations.remove.mutateAsync(edgeId);
            toast.success("Edge deleted");
            window.location.href = "/edges";
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
