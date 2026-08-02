import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { Edge } from "@tunnet/api/management";
import { Button } from "@tunnet/ui/components/button";
import { Skeleton } from "@tunnet/ui/components/skeleton";
import { formatDistanceToNow } from "date-fns";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { EntityStatus } from "@/components/app/entity-status";
import { PageHeader } from "@/components/app/page-header";
import { PageToolbar } from "@/components/app/page-toolbar";
import { RegisterEdgeDialog } from "@/components/app/register-edge-dialog";
import { useCan } from "@/hooks/use-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { useEdges } from "@/lib/queries/management";

export const Route = createFileRoute("/_app/edges/")({
  component: EdgesPage,
});

function EdgesPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canCreate = false } = useCan(orgId, "edge", "create");
  const { data: edges, isPending } = useEdges(orgId);
  const [search, setSearch] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !edges) return edges ?? [];
    return edges.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.domain.toLowerCase().includes(q) ||
        (r.publicIp?.includes(q) ?? false),
    );
  }, [edges, search]);

  const columns = useMemo<ColumnDef<Edge>[]>(
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
            to="/edges/$edgeId"
            params={{ edgeId: row.original.id }}
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
        id: "publicIp",
        header: "Public IP",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.publicIp ?? "—"}
          </span>
        ),
      },
      {
        id: "domain",
        header: "Domain",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.domain}</span>
        ),
      },
      {
        id: "capacity",
        header: "Capacity",
        cell: ({ row }) => {
          const { activeTunnels, capacityLimit } = row.original;
          const pct =
            capacityLimit > 0
              ? Math.round((activeTunnels / capacityLimit) * 100)
              : 0;
          return (
            <span className="text-sm">
              {activeTunnels}/{capacityLimit}{" "}
              <span className="text-muted-foreground">({pct}%)</span>
            </span>
          );
        },
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
        title="Edges"
        description="Infrastructure that terminates public tunnels for your organization."
        actions={
          canCreate ? (
            <Button onClick={() => setRegisterOpen(true)}>
              <PlusIcon className="mr-2 size-4" />
              Register edge
            </Button>
          ) : null
        }
      />

      <PageToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, region, domain..."
        count={filtered.length}
        countLabel={filtered.length === 1 ? "edge" : "edges"}
      />

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No edges yet"
          description="Register a self-hosted edge to terminate public tunnel traffic."
          action={
            canCreate ? (
              <Button onClick={() => setRegisterOpen(true)}>
                Register edge
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable columns={columns} data={filtered} getRowId={(r) => r.id} />
      )}

      {orgId ? (
        <RegisterEdgeDialog
          orgId={orgId}
          open={registerOpen}
          onOpenChange={setRegisterOpen}
        />
      ) : null}
    </>
  );
}
