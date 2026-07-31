import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  CreatePolicyBody,
  CreateSshPolicyBody,
  PatchPolicyBody,
  Policy,
  SshPolicy,
} from "@tunnet/api/management";
import { PlusIcon, TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessModeBanner } from "@/components/app/acl/access-mode-banner";
import { EffectivePolicyPanel } from "@/components/app/acl/effective-policy-panel";
import { ExplainSimulatePanel } from "@/components/app/acl/explain-simulate-panel";
import { PolicyFormSheet } from "@/components/app/acl/policy-form-sheet";
import {
  buildEndpointLabelMap,
  formatSelectorLabel,
} from "@/components/app/acl/policy-labels";
import { formatPortsInput } from "@/components/app/acl/ports-input";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import {
  buildPolicySelector,
  formatPolicySelector,
  PolicySelectorFields,
} from "@/components/app/policy-selector-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/hooks/use-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { createManagementClient } from "@/lib/management-client";
import {
  useMachines,
  useNetwork,
  useNetworkMutations,
  useOrganizationPolicies,
  usePolicies,
  useSshPolicies,
} from "@/lib/queries/management";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/app/networks/$networkId/access")({
  component: NetworkAccessPage,
});

function NetworkAccessPage() {
  const [section, setSection] = useState<"network" | "ssh">("network");

  return (
    <div className="space-y-5">
      <Tabs
        value={section}
        onValueChange={(v) => setSection(v as "network" | "ssh")}
      >
        <TabsList variant="line" className="w-fit">
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="ssh">SSH Rules</TabsTrigger>
        </TabsList>
      </Tabs>
      {section === "network" ? <NetworkPoliciesPanel /> : <SshRulesPanel />}
    </div>
  );
}

