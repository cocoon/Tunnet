import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
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
  const navigate = useNavigate();

  function handleNavigate(to: string) {
    void navigate({ to });
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          to="/cloud"
          className="flex items-center gap-2 overflow-hidden group-data-[state=collapsed]/sidebar:justify-center"
        >
          <img src="/logo.png" alt="Tunnet Cloud" className="size-8 shrink-0" />
          <div className="min-w-0 flex-1 group-data-[state=collapsed]/sidebar:hidden">
            <p className="truncate text-sm font-semibold">Tunnet Cloud</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {cloudNav.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      icon={<Icon className="size-4" />}
                      isActive={
                        !item.disabled &&
                        isActive(pathname, item.to, item.exact)
                      }
                      disabled={item.disabled}
                      badge={item.disabled ? "Soon" : undefined}
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onSelect={() => handleNavigate("/")}>
              ← Organization dashboard
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
