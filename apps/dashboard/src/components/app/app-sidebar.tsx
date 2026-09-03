import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@tunnet/ui/components/sidebar";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import {
  HiOutlineArrowsRightLeft,
  HiOutlineBolt,
  HiOutlineChartBarSquare,
  HiOutlineClipboardDocumentList,
  HiOutlineCog6Tooth,
  HiOutlineCommandLine,
  HiOutlineCpuChip,
  HiOutlineCube,
  HiOutlineGlobeAlt,
  HiOutlineKey,
  HiOutlineLockClosed,
  HiOutlineServer,
  HiOutlineServerStack,
  HiOutlineShare,
  HiOutlineShieldCheck,
  HiOutlineSignal,
  HiOutlineTag,
  HiOutlineUsers,
} from "react-icons/hi2";
import { SiKubernetes } from "react-icons/si";
import { UserMenu } from "@/components/app/user-menu";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServes, useTunnels } from "@/lib/queries/management";

type NavIcon = ComponentType<{ className?: string }>;

type NavItem = {
  to: string;
  label: string;
  icon: NavIcon;
  exact?: boolean;
  badge?: "tunnels" | "serves";
};

type NavSection = {
  id: string;
  label: string;
  icon: NavIcon;
  items: NavItem[];
  defaultOpen?: boolean;
};

const overviewItem: NavItem = {
  to: "/",
  label: "Overview",
  icon: HiOutlineChartBarSquare,
  exact: true,
};

const navSections: NavSection[] = [
  {
    id: "mesh",
    label: "Mesh",
    icon: HiOutlineGlobeAlt,
    defaultOpen: true,
    items: [
      { to: "/networks", label: "Networks", icon: HiOutlineShare },
      { to: "/kubernetes", label: "Kubernetes", icon: SiKubernetes },
    ],
  },
  {
    id: "fleet",
    label: "Fleet",
    icon: HiOutlineCpuChip,
    defaultOpen: true,
    items: [
      { to: "/machines", label: "Machines", icon: HiOutlineServer },
      { to: "/edges", label: "Edges", icon: HiOutlineServerStack },
      { to: "/relays", label: "Relays", icon: HiOutlineSignal },
    ],
  },
  {
    id: "connectivity",
    label: "Connectivity",
    icon: HiOutlineBolt,
    defaultOpen: true,
    items: [
      {
        to: "/tunnels",
        label: "Tunnels",
        icon: HiOutlineBolt,
        badge: "tunnels",
      },
      {
        to: "/serves",
        label: "Serves",
        icon: HiOutlineCube,
        badge: "serves",
      },
      {
        to: "/ssh-sessions",
        label: "SSH",
        icon: HiOutlineCommandLine,
      },
      {
        to: "/transfers",
        label: "Transfers",
        icon: HiOutlineArrowsRightLeft,
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    icon: HiOutlineShieldCheck,
    defaultOpen: false,
    items: [
      { to: "/posture", label: "Posture", icon: HiOutlineShieldCheck },
      { to: "/access", label: "Access", icon: HiOutlineLockClosed },
      { to: "/tags", label: "Tags", icon: HiOutlineTag },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    icon: HiOutlineCog6Tooth,
    defaultOpen: false,
    items: [
      { to: "/users", label: "Users", icon: HiOutlineUsers },
      { to: "/roles", label: "Roles", icon: HiOutlineKey },
      {
        to: "/logs",
        label: "Logs",
        icon: HiOutlineClipboardDocumentList,
      },
      {
        to: "/organization",
        label: "Organization",
        icon: HiOutlineCog6Tooth,
      },
    ],
  },
];

function isNavActive(pathname: string, to: string, exact?: boolean): boolean {
  if (exact) {
    if (to === "/") return pathname === "/" || pathname === "/";
    return pathname === to;
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

function sectionContainsActive(pathname: string, section: NavSection): boolean {
  return section.items.some((item) =>
    isNavActive(pathname, item.to, item.exact),
  );
}

function CollapsibleNavSection({
  section,
  pathname,
  badgeFor,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  badgeFor: (item: NavItem) => number;
  onNavigate: (to: string) => void;
}) {
  const hasActive = sectionContainsActive(pathname, section);
  const [open, setOpen] = useState(section.defaultOpen || hasActive);
  const { state, isMobile } = useSidebar();
  const collapsedRail = !isMobile && state === "collapsed";

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  const SectionIcon = section.icon;

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            icon={<SectionIcon className="size-4" />}
            ariaExpanded={open}
            onSelect={() => {
              if (collapsedRail) setOpen(true);
              else setOpen((value) => !value);
            }}
          >
            {section.label}
          </SidebarMenuButton>
          <SidebarMenuSub open={open}>
            {section.items.map((item) => {
              const Icon = item.icon;
              const count = badgeFor(item);
              return (
                <SidebarMenuSubItem key={item.to}>
                  <SidebarMenuSubButton
                    icon={<Icon className="size-4" />}
                    isActive={isNavActive(pathname, item.to, item.exact)}
                    badge={count > 0 ? count : undefined}
                    onSelect={() => onNavigate(item.to)}
                  >
                    {item.label}
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: tunnels } = useTunnels(orgId);
  const { data: serves } = useServes(orgId);

  const activeTunnelCount = useMemo(
    () => (tunnels ?? []).filter((t) => t.status === "active").length,
    [tunnels],
  );
  const activeServeCount = useMemo(
    () => (serves ?? []).filter((s) => s.status === "active").length,
    [serves],
  );

  function badgeFor(item: NavItem): number {
    if (item.badge === "tunnels") return activeTunnelCount;
    if (item.badge === "serves") return activeServeCount;
    return 0;
  }

  function handleNavigate(to: string) {
    void navigate({ to });
  }

  const OverviewIcon = overviewItem.icon;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          to="/"
          className="flex items-center gap-2.5 overflow-hidden rounded-lg py-1 transition-colors group-data-[state=collapsed]/sidebar:justify-center"
        >
          <img
            src="/logo.png"
            alt="Tunnet"
            className="size-7 shrink-0 rounded-md"
          />
          <p className="truncate text-sm font-semibold tracking-tight group-data-[state=collapsed]/sidebar:hidden">
            Tunnet
          </p>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  icon={<OverviewIcon className="size-4" />}
                  isActive={isNavActive(
                    pathname,
                    overviewItem.to,
                    overviewItem.exact,
                  )}
                  onSelect={() => handleNavigate(overviewItem.to)}
                >
                  {overviewItem.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {navSections.map((section) => (
          <CollapsibleNavSection
            key={section.id}
            section={section}
            pathname={pathname}
            badgeFor={badgeFor}
            onNavigate={handleNavigate}
          />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
