import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@tunnet/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tunnet/ui/components/dropdown-menu";
import { cn } from "@tunnet/ui/lib/utils";
import { CloudIcon, LogOutIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import { useFeature } from "@/hooks/use-entitlements";
import { authClient, signOut, useSession } from "@/lib/auth-client";

function initials(name: string | undefined, email: string) {
  if (name?.trim()) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function UserMenu({ className }: { className?: string }) {
  const { data: session } = useSession();
  const user = session?.user;
  const cloudInfra = useFeature("cloudInfrastructure");
  const { data: hasCloudAccess = false } = useQuery({
    queryKey: ["admin", "hasPermission", "cloud"],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data } = await authClient.admin.hasPermission({
        permissions: { cloud: ["access"] },
      });
      return Boolean(data?.success);
    },
  });
  const showCloudAdmin = Boolean(cloudInfra && hasCloudAccess);

  if (!user) return null;

  async function handleSignOut() {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/login";
        },
      },
    });
    toast.success("Signed out");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={user.name || user.email}
            className={cn(
              "relative flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-sm font-medium outline-none",
              "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              "focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
              "data-popup-open:bg-muted/70 data-popup-open:text-foreground",
              className,
            )}
          >
            <Avatar className="size-8 shrink-0 rounded-lg">
              {user.image ? (
                <AvatarImage src={user.image} alt={user.name ?? user.email} />
              ) : null}
              <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[state=collapsed]/sidebar:hidden">
              <span className="truncate font-medium">
                {user.name || "Account"}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {user.email}
              </span>
            </div>
          </button>
        }
      />
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="min-w-56"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground text-xs">{user.email}</p>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={<Link to="/settings" search={{ user_code: undefined }} />}
          >
            <UserIcon className="mr-2 size-4" />
            Settings
          </DropdownMenuItem>
          {showCloudAdmin ? (
            <DropdownMenuItem render={<Link to="/cloud" />}>
              <CloudIcon className="mr-2 size-4" />
              Cloud administration
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void handleSignOut()}>
            <LogOutIcon className="mr-2 size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
