import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { Relay } from "@tunnet/api/management";
import { Button } from "@tunnet/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { Skeleton } from "@tunnet/ui/components/skeleton";
import { formatDistanceToNow } from "date-fns";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { EntityStatus } from "@/components/app/entity-status";
import { PageHeader } from "@/components/app/page-header";
import { PageToolbar } from "@/components/app/page-toolbar";
import { RegisterRelayDialog } from "@/components/app/register-relay-dialog";
import { useCan } from "@/hooks/use-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { useConnectivityRelays } from "@/lib/queries/management";

export const Route = createFileRoute("/_app/relays/")({
  component: RelaysPage,
});

function RelaysPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canCreate = false } = useCan(orgId, "relay", "create");
  const { data: list, isPending } = useConnectivityRelays(orgId);
  const relays = list?.relays;
  const availableRegions = list?.availableRelayRegions ?? [];
  const [search, setSearch] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !relays) return relays ?? [];
    return relays.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q),
    );
  }, [relays, search]);

  const columns = useMemo<ColumnDef<Relay>[]>(
    () => [
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <EntityStatus status={row.original.status} />,
      },
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link
            to="/relays/$relayId"
            params={{ relayId: row.original.id }}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "region",
        header: "Region",
        accessorKey: "region",
      },
      {
        id: "url",
        header: "URL",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.url || "—"}</span>
        ),
      },
      {
        id: "accessMode",
        header: "Access",
        cell: ({ row }) => (
          <span className="text-sm capitalize">
            {row.original.accessMode.replace("_", " ")}
          </span>
        ),
      },
      {
        id: "heartbeat",
        header: "Last heartbeat",
        cell: ({ row }) =>
          row.original.lastHeartbeatAt ? (
            <span className="text-muted-foreground text-sm">
              {formatDistanceToNow(new Date(row.original.lastHeartbeatAt), {
                addSuffix: true,
              })}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Relays"
        description="Org-owned mesh connectivity relays."
        actions={
          canCreate ? (
            <Button onClick={() => setRegisterOpen(true)}>
              <PlusIcon className="mr-2 size-4" />
              Register relay
            </Button>
          ) : null
        }
      />

      {!isPending && availableRegions.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Available Cloud regions</CardTitle>
            <CardDescription>
              Healthy Cloud relay regions for this deployment. Relay policy
              (inherit / augment / exclusive) is configured in{" "}
              <Link to="/organization" className="font-medium hover:underline">
                Organization settings
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {availableRegions.map((region) => (
                <span
                  key={region}
                  className="rounded-md border border-border/70 bg-secondary/40 px-2.5 py-1 font-mono text-xs"
                >
                  {region}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PageToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, region, URL..."
        count={filtered.length}
        countLabel={filtered.length === 1 ? "relay" : "relays"}
      />

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No org relays yet"
          description="Register a self-hosted tunnet-relay for mesh connectivity, or rely on Cloud regions via relay policy."
          action={
            canCreate ? (
              <Button onClick={() => setRegisterOpen(true)}>
                Register relay
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable columns={columns} data={filtered} getRowId={(r) => r.id} />
      )}

      {orgId ? (
        <RegisterRelayDialog
          orgId={orgId}
          open={registerOpen}
          onOpenChange={setRegisterOpen}
        />
      ) : null}
    </>
  );
}
