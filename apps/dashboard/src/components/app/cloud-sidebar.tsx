import { Link, useRouterState } from "@tanstack/react-router";
import { Badge } from "@tunnet/ui/components/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@tunnet/ui/components/sidebar";
import { cn } from "@tunnet/ui/lib/utils";
import type { ComponentType } from "react";
import {
  HiOutlineChartBarSquare,
  HiOutlineCloud,
  HiOutlineCube,
  HiOutlineServerStack,
} from "react-icons/hi2";
import { UserMenu } from "@/components/app/user-menu";

type NavIcon = ComponentType<{ className?: string }>;

type CloudNavItem = {
  to: string;
  label: string;
  icon: NavIcon;
  exact?: boolean;
  disabled?: boolean;
};

const cloudNav: CloudNavItem[] = [
  {
    to: "/cloud",
    label: "Overview",
    icon: HiOutlineChartBarSquare,
    exact: true,
  },
  {
    to: "/cloud/relays",
    label: "Relays",
    icon: HiOutlineServerStack,
  },
  {
    to: "/cloud/edges",
    label: "Edges",
    icon: HiOutlineCube,
    disabled: true,
  },
  {
    to: "/cloud/infrastructure",
    label: "Infrastructure",
    icon: HiOutlineCloud,
    disabled: true,
  },
];

function isActive(pathname: string, to: string, exact?: boolean): boolean {
  if (exact) {
    return pathname === to || pathname === `${to}/`;
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function CloudSidebar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-2 border-b border-sidebar-border py-3">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <img src="/logo.png" alt="Tunnet Cloud" className="size-8" />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">Tunnet Cloud</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {cloudNav.map((item) => {
                const Icon = item.icon;
                const active =
                  !item.disabled && isActive(pathname, item.to, item.exact);
                if (item.disabled) {
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        disabled
                        className="opacity-50"
                        tooltip={`${item.label} (coming soon)`}
                      >
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                        <span className="text-muted-foreground ml-auto text-[10px] group-data-[collapsible=icon]:hidden">
                          Soon
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      render={
                        <Link
                          to={item.to}
                          className={cn(active && "font-medium")}
                        />
                      }
                    >
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to organization"
              render={<Link to="/" />}
            >
              <span className="text-muted-foreground text-xs">
                ← Organization dashboard
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
