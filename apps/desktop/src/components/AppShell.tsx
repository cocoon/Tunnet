import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  LayoutDashboard,
  Server,
  Settings,
  Share2,
  Shield,
  Terminal,
} from "lucide-react";
import { motion } from "motion/react";
import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useApp } from "@/lib/app-context";
import { useDirectNetwork } from "@/lib/direct-network-context";
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
  { to: "/app/diagnostics", label: "Diagnostics", icon: Activity },
  { to: "/app/settings", label: "Settings", icon: Settings },
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

  const network = activeNetworkForMode(node, activeNetwork);
  const isDirect = meta?.mode === "direct" || node?.mode === "direct";
  const visibleNav = navItems.filter((item) => !item.directOnly || isDirect);
  const connected = node?.data_plane_up ?? false;

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-border">
        <SidebarHeader className="border-b border-border py-3">
          <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
              T
            </div>
            <span className="font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              Tunnet
            </span>
          </div>
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
                        isActive={active}
                        tooltip={item.label}
                        render={<Link to={item.to} />}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {item.badge ? (
                        <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {isDirect && networks.length > 1 ? (
          <SidebarFooter className="border-t border-border p-2">
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
          </SidebarFooter>
        ) : null}
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="flex max-h-svh flex-col overflow-hidden">
        <header className="z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm supports-backdrop-filter:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {network?.network_name || "Tunnet"}
            </span>
            <Badge variant="secondary" className="capitalize">
              {modeLabel(meta?.mode ?? node?.mode)}
            </Badge>
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
        </header>
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