function NetworkPoliciesPanel() {
  const { networkId } = Route.useParams();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canManage = false } = useCan(orgId, "policy", "update");
  const { data: network, isPending: networkPending } = useNetwork(
    orgId,
    networkId,
  );
  const { data: policies, isPending } = usePolicies(orgId, networkId);
  const { data: orgPolicies } = useOrganizationPolicies(orgId);
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
  const { update: updateNetwork } = useNetworkMutations(orgId);
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [prefillAllowAny, setPrefillAllowAny] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toolsTab, setToolsTab] = useState<"stack" | "explain">("stack");

  const createPolicy = useMutation({
    mutationFn: async (body: CreatePolicyBody) => {
      if (!orgId) throw new Error("No organization");
      return createManagementClient(orgId).createPolicy(networkId, body);
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.policies(orgId, networkId),
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
      return createManagementClient(orgId).updatePolicy(
        networkId,
        policyId,
        body,
      );
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.policies(orgId, networkId),
        });
      }
    },
  });

  const deletePolicy = useMutation({
    mutationFn: async (policyId: string) => {
      if (!orgId) throw new Error("No organization");
      return createManagementClient(orgId).deletePolicy(networkId, policyId);
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.policies(orgId, networkId),
        });
      }
    },
  });

  const saving = createPolicy.isPending || updatePolicy.isPending;
  const defaultAction = network?.defaultAction ?? "allow";
  const icmpPolicy = network?.icmpPolicy ?? "allow";

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

  function openCreate() {
    setEditing(null);
    setPrefillAllowAny(false);
    setSheetOpen(true);
  }

  return (
    <div className="space-y-5">
      {networkPending ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <AccessModeBanner
          defaultAction={defaultAction}
          icmpPolicy={icmpPolicy}
          networkPolicies={policies ?? []}
          canManage={canManage}
          loading={updateNetwork.isPending}
          onUpdateDefaultAction={async (next) => {
            await updateNetwork.mutateAsync({
              networkId,
              body: { defaultAction: next },
            });
          }}
          onUpdateIcmpPolicy={async (next) => {
            await updateNetwork.mutateAsync({
              networkId,
              body: { icmpPolicy: next },
            });
          }}
          onSuggestAllowAny={() => {
            setEditing(null);
            setPrefillAllowAny(true);
            setSheetOpen(true);
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Access control policies for this network.
        </p>
        {canManage ? (
          <Button onClick={openCreate}>
            <PlusIcon className="mr-2 size-4" />
            Add policy
          </Button>
        ) : null}
      </div>

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (policies?.length ?? 0) === 0 ? (
        <EmptyState
          title="No policies"
          description={
            defaultAction === "deny"
              ? "Restricted mode denies unmatched traffic. Add allow policies for the flows you need."
              : "Add deny policies to block specific traffic, or switch to Restricted for default-deny."
          }
          action={
            canManage ? (
              <Button onClick={openCreate}>Add policy</Button>
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
                  setPrefillAllowAny(false);
                  setSheetOpen(true);
                }
              : undefined
          }
        />
      )}

      <Tabs
        value={toolsTab}
        onValueChange={(v) => setToolsTab(v as "stack" | "explain")}
      >
        <TabsList variant="line" className="w-fit">
          <TabsTrigger value="stack">Effective stack</TabsTrigger>
          <TabsTrigger value="explain">Explain</TabsTrigger>
        </TabsList>
        <TabsContent value="stack" className="mt-4">
          <EffectivePolicyPanel
            orgId={orgId}
            orgPolicies={orgPolicies ?? []}
            networkPolicies={policies ?? []}
            defaultAction={defaultAction}
          />
        </TabsContent>
        <TabsContent value="explain" className="mt-4">
          <ExplainSimulatePanel
            orgPolicies={orgPolicies ?? []}
            networkPolicies={policies ?? []}
            defaultAction={defaultAction}
            icmpPolicy={icmpPolicy}
          />
        </TabsContent>
      </Tabs>

      <PolicyFormSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setEditing(null);
            setPrefillAllowAny(false);
          }
        }}
        scope="network"
        orgId={orgId}
        networkId={networkId}
        defaultAction={defaultAction}
        editing={editing}
        prefill={
          prefillAllowAny
            ? {
                action: "allow",
                srcKind: "any",
                srcValue: "",
                dstKind: "any",
                dstValue: "",
                protocol: "any",
                ports: [],
                slug: "allow-any-any",
              }
            : null
        }
        loading={saving}
        onSubmit={async (body) => {
          try {
            if (editing) {
              await updatePolicy.mutateAsync({
                policyId: editing.id,
                body,
              });
              toast.success("Policy updated");
            } else {
              await createPolicy.mutateAsync(body as CreatePolicyBody);
              toast.success("Policy created");
            }
            setSheetOpen(false);
            setEditing(null);
            setPrefillAllowAny(false);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to save policy",
            );
          }
        }}
      />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete policy"
        description="This policy will be removed from the network."
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

function SshRulesPanel() {
  const { networkId } = Route.useParams();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canManage = false } = useCan(orgId, "policy", "update");
  const { data: policies, isPending } = useSshPolicies(orgId, networkId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createPolicy = useMutation({
    mutationFn: async (body: CreateSshPolicyBody) => {
      if (!orgId) throw new Error("No organization");
      return createManagementClient(orgId).createSshPolicy(networkId, body);
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sshPolicies(orgId, networkId),
        });
      }
    },
  });

  const deletePolicy = useMutation({
    mutationFn: async (policyId: string) => {
      if (!orgId) throw new Error("No organization");
      return createManagementClient(orgId).deleteSshPolicy(networkId, policyId);
    },
    onSuccess: () => {
      if (orgId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sshPolicies(orgId, networkId),
        });
      }
    },
  });

  const columns = useMemo<ColumnDef<SshPolicy>[]>(
    () => [
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => (
          <span className="capitalize">{row.original.action}</span>
        ),
      },
      {
        id: "users",
        header: "Users",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.users.join(", ")}
          </span>
        ),
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {formatPolicySelector(row.original.srcSelector)}
          </span>
        ),
      },
      {
        id: "destination",
        header: "Destination",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {formatPolicySelector(row.original.dstSelector)}
          </span>
        ),
      },
      {
        id: "check",
        header: "Check period",
        cell: ({ row }) =>
          row.original.checkPeriodSecs
            ? `${row.original.checkPeriodSecs}s`
            : "—",
      },
      {
        id: "record",
        header: "Record",
        cell: ({ row }) => (row.original.record ? "yes" : "no"),
      },
      {
        id: "priority",
        header: "Priority",
        accessorKey: "priority",
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: "",
              meta: { headerClassName: "w-10" },
              cell: ({ row }: { row: { original: SshPolicy } }) => (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteId(row.original.id)}
                >
                  <TrashIcon className="size-4" />
                </Button>
              ),
            } satisfies ColumnDef<SshPolicy>,
          ]
        : []),
    ],
    [canManage],
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          SSH access rules. Empty means deny. Check mode requires periodic IdP
          re-auth.
        </p>
        {canManage ? (
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-2 size-4" />
            Add SSH rule
          </Button>
        ) : null}
      </div>

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (policies?.length ?? 0) === 0 ? (
        <EmptyState
          title="No SSH rules"
          description="Add rules to allow SSH between machines. Without rules, SSH is denied."
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>Add SSH rule</Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={policies ?? []}
          getRowId={(row) => row.id}
        />
      )}

      <CreateSshRuleDialog
        orgId={orgId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        loading={createPolicy.isPending}
        onSubmit={async (body) => {
          try {
            await createPolicy.mutateAsync(body);
            toast.success("SSH rule created");
            setCreateOpen(false);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Failed to create",
            );
          }
        }}
      />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete SSH rule"
        description="This SSH rule will be removed from the network."
        confirmLabel="Delete"
        destructive
        loading={deletePolicy.isPending}
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await deletePolicy.mutateAsync(deleteId);
            toast.success("SSH rule deleted");
            setDeleteId(null);
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

