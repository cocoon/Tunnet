import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@tunnet/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@tunnet/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tunnet/ui/components/popover";
import { cn } from "@tunnet/ui/lib/utils";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CreateOrganizationDialog } from "@/components/app/create-organization-dialog";
import { useFeature } from "@/hooks/use-entitlements";
import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
} from "@/lib/auth-client";
import { queryKeys } from "@/lib/query-keys";

export function OrgSwitcher() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: organizationsRaw, isPending } = useListOrganizations();
  const organizations = (
    Array.isArray(organizationsRaw) ? organizationsRaw : []
  ).filter((org) => !(org as { deletedAt?: string | Date | null }).deletedAt);
  const { data: activeOrganization, isPending: activeOrganizationPending } =
    useActiveOrganization();
  const multiOrg = useFeature("multiOrganization");
  const defaultOrganizationId = useRef<string | null>(null);

  useEffect(() => {
    if (
      isPending ||
      activeOrganizationPending ||
      activeOrganization ||
      !organizations?.length
    ) {
      return;
    }

    const firstOrganization = organizations[0];
    if (
      !firstOrganization ||
      defaultOrganizationId.current === firstOrganization.id
    ) {
      return;
    }

    defaultOrganizationId.current = firstOrganization.id;
    void authClient.organization
      .setActive({ organizationId: firstOrganization.id })
      .then(({ error }) => {
        if (error) {
          defaultOrganizationId.current = null;
          return;
        }

        void queryClient.invalidateQueries();
      });
  }, [
    activeOrganization,
    activeOrganizationPending,
    isPending,
    organizations,
    queryClient,
  ]);

  async function switchOrg(organizationId: string) {
    const { error } = await authClient.organization.setActive({
      organizationId,
    });
    if (error) {
      toast.error(error.message ?? "Failed to switch organization");
      return;
    }
    void queryClient.invalidateQueries();
    if (activeOrganization?.id) {
      void queryClient.removeQueries({
        queryKey: queryKeys.org(activeOrganization.id),
      });
    }
    setOpen(false);
    toast.success("Organization switched");
  }

  if (!multiOrg) {
    return (
      <span className="truncate px-2 text-sm font-medium">
        {isPending
          ? "Loading..."
          : (activeOrganization?.name ?? "Organization")}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className="h-9 max-w-[220px] justify-between px-2 font-medium"
          />
        }
      >
        <span className="truncate">
          {isPending
            ? "Loading..."
            : (activeOrganization?.name ?? "Select organization")}
        </span>
        <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search organizations..." />
          <CommandList>
            <CommandEmpty>No organizations found.</CommandEmpty>
            <CommandGroup heading="Organizations">
              {(organizations ?? []).map((org) => (
                <CommandItem
                  key={org.id}
                  value={org.name}
                  onSelect={() => void switchOrg(org.id)}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4",
                      activeOrganization?.id === org.id
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {org.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
              >
                <PlusIcon className="mr-2 size-4" />
                Create organization
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </Popover>
  );
}
