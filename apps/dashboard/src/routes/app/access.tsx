import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  CreatePolicyBody,
  PatchPolicyBody,
  Policy,
} from "@tunnet/api/management";
import { formatDistanceToNow } from "date-fns";
import { ChevronRightIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PolicyFormSheet } from "@/components/app/acl/policy-form-sheet";
import {
  buildEndpointLabelMap,
  formatSelectorLabel,
} from "@/components/app/acl/policy-labels";
import { formatPortsInput } from "@/components/app/acl/ports-input";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/hooks/use-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { createManagementClient } from "@/lib/management-client";
import {
  useMachines,
  useNetworks,
  useOrganizationPolicies,
  usePolicyHistory,
} from "@/lib/queries/management";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/app/access")({
  component: AccessPage,
});

function AccessPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: networks, isPending } = useNetworks(orgId);
  const { data: machines } = useMachines(orgId);

  return (
    <>
      <PageHeader
        title="Access"
        description="Organization Deny policies are hard guardrails across all meshes. Network access mode (Open/Restricted) controls unmatched traffic."
      />

      <OrganizationPoliciesPanel />

      <div className="mt-8">
        <PolicyRevisionsPanel />
      </div>

      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-medium">Networks</h2>
        {isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(networks ?? []).map((network) => {
              const machineCount =
                machines?.filter((m) => m.networkId === network.id).length ?? 0;
              return (
                <Card key={network.id}>
                  <CardHeader>
                    <CardTitle className="text-base">{network.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                      {machineCount} machines · {network.cidr}
                      {network.defaultAction === "deny"
                        ? " · Restricted"
                        : " · Open"}
                    </p>
                    <Link
                      to="/app/networks/$networkId/access"
                      params={{ networkId: network.id }}
                      className="text-primary inline-flex items-center text-sm hover:underline"
                    >
                      Manage network policies
                      <ChevronRightIcon className="ml-1 size-4" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function OrganizationPoliciesPanel() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canManage = false } = useCan(orgId, "policy", "update");
  const { data: policies, isPending } = useOrganizationPolicies(orgId);
  const { data: machines } = useMachines(orgId);
  const endpointLabels = useMemo(
    () =>
      buildEndpointLabelMap(
        (machines ?? []).map((m) => ({
          endpointId: m.endpointId,
          name: m.name,
        })),
      ),
    [machines],
  );
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createPolicy = useMutation({
    mutationFn: async (body: CreatePolicyBody) => {
      if (!orgId) throw new Error("No organization");
      return createManagementClient(orgId).createOrganizationPolicy(body);
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organizationPolicies(orgId),
        });
      }
    },
  });

  const updatePolicy = useMutation({
    mutationFn: async ({
      policyId,
      body,
    }: {
      policyId: string;
      body: PatchPolicyBody;
    }) => {
      if (!orgId) throw new Error("No organization");
      return createManagementClient(orgId).updateOrganizationPolicy(
        policyId,
        body,
      );
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organizationPolicies(orgId),
        });
      }
    },
  });

  const deletePolicy = useMutation({
    mutationFn: async (policyId: string) => {
      if (!orgId) throw new Error("No organization");
      return createManagementClient(orgId).deleteOrganizationPolicy(policyId);
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organizationPolicies(orgId),
        });
      }
    },
  });

  const saving = createPolicy.isPending || updatePolicy.isPending;

  const columns = useMemo<ColumnDef<Policy>[]>(
    () => [
      {
        id: "slug",
        header: "Slug",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.slug ?? "—"}</span>
        ),
      },
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => (
          <span className="capitalize">{row.original.action}</span>
        ),
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }) => (
          <span className="text-xs">
            {formatSelectorLabel(row.original.srcSelector, endpointLabels)}
          </span>
        ),
      },
      {
        id: "destination",
        header: "Destination",
        cell: ({ row }) => (
          <span className="text-xs">
            {formatSelectorLabel(row.original.dstSelector, endpointLabels)}
          </span>
        ),
      },
      {
        id: "ports",
        header: "Ports",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.ports.length === 0
              ? "*"
              : formatPortsInput(row.original.ports)}
          </span>
        ),
      },
      {
        id: "protocol",
        header: "Protocol",
        cell: ({ row }) => row.original.protocol ?? "any",
      },
      {
        id: "order",
        header: "Order",
        accessorKey: "orderIndex",
      },
      {
        id: "srcPosture",
        header: "Src posture",
        cell: ({ row }) => {
          const posture = row.original.srcPosture;
          if (!posture?.length) return "—";
          return <span className="text-xs">{posture.join(", ")}</span>;
        },
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: "",
              meta: { headerClassName: "w-10" },
              cell: ({ row }: { row: { original: Policy } }) => (
                <Button
                  variant="ghost"
                  size="icon"
                  data-no-row-click
                  onClick={() => setDeleteId(row.original.id)}
                >
                  <TrashIcon className="size-4" />
                </Button>
              ),
            } satisfies ColumnDef<Policy>,
          ]
        : []),
    ],
    [canManage, endpointLabels],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Organization policies</h2>
          <p className="text-muted-foreground text-sm">
            Deny-only guardrails evaluated across every mesh before network
            allows.
          </p>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setEditing(null);
              setSheetOpen(true);
            }}
          >
            <PlusIcon className="mr-2 size-4" />
            Add org policy
          </Button>
        ) : null}
      </div>

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (policies?.length ?? 0) === 0 ? (
        <EmptyState
          title="No organization policies"
          description="Optional org-wide deny rules apply to every network in this tenant."
          action={
            canManage ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setSheetOpen(true);
                }}
              >
                Add org policy
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={policies ?? []}
          getRowId={(row) => row.id}
          onRowClick={
            canManage
              ? (row) => {
                  setEditing(row);
                  setSheetOpen(true);
                }
              : undefined
          }
        />
      )}

      <PolicyFormSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(null);
        }}
        scope="organization"
        orgId={orgId}
        editing={editing}
        loading={saving}
        onSubmit={async (body) => {
          try {
            if (editing) {
              await updatePolicy.mutateAsync({
                policyId: editing.id,
                body,
              });
              toast.success("Organization policy updated");
            } else {
              await createPolicy.mutateAsync(body as CreatePolicyBody);
              toast.success("Organization policy created");
            }
            setSheetOpen(false);
            setEditing(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save");
          }
        }}
      />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete organization policy"
        description="This rule will no longer apply across networks."
        confirmLabel="Delete"
        destructive
        loading={deletePolicy.isPending}
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await deletePolicy.mutateAsync(deleteId);
            toast.success("Policy deleted");
            setDeleteId(null);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to delete",
            );
          }
        }}
      />
    </div>
  );
}

function PolicyRevisionsPanel() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: revisions, isPending } = usePolicyHistory(orgId);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Policy revisions</h2>
        <p className="text-muted-foreground text-sm">
          Recent applies from the dashboard, API, GitOps, or Terraform.
        </p>
      </div>

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (revisions?.length ?? 0) === 0 ? (
        <p className="text-muted-foreground text-sm">
          No revisions yet. GitOps apply writes a revision on success; use drift
          checks and --force when reconciling conflicts.
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {(revisions ?? []).slice(0, 10).map((rev) => (
            <li
              key={rev.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm"
            >
              <Badge variant="secondary" className="capitalize">
                {rev.source}
              </Badge>
              <span className="text-muted-foreground">v{rev.version}</span>
              <span className="font-mono text-xs">
                {rev.contentHash.slice(0, 12)}
                {rev.contentHash.length > 12 ? "…" : ""}
              </span>
              <span className="text-muted-foreground ml-auto text-xs">
                {formatDistanceToNow(new Date(rev.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
