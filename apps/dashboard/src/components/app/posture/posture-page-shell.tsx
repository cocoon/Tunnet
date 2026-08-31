import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@tunnet/ui/components/tabs";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/app/page-header";

const TABS = [
  {
    value: "definitions",
    label: "Definitions",
    to: "/posture" as const,
  },
  {
    value: "compliance",
    label: "Compliance",
    to: "/posture/compliance" as const,
  },
  {
    value: "integrations",
    label: "Integrations",
    to: "/posture/integrations" as const,
  },
] as const;

type PostureTab = (typeof TABS)[number]["value"];

function tabFromPath(pathname: string): PostureTab {
  if (pathname.includes("/posture/compliance")) return "compliance";
  if (pathname.includes("/posture/integrations")) return "integrations";
  return "definitions";
}

export function PosturePageShell({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const tab = tabFromPath(pathname);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Posture"
        description="Define device compliance rules, monitor fleet status, and connect external security platforms."
        actions={actions}
        dense
      />

      <Tabs value={tab} variant="underline" className="flex flex-col gap-6">
        <div className="border-b border-border/70">
          <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0">
            {TABS.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="rounded-none px-3"
                onClick={() => void navigate({ to: item.to })}
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {children}
      </Tabs>
    </div>
  );
}
