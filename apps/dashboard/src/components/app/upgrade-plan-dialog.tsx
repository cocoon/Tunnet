import {
  BILLABLE_PLAN_IDS,
  type BillablePlanId,
  getPlan,
  isPerSeatPlanId,
  minimumSeats,
  PLANS,
  type PlanId,
  seatCost,
} from "@tunnet/api/billing";
import { ActionSwapCascadeButton } from "@tunnet/ui/components/action-swap-cascade";
import { Button } from "@tunnet/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@tunnet/ui/components/dialog";
import { cn } from "@tunnet/ui/lib/utils";
import { CheckIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { getDashboardUrl } from "@/lib/env";

type UpgradePlanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  currentPlanId: PlanId;
  subscriptionId?: string | null;
  /** Prefill when opening from a specific CTA */
  initialPlan?: BillablePlanId;
};

const billablePlans = PLANS.filter((p) =>
  (BILLABLE_PLAN_IDS as readonly string[]).includes(p.id),
);

function appOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return getDashboardUrl();
}

function checkoutSeats(planId: BillablePlanId, seats: number): number {
  if (!isPerSeatPlanId(planId)) return 1;
  return Math.max(seats, minimumSeats(planId));
}

export function UpgradePlanDialog({
  open,
  onOpenChange,
  organizationId,
  currentPlanId,
  subscriptionId,
  initialPlan = "personal",
}: UpgradePlanDialogProps) {
  const [selected, setSelected] = useState<BillablePlanId>(initialPlan);
  const [seats, setSeats] = useState(() =>
    checkoutSeats(initialPlan, minimumSeats(initialPlan)),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(initialPlan);
    setSeats(checkoutSeats(initialPlan, minimumSeats(initialPlan)));
  }, [open, initialPlan]);

  const selectedPlan = getPlan(selected);
  if (!selectedPlan) return null;
  const perSeat = isPerSeatPlanId(selected);
  const minSeats = minimumSeats(selected);
  const monthly = seatCost(selectedPlan, checkoutSeats(selected, seats));

  function selectPlan(id: BillablePlanId) {
    setSelected(id);
    setSeats(checkoutSeats(id, minimumSeats(id)));
  }

  async function startCheckout() {
    if (selected === currentPlanId && subscriptionId) {
      toast.message("You are already on this plan");
      return;
    }
    setBusy(true);
    const { error } = await authClient.subscription.upgrade({
      plan: selected,
      referenceId: organizationId,
      customerType: "organization",
      seats: checkoutSeats(selected, seats),
      subscriptionId: subscriptionId ?? undefined,
      successUrl: `${appOrigin()}/organization?billing=success`,
      cancelUrl: `${appOrigin()}/organization?billing=cancel`,
      returnUrl: `${appOrigin()}/organization`,
      disableRedirect: false,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Could not start checkout");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={!busy}
      >
        <div className="relative overflow-hidden border-b border-border/70 bg-muted/40 px-6 py-7 sm:px-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 80% 60% at 10% 0%, color-mix(in oklab, var(--foreground) 12%, transparent), transparent 55%), radial-gradient(ellipse 50% 40% at 90% 100%, color-mix(in oklab, var(--foreground) 8%, transparent), transparent 50%)",
            }}
          />
          <DialogHeader className="relative gap-2 text-left">
            <DialogTitle className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
              Scale the mesh with a plan that fits
            </DialogTitle>
            <DialogDescription className="max-w-xl text-sm leading-relaxed">
              14-day trial on Personal, Team, and Business. Limits unlock
              immediately
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-3 sm:gap-4 sm:p-6">
          {billablePlans.map((plan) => {
            const isSelected = selected === plan.id;
            const isCurrent = currentPlanId === plan.id;
            const planSeats = isPerSeatPlanId(plan.id)
              ? isSelected
                ? checkoutSeats(plan.id, seats)
                : minimumSeats(plan.id)
              : 1;
            const price = seatCost(plan, planSeats);

            return (
              <button
                key={plan.id}
                type="button"
                disabled={busy}
                onClick={() => selectPlan(plan.id as BillablePlanId)}
                className={cn(
                  "relative flex flex-col rounded-xl border p-5 text-left transition-[border-color,box-shadow,background-color] duration-150",
                  isSelected
                    ? "border-foreground bg-card shadow-[0_0_0_1px_var(--foreground)]"
                    : "border-border/80 bg-card/60 hover:border-foreground/30 hover:bg-card",
                )}
              >
                {plan.highlight ? (
                  <span className="bg-foreground text-background absolute top-3 right-3 rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                    Popular
                  </span>
                ) : null}
                <div className="flex items-baseline gap-1.5 pr-16">
                  <span className="text-lg font-semibold tracking-tight">
                    {plan.name}
                  </span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">
                      · current
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">
                    ${price ?? plan.price}
                  </span>
                  <span className="text-muted-foreground mb-1 text-sm">
                    /month
                  </span>
                </div>
                {isPerSeatPlanId(plan.id) && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    ${plan.price}/seat · {minimumSeats(plan.id)} seat minimum
                  </p>
                )}
                <p className="text-muted-foreground mt-2 text-sm leading-snug">
                  {plan.pitch}
                </p>
                <ul className="mt-5 space-y-2.5">
                  {plan.featureBullets.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm leading-snug"
                    >
                      <CheckIcon className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {perSeat ? (
          <div className="flex flex-col gap-3 border-t border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="text-sm font-medium">Seats</p>
              <p className="text-muted-foreground text-xs">
                Minimum {minSeats} for {selectedPlan.name}. Total{" "}
                <span className="text-foreground font-medium tabular-nums">
                  ${monthly ?? "-"}/month
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={busy || seats <= minSeats}
                onClick={() => setSeats((s) => Math.max(minSeats, s - 1))}
                aria-label="Decrease seats"
              >
                <MinusIcon className="size-4" />
              </Button>
              <span className="min-w-10 text-center text-sm font-medium tabular-nums">
                {checkoutSeats(selected, seats)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={busy}
                onClick={() => setSeats((s) => s + 1)}
                aria-label="Increase seats"
              >
                <PlusIcon className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-border/70 bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-muted-foreground text-xs leading-relaxed sm:max-w-sm">
            Cancel anytime from the billing portal
          </p>
          <div className="flex shrink-0 gap-2">
            <ActionSwapCascadeButton
              type="button"
              variant="primary"
              size="sm"
              cycle={false}
              value={busy ? "busy" : "ready"}
              items={[
                {
                  id: "ready",
                  label:
                    currentPlanId === selected
                      ? "Manage in Stripe"
                      : `Start ${selectedPlan.name} trial`,
                },
                { id: "busy", label: "Redirecting…" },
              ]}
              disabled={busy}
              onClick={() => void startCheckout()}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
