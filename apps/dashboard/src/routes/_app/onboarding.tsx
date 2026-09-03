import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { CreateOrganizationDialog } from "@/components/app/create-organization-dialog";
import { useListOrganizations } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const { data: organizationsRaw, isPending } = useListOrganizations();
  const organizations = (
    Array.isArray(organizationsRaw) ? organizationsRaw : []
  ).filter((org) => !(org as { deletedAt?: string | Date | null }).deletedAt);

  useEffect(() => {
    if (isPending) return;
    if (organizations.length > 0) {
      void navigate({ to: "/", replace: true });
    }
  }, [isPending, navigate, organizations.length]);

  if (!isPending && organizations.length > 0) {
    return <main className="bg-background min-h-svh" aria-busy="true" />;
  }

  return (
    <div className="bg-background relative min-h-svh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in oklab, var(--foreground) 8%, transparent), transparent 60%), radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--foreground) 12%, transparent) 1px, transparent 0)",
          backgroundSize: "auto, 18px 18px",
        }}
      />
      <CreateOrganizationDialog
        open
        required
        onOpenChange={() => {}}
        onCreated={() => {
          void navigate({ to: "/", replace: true });
        }}
      />
    </div>
  );
}
