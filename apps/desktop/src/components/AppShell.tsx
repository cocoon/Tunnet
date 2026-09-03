import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@tunnet/ui/components/alert-dialog";
import { Badge } from "@tunnet/ui/components/badge";
import { Button } from "@tunnet/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tunnet/ui/components/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@tunnet/ui/components/sidebar";
import {
  Download,
  LayoutDashboard,
  RotateCw,
  Server,
  Settings,
  Share2,
  Shield,
  Terminal,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useApp } from "@/lib/app-context";
import { useDesktopUpdate } from "@/lib/desktop-update-context";
import { useDirectNetwork } from "@/lib/direct-network-context";
import { useSettingsDialog } from "@/lib/settings-dialog-context";
import type { NetworkSummary } from "@/lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  directOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: "/app", label: "Home", icon: LayoutDashboard },
  { to: "/app/peers", label: "Devices", icon: Share2 },
  { to: "/app/firewall", label: "Firewall", icon: Shield, directOnly: true },
  { to: "/app/serve", label: "Share", icon: Server },
  { to: "/app/ssh", label: "SSH", icon: Terminal, badge: "Soon" },
];

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function modeLabel(mode: string | undefined) {
  if (mode === "direct") return "Direct";
  if (mode === "managed") return "Managed";
  return mode ?? "—";
}

function activeNetworkForMode(
  node: ReturnType<typeof useApp>["node"],
  directNetwork: NetworkSummary | undefined,
): NetworkSummary | undefined {
  if (!node) return undefined;
  if (node.mode === "managed") {
    return node.networks.find((n) => n.mode === "managed");
  }
  return directNetwork ?? node.networks.find((n) => n.mode === "direct");
}

export function AppShell() {
  const { node, meta, error } = useApp();
  const { networks, setNetworkId, activeNetwork } = useDirectNetwork();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const desktopUpdate = useDesktopUpdate();
  const { openSettings } = useSettingsDialog();
  const [restartDialog, setRestartDialog] = useState(false);

  const network = activeNetworkForMode(node, activeNetwork);
  const isDirect = meta?.mode === "direct" || node?.mode === "direct";
  const visibleNav = navItems.filter((item) => !item.directOnly || isDirect);
  const connected = node?.data_plane_up ?? false;

  function handleNavigate(to: string) {
    void navigate({ to });
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-border">
          <Link
            to="/app"
            className="flex items-center gap-2 overflow-hidden rounded-lg py-1"
          >
            <img src="/logo.png" alt="Tunnet" className="size-7 shrink-0" />
            <div className="flex min-w-0 items-center gap-2 group-data-[state=collapsed]/sidebar:hidden">
              <span className="truncate font-semibold tracking-tight">
                Tunnet
              </span>
              <Badge variant="secondary" className="shrink-0 capitalize">
                {modeLabel(meta?.mode ?? node?.mode)}
              </Badge>
            </div>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Menu</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNav.map((item) => {
                  const active =
                    item.to === "/app"
                      ? pathname === "/app" || pathname === "/app/"
                      : pathname === item.to ||
                        pathname.startsWith(`${item.to}/`);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        icon={<Icon className="size-4" />}
                        isActive={active}
                        badge={item.badge}
                        onSelect={() => handleNavigate(item.to)}
                      >
                        {item.label}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {isDirect && networks.length > 1 ? (
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="px-2">Network</SidebarGroupLabel>
              <Select
                value={activeNetwork?.network_id ?? ""}
                onValueChange={(value) => setNetworkId(value ?? "")}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="Select network" />
                </SelectTrigger>
                <SelectContent>
                  {networks.map((n) => (
                    <SelectItem key={n.network_id} value={n.network_id}>
                      {n.network_name || shortId(n.network_id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SidebarGroup>
          ) : null}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={<Settings className="size-4" />}
                onSelect={() => openSettings("general")}
              >
                Settings
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="flex max-h-svh flex-col overflow-hidden">
        <header className="z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm supports-backdrop-filter:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {network?.network_name || "Tunnet"}
            </span>
            <span
              className={
                connected
                  ? "hidden text-xs text-success sm:inline"
                  : "hidden text-xs text-muted-foreground sm:inline"
              }
            >
              {connected ? "Connected" : "Paused"}
            </span>
          </div>
          {network?.ip ? (
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/80 bg-muted/40 py-0.5 pr-0.5 pl-2">
              <span className="font-mono text-xs">{network.ip}</span>
              <CopyButton value={network.ip} label="Address" />
            </div>
          ) : null}
          {desktopUpdate.phase === "available" ||
          desktopUpdate.phase === "downloading" ||
          desktopUpdate.phase === "ready" ? (
            <div className="relative size-8 shrink-0">
              {desktopUpdate.phase === "downloading" ? (
                <svg
                  className="pointer-events-none absolute inset-0 -rotate-90"
                  viewBox="0 0 32 32"
                  aria-hidden="true"
                >
                  <circle
                    cx="16"
                    cy="16"
                    r="14.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-border"
                  />
                  <circle
                    cx="16"
                    cy="16"
                    r="14.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    pathLength="1"
                    strokeDasharray="1"
                    strokeDashoffset={1 - desktopUpdate.progress}
                    className="text-primary transition-[stroke-dashoffset]"
                  />
                </svg>
              ) : null}
              <Button
                size="icon-sm"
                variant="ghost"
                className="absolute inset-0 m-auto"
                disabled={desktopUpdate.phase === "downloading"}
                aria-label={
                  desktopUpdate.phase === "ready"
                    ? "Restart and install Desktop update"
                    : "Download Desktop update"
                }
                onClick={() =>
                  desktopUpdate.phase === "ready"
                    ? setRestartDialog(true)
                    : void desktopUpdate.download()
                }
              >
                {desktopUpdate.phase === "ready" ? <RotateCw /> : <Download />}
              </Button>
            </div>
          ) : null}
        </header>
        <AlertDialog open={restartDialog} onOpenChange={setRestartDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Restart and update Tunnet Desktop?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The update is downloaded. Tunnet Desktop will exit, install it,
                and restart. The background service will keep running.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Later</AlertDialogCancel>
              <AlertDialogAction onClick={() => void desktopUpdate.install()}>
                Restart and install
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Outlet />
          </motion.div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
