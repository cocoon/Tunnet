import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { CreateOrganizationDialog } from "@/components/app/create-organization-dialog";

export const Route = createFileRoute("/_app/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();

  return (
    <div className="bg-background min-h-screen">
      <CreateOrganizationDialog
        open
        onOpenChange={() => {}}
        showCloseButton={false}
        onCreated={() => {
          void navigate({ to: "/" });
        }}
      />
    </div>
  );
}
