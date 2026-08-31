import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { PlanId } from "@tunnet/api/billing";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@tunnet/ui/components/avatar";
import { Button } from "@tunnet/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tunnet/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tunnet/ui/components/dropdown-menu";
import { Input } from "@tunnet/ui/components/input";
import { Label } from "@tunnet/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tunnet/ui/components/select";
import { Skeleton } from "@tunnet/ui/components/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import {
  DownloadIcon,
  MailIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import {
  DataTable,
  type DataTableColumnDef,
} from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PageToolbar } from "@/components/app/page-toolbar";
import { PlanGate } from "@/components/app/plan/plan-gate";
import { UpgradeCTA } from "@/components/app/plan/upgrade-cta";
import { UpgradePlanDialog } from "@/components/app/upgrade-plan-dialog";
import { useFeature } from "@/hooks/use-entitlements";
import { inviteBlockedReason, useOrgPlan } from "@/hooks/use-org-plan";
import { useCan } from "@/hooks/use-permission";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import {
  createManagementClient,
  ManagementApiError,
} from "@/lib/management-client";
import { queryKeys } from "@/lib/query-keys";
import {
  formatMemberRole,
  getUserInitials,
  tableHeaderClassName,
} from "@/lib/user-utils";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
});

type ViewFilter = "members" | "invitations";
type RoleFilter = "all" | "owner" | "admin" | "member";

function UsersPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: canManage = false } = useCan(orgId, "member", "update");
  const cloudInvites = useFeature("openSignUp");
  const canCreateUsers = !cloudInvites;
  const { data: orgPlan } = useOrgPlan();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);
  const [changeRoleMember, setChangeRoleMember] = useState<{
    id: string;
    role: string;
    name: string;
  } | null>(null);
  const [cancelInviteId, setCancelInviteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewFilter>("members");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const showingInvitations = cloudInvites && view === "invitations";
  const inviteBlock = cloudInvites ? inviteBlockedReason(orgPlan) : null;
  const inviteLocked = inviteBlock != null;
  const inviteLockTitle =
    inviteBlock === "seat_limit"
      ? "Seat limit reached"
      : "Invites require Team";
  const inviteLockDescription =
    inviteBlock === "seat_limit"
      ? "Add seats to your plan before inviting more members."
      : "Upgrade to Team to invite members to this organization.";
  const inviteRequiredPlan = inviteBlock === "seat_limit" ? undefined : "team";
  const inviteCtaLabel =
    inviteBlock === "seat_limit" ? "Add seats" : "Upgrade to Team";

  const { data: membersData, isPending: membersPending } = useQuery({
    queryKey: orgId ? queryKeys.members(orgId) : ["members"],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await authClient.organization.listMembers({
        query: { organizationId: orgId!, limit: 100 },
      });
      if (error) throw new Error(error.message);
      return data?.members ?? [];
    },
  });

  const { data: invitations, isPending: invitationsPending } = useQuery({
    queryKey: orgId ? queryKeys.invitations(orgId) : ["invitations"],
    enabled: Boolean(orgId) && cloudInvites,
    queryFn: async () => {
      const { data, error } = await authClient.organization.listInvitations({
        query: { organizationId: orgId! },
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  function invalidate() {
    if (orgId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.members(orgId),
      });
      if (cloudInvites) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.invitations(orgId),
        });
      }
    }
  }

  type Member = NonNullable<typeof membersData>[number];
  type Invitation = NonNullable<typeof invitations>[number];

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (membersData ?? []).filter((member) => {
      const matchesRole =
        roleFilter === "all" || member.role.toLowerCase().includes(roleFilter);
      if (!matchesRole) return false;
      if (!q) return true;
      return (
        member.user.name.toLowerCase().includes(q) ||
        member.user.email.toLowerCase().includes(q) ||
        member.role.toLowerCase().includes(q)
      );
    });
  }, [membersData, roleFilter, search]);

  const filteredInvitations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (invitations ?? []).filter((invitation) => {
      if (!q) return true;
      return (
        invitation.email.toLowerCase().includes(q) ||
        invitation.role.toLowerCase().includes(q) ||
        invitation.status.toLowerCase().includes(q)
      );
    });
  }, [invitations, search]);

  const memberColumns = useMemo<DataTableColumnDef<Member>[]>(
    () => [
      {
        id: "user",
        header: "User",
        meta: { headerClassName: tableHeaderClassName },
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar size="default">
                {member.user.image ? (
                  <AvatarImage src={member.user.image} alt={member.user.name} />
                ) : null}
                <AvatarFallback>
                  {getUserInitials(member.user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate font-medium">{member.user.name}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {member.user.email}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: "Role",
        meta: { headerClassName: tableHeaderClassName },
        cell: ({ row }) => formatMemberRole(row.original.role),
      },
      {
        id: "joined",
        header: "Joined",
        meta: { headerClassName: tableHeaderClassName },
        cell: ({ row }) => {
          const createdAt = row.original.createdAt;
          if (!createdAt) return "-";
          return format(new Date(createdAt), "MMM d, yyyy");
        },
      },
      {
        id: "lastSeen",
        header: "Last seen",
        meta: { headerClassName: tableHeaderClassName },
        cell: () => <span className="text-muted-foreground text-sm">-</span>,
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: "",
              meta: { headerClassName: "w-10" },
              cell: ({ row }: { row: { original: Member } }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon" className="size-8" />
                    }
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={() =>
                          setChangeRoleMember({
                            id: row.original.id,
                            role: row.original.role,
                            name: row.original.user.name,
                          })
                        }
                      >
                        Change role
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={row.original.role.includes("owner")}
                        onClick={() => setRemoveMemberId(row.original.id)}
                      >
                        Remove member
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies DataTableColumnDef<Member>,
          ]
        : []),
    ],
    [canManage],
  );

  const invitationColumns = useMemo<DataTableColumnDef<Invitation>[]>(
    () => [
      {
        id: "user",
        header: "User",
        meta: { headerClassName: tableHeaderClassName },
        cell: ({ row }) => {
          const invitation = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar size="default">
                <AvatarFallback>
                  {getUserInitials(invitation.email.split("@")[0] ?? "?")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate font-medium">{invitation.email}</div>
                <div className="text-muted-foreground text-xs capitalize">
                  {invitation.status}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: "Role",
        meta: { headerClassName: tableHeaderClassName },
        cell: ({ row }) => formatMemberRole(row.original.role),
      },
      {
        id: "expires",
        header: "Expires",
        meta: { headerClassName: tableHeaderClassName },
        cell: ({ row }) =>
          formatDistanceToNow(new Date(row.original.expiresAt), {
            addSuffix: true,
          }),
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: "",
              meta: { headerClassName: "w-10" },
              cell: ({ row }: { row: { original: Invitation } }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon" className="size-8" />
                    }
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setCancelInviteId(row.original.id)}
                      >
                        Cancel invitation
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies DataTableColumnDef<Invitation>,
          ]
        : []),
    ],
    [canManage],
  );

  const isPending = showingInvitations ? invitationsPending : membersPending;
  const rowCount = showingInvitations
    ? filteredInvitations.length
    : filteredMembers.length;
  const countLabel = showingInvitations
    ? rowCount === 1
      ? "invitation"
      : "invitations"
    : rowCount === 1
      ? "user"
      : "users";

  function exportCsv() {
    const rows = showingInvitations
      ? [
          ["Email", "Role", "Status", "Expires"],
          ...filteredInvitations.map((inv) => [
            inv.email,
            inv.role,
            inv.status,
            new Date(inv.expiresAt).toISOString(),
          ]),
        ]
      : [
          ["Name", "Email", "Role", "Joined"],
          ...filteredMembers.map((member) => [
            member.user.name,
            member.user.email,
            member.role,
            member.createdAt
              ? format(new Date(member.createdAt), "yyyy-MM-dd")
              : "",
          ]),
        ];

    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = showingInvitations ? "invitations.csv" : "users.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Users"
        description={
          cloudInvites
            ? "Manage organization members and invitations."
            : "Manage organization members."
        }
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              {cloudInvites ? (
                inviteBlock === "no_invites" ? null : inviteLocked ? (
                  <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                    <Button type="button" disabled>
                      <MailIcon className="mr-2 size-4" />
                      Invite
                    </Button>
                    <UpgradeCTA
                      requiredPlan={inviteRequiredPlan}
                      label={inviteCtaLabel}
                      size="sm"
                      variant="outline"
                      onUpgrade={() => setUpgradeOpen(true)}
                    />
                  </div>
                ) : (
                  <Button onClick={() => setInviteOpen(true)}>
                    <MailIcon className="mr-2 size-4" />
                    Invite
                  </Button>
                )
              ) : null}
              {canCreateUsers ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <PlusIcon className="mr-2 size-4" />
                  Create user
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <PageToolbar
        className="mb-4"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search users..."
        count={rowCount}
        countLabel={countLabel}
        filters={
          <>
            {cloudInvites ? (
              <Select
                value={view}
                onValueChange={(value) => setView(value as ViewFilter)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="members">Members</SelectItem>
                  <SelectItem value="invitations">Invitations</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {!showingInvitations ? (
              <Select
                value={roleFilter}
                onValueChange={(value) => setRoleFilter(value as RoleFilter)}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </>
        }
        actions={
          <Button variant="outline" size="icon" onClick={exportCsv}>
            <DownloadIcon className="size-4" />
            <span className="sr-only">Export</span>
          </Button>
        }
      />

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : rowCount === 0 ? (
        <PlanGate
          locked={Boolean(cloudInvites && inviteLocked && canManage)}
          title={inviteLockTitle}
          description={inviteLockDescription}
          requiredPlan={inviteRequiredPlan}
          upgradeLabel={inviteCtaLabel}
          onUpgrade={() => setUpgradeOpen(true)}
        >
          <EmptyState
            title={
              showingInvitations ? "No pending invitations" : "No users found"
            }
            description={
              showingInvitations
                ? "Invite someone to join your organization."
                : search || roleFilter !== "all"
                  ? "Try adjusting your search or filters."
                  : canCreateUsers
                    ? "Create a user account to get started."
                    : "Invite your team to get started."
            }
            action={
              canManage && !showingInvitations ? (
                cloudInvites ? (
                  <Button
                    disabled={inviteLocked}
                    onClick={() => setInviteOpen(true)}
                  >
                    Invite
                  </Button>
                ) : canCreateUsers ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    Create user
                  </Button>
                ) : undefined
              ) : undefined
            }
          />
        </PlanGate>
      ) : showingInvitations ? (
        <PlanGate
          locked={Boolean(inviteLocked && canManage)}
          title={inviteLockTitle}
          description={inviteLockDescription}
          requiredPlan={inviteRequiredPlan}
          upgradeLabel={inviteCtaLabel}
          onUpgrade={() => setUpgradeOpen(true)}
        >
          <DataTable
            columns={invitationColumns}
            data={filteredInvitations}
            getRowId={(row) => row.id}
          />
        </PlanGate>
      ) : (
        <div className="space-y-4">
          {inviteLocked && canManage ? (
            <PlanGate
              locked
              title={inviteLockTitle}
              description={inviteLockDescription}
              requiredPlan={inviteRequiredPlan}
              upgradeLabel={inviteCtaLabel}
              onUpgrade={() => setUpgradeOpen(true)}
              inert={false}
            />
          ) : null}
          <DataTable
            columns={memberColumns}
            data={filteredMembers}
            getRowId={(row) => row.id}
          />
        </div>
      )}

      {cloudInvites ? (
        <InviteDialog
          orgId={orgId}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onSuccess={invalidate}
        />
      ) : null}

      {cloudInvites && orgId ? (
        <UpgradePlanDialog
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          organizationId={orgId}
          currentPlanId={(orgPlan?.planId as PlanId) || "free"}
          subscriptionId={orgPlan?.subscriptionId}
          initialPlan="team"
        />
      ) : null}

      {canCreateUsers ? (
        <CreateUserDialog
          orgId={orgId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={invalidate}
        />
      ) : null}

      <ConfirmDialog
        open={removeMemberId !== null}
        onOpenChange={(open) => !open && setRemoveMemberId(null)}
        title="Remove member"
        description="This member will lose access to the organization."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const member = membersData?.find((m) => m.id === removeMemberId);
          if (!member) return;
          const { error } = await authClient.organization.removeMember({
            memberIdOrEmail: member.id,
            organizationId: orgId,
          });
          if (error) {
            toast.error(error.message ?? "Failed to remove member");
            return;
          }
          toast.success("Member removed");
          setRemoveMemberId(null);
          invalidate();
        }}
      />

      <ChangeRoleDialog
        orgId={orgId}
        member={changeRoleMember}
        open={changeRoleMember !== null}
        onOpenChange={(open) => !open && setChangeRoleMember(null)}
        onSuccess={invalidate}
      />

      {cloudInvites ? (
        <ConfirmDialog
          open={cancelInviteId !== null}
          onOpenChange={(open) => !open && setCancelInviteId(null)}
          title="Cancel invitation"
          description="This invitation will no longer be valid."
          confirmLabel="Cancel invitation"
          destructive
          onConfirm={async () => {
            if (!cancelInviteId) return;
            const { error } = await authClient.organization.cancelInvitation({
              invitationId: cancelInviteId,
            });
            if (error) {
              toast.error(error.message ?? "Failed to cancel invitation");
              return;
            }
            toast.success("Invitation cancelled");
            setCancelInviteId(null);
            invalidate();
          }}
        />
      ) : null}
    </>
  );
}

function InviteDialog({
  orgId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { data: roles = ["member", "admin"] } = useAssignableRoles(orgId);
  const [email, setEmail] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setLoading(true);
    const { error } = await authClient.organization.inviteMember({
      email: email.trim(),
      role: memberRole,
      organizationId: orgId,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Failed to send invitation");
      return;
    }
    toast.success("Invitation sent");
    setEmail("");
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-muted-foreground text-sm">
              Send an email invitation. They can sign up or sign in to join.
            </p>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={setEmail}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={memberRole}
                onValueChange={(v) => {
                  if (v) setMemberRole(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {formatMemberRole(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <MailIcon className="mr-2 size-4" />
              {loading ? "Sending..." : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({
  orgId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { data: roles = ["member", "admin"] } = useAssignableRoles(orgId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setLoading(true);
    try {
      const client = createManagementClient(orgId);
      await client.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role: memberRole,
      });
      toast.success("User created");
      setName("");
      setEmail("");
      setPassword("");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ManagementApiError || err instanceof Error
          ? err.message
          : "Failed to create user",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-muted-foreground text-sm">
              Creates an account and adds them to this organization. Share the
              password securely.
            </p>
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                value={name}
                onChange={setName}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-email">Email</Label>
              <Input
                id="create-email"
                type="email"
                value={email}
                onChange={setEmail}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">Password</Label>
              <Input
                id="create-password"
                type="password"
                value={password}
                onChange={setPassword}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={memberRole}
                onValueChange={(v) => {
                  if (v) setMemberRole(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {formatMemberRole(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <PlusIcon className="mr-2 size-4" />
              {loading ? "Creating..." : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useAssignableRoles(orgId: string | undefined) {
  return useQuery({
    queryKey: orgId
      ? [...queryKeys.org(orgId), "roles", "assignable"]
      : ["roles"],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await authClient.organization.listRoles({
        query: { organizationId: orgId! },
      });
      if (error) throw new Error(error.message);
      const dynamic = (data ?? []).map((r) => r.role);
      return ["member", "admin", ...dynamic.filter((r) => r !== "owner")];
    },
  });
}

function ChangeRoleDialog({
  orgId,
  member,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string | undefined;
  member: { id: string; role: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { data: roles = ["member", "admin"] } = useAssignableRoles(orgId);
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && member) {
      setRole(member.role.split(",")[0]?.trim() || "member");
    }
  }, [open, member]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !member) return;
    setLoading(true);
    const { error } = await authClient.organization.updateMemberRole({
      memberId: member.id,
      role,
      organizationId: orgId,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Failed to update role");
      return;
    }
    toast.success("Role updated");
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-muted-foreground text-sm">
              Update the organization role for {member?.name}.
            </p>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={role}
                onValueChange={(value) => {
                  if (value) setRole(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {formatMemberRole(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              {loading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