function CreateSshRuleDialog({
  orgId,
  open,
  onOpenChange,
  loading,
  onSubmit,
}: {
  orgId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  onSubmit: (body: CreateSshPolicyBody) => Promise<void>;
}) {
  const [action, setAction] = useState<"accept" | "check" | "deny">("accept");
  const [users, setUsers] = useState("root");
  const [srcKind, setSrcKind] = useState("any");
  const [dstKind, setDstKind] = useState("any");
  const [srcValue, setSrcValue] = useState("");
  const [dstValue, setDstValue] = useState("");
  const [checkPeriod, setCheckPeriod] = useState("28800");
  const [record, setRecord] = useState(false);
  const [enforceRecorder, setEnforceRecorder] = useState(false);
  const [priority, setPriority] = useState("0");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const userList = users
      .split(/[,\s]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    await onSubmit({
      action,
      users: userList,
      srcSelector: buildPolicySelector(srcKind, srcValue),
      dstSelector: buildPolicySelector(dstKind, dstValue),
      record,
      enforceRecorder,
      checkPeriodSecs: action === "check" ? Number(checkPeriod) || 28800 : null,
      priority: Number(priority) || 0,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Add SSH rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select
                value={action}
                onValueChange={(v) =>
                  setAction(v as "accept" | "check" | "deny")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accept">Accept</SelectItem>
                  <SelectItem value="check">
                    Check (periodic re-auth)
                  </SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ssh-users">Allowed users</Label>
              <Input
                id="ssh-users"
                value={users}
                onChange={(e) => setUsers(e.target.value)}
                placeholder="root, ubuntu"
                required
              />
            </div>
            <PolicySelectorFields
              orgId={orgId}
              label="Source"
              kind={srcKind}
              value={srcValue}
              onKindChange={setSrcKind}
              onValueChange={setSrcValue}
            />
            <PolicySelectorFields
              orgId={orgId}
              label="Destination"
              kind={dstKind}
              value={dstValue}
              onKindChange={setDstKind}
              onValueChange={setDstValue}
            />
            {action === "check" ? (
              <div className="space-y-2">
                <Label htmlFor="check-period">Check period (seconds)</Label>
                <Input
                  id="check-period"
                  type="number"
                  min={60}
                  value={checkPeriod}
                  onChange={(e) => setCheckPeriod(e.target.value)}
                  required
                />
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="ssh-record">Session recording</Label>
              <Switch
                id="ssh-record"
                checked={record}
                onCheckedChange={setRecord}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="ssh-enforce">Enforce remote recorder</Label>
              <Switch
                id="ssh-enforce"
                checked={enforceRecorder}
                onCheckedChange={setEnforceRecorder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ssh-priority">Priority</Label>
              <Input
                id="ssh-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
