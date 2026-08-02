import { useNavigate } from "@tanstack/react-router";
import { getPlan, isBillablePlanId, type PlanId } from "@tunnet/api/billing";
import { Button } from "@tunnet/ui/components/button";
import { type ComponentProps, useState } from "react";
import { UpgradePlanDialog } from "@/components/app/upgrade-plan-dialog";
import { useOrgPlan } from "@/hooks/use-org-plan";
import { useActiveOrganization } from "@/lib/auth-client";

type UpgradeCTAProps = {
  requiredPlan?: string;
  onUpgrade?: () => void;
  label?: string;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  /** Prefer opening the upgrade dialog (default) over navigating to billing. */
  mode?: "dialog" | "navigate";
};

export function UpgradeCTA({
  requiredPlan,
  onUpgrade,
  label,
  className,
  variant = "default",
  size = "default",
  mode = "dialog",
}: UpgradeCTAProps) {
  const navigate = useNavigate();
  const { data: activeOrg } = useActiveOrganization();
  const { data: usage } = useOrgPlan();
  const [open, setOpen] = useState(false);

  const plan = requiredPlan ? getPlan(requiredPlan) : null;
  const buttonLabel =
    label ?? (plan ? `Upgrade to ${plan.name}` : "Upgrade plan");

  const currentPlanId: PlanId = (usage?.planId as PlanId) || "free";
  const initialPlan = isBillablePlanId(requiredPlan ?? "")
    ? (requiredPlan as "personal" | "team" | "business")
    : isBillablePlanId(currentPlanId)
      ? currentPlanId === "personal"
        ? "team"
        : currentPlanId === "team"
          ? "business"
          : "personal"
      : ((requiredPlan === "team" || requiredPlan === "business"
          ? requiredPlan
          : "personal") as "personal" | "team" | "business");

  function handleClick() {
    if (onUpgrade) {
      onUpgrade();
      return;
    }
    if (mode === "navigate" || !activeOrg?.id) {
      void navigate({ to: "/organization" });
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={handleClick}
      >
        {buttonLabel}
      </Button>
      {activeOrg?.id && mode === "dialog" && !onUpgrade ? (
        <UpgradePlanDialog
          open={open}
          onOpenChange={setOpen}
          organizationId={activeOrg.id}
          currentPlanId={currentPlanId}
          subscriptionId={usage?.subscriptionId}
          initialPlan={initialPlan}
        />
      ) : null}
    </>
  );
}
