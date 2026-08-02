import { useQueryClient } from "@tanstack/react-query";
import {
  CREATABLE_PLAN_IDS,
  type CreatablePlanId,
  isBillablePlanId,
  isPerSeatPlanId,
  minimumSeats,
  PLANS,
  seatCost,
} from "@tunnet/api/billing";
import { Button } from "@tunnet/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tunnet/ui/components/dialog";
import { Input } from "@tunnet/ui/components/input";
import { Label } from "@tunnet/ui/components/label";
import { cn } from "@tunnet/ui/lib/utils";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFeature } from "@/hooks/use-entitlements";
import { authClient } from "@/lib/auth-client";
import { getDashboardUrl } from "@/lib/env";
import slugify from "@/lib/slugify";

type CreateOrganizationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /** When true, dialog cannot be dismissed (first-org onboarding). */
  required?: boolean;
};

type Step = "name" | "plan";

const creatablePlans = PLANS.filter((p) =>
  (CREATABLE_PLAN_IDS as readonly string[]).includes(p.id),
);

function appOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return getDashboardUrl();
}

function checkoutSeatsForPlan(planId: CreatablePlanId): number {
  if (!isBillablePlanId(planId)) return 1;
  if (isPerSeatPlanId(planId)) return minimumSeats(planId);
  return 1;
}

function planPriceDisplay(planId: CreatablePlanId): {
  amount: string;
  cadence: string;
  detail: string;
} {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return { amount: "—", cadence: "", detail: "" };
  if (plan.pricing === "free") {
    return { amount: "$0", cadence: "forever", detail: "No card required" };
  }
  if (plan.pricing === "flat") {
    return {
      amount: `$${plan.price}`,
      cadence: "/month",
      detail: "Flat rate · 1 user",
    };
  }
  if (plan.pricing === "per_seat") {
    const seats = minimumSeats(plan.id);
    const total = seatCost(plan, seats);
    return {
      amount: `$${plan.price}`,
      cadence: "/seat/mo",
      detail: `From $${total}/mo · ${seats}-seat minimum`,
    };
  }
  return { amount: "Custom", cadence: "", detail: plan.cadence };
}

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
  required = false,
}: CreateOrganizationDialogProps) {
  const queryClient = useQueryClient();
  const isCloud = useFeature("openSignUp");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [step, setStep] = useState<Step>("name");

  useEffect(() => {
    if (!open) return;
    setName("");
    setStep("name");
    setLoading(false);
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && (required || loading)) return;
    if (!nextOpen) {
      setName("");
      setStep("name");
      setLoading(false);
    }
    onOpenChange(nextOpen);
  }

  async function createOrganization(plan: CreatablePlanId) {
    const trimmed = name.trim();
    if (!trimmed) return;

    const slug = slugify(trimmed, 48);
    if (!slug) {
      toast.error("Organization name must contain letters or numbers");
      return;
    }

    setLoading(true);
    const { data, error } = await authClient.organization.create({
      name: trimmed,
      slug,
      ...(isCloud ? { metadata: { plan } } : {}),
    });
    if (error || !data) {
      setLoading(false);
      toast.error(error?.message ?? "Failed to create organization");
      return;
    }

    const { error: activeError } = await authClient.organization.setActive({
      organizationId: data.id,
    });
    if (activeError) {
      setLoading(false);
      toast.error(activeError.message ?? "Failed to set active organization");
      return;
    }

    if (isCloud && isBillablePlanId(plan)) {
      const { error: upgradeError } = await authClient.subscription.upgrade({
        plan,
        referenceId: data.id,
        customerType: "organization",
        seats: checkoutSeatsForPlan(plan),
        successUrl: `${appOrigin()}/organization?billing=success`,
        cancelUrl: `${appOrigin()}/organization?billing=cancel`,
        disableRedirect: false,
      });
      if (upgradeError) {
        setLoading(false);
        toast.error(
          upgradeError.message ??
            "Organization created, but checkout failed. Open Billing to subscribe.",
        );
        void queryClient.invalidateQueries();
        setName("");
        setStep("name");
        onOpenChange(false);
        onCreated?.();
        return;
      }
      return;
    }

    setLoading(false);
    void queryClient.invalidateQueries();
    toast.success("Organization created");
    setName("");
    setStep("name");
    onOpenChange(false);
    onCreated?.();
  }

  function goToPlanStep(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!slugify(trimmed, 48)) {
      toast.error("Organization name must contain letters or numbers");
      return;
    }
    if (!isCloud) {
      void createOrganization("free");
      return;
    }
    setStep("plan");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={required || loading}
    >
      <DialogContent
        showCloseButton={!required && !loading}
        className={cn(
          "gap-0 overflow-hidden p-0",
          step === "plan" ? "sm:max-w-5xl" : "sm:max-w-md",
        )}
      >
        {step === "name" ? (
          <form onSubmit={(e) => void goToPlanStep(e)}>
            <div className="relative overflow-hidden border-b border-border/70 bg-muted/40 px-6 py-6 sm:px-7">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.4]"
                style={{
                  backgroundImage:
                    "radial-gradient(ellipse 70% 80% at 0% 0%, color-mix(in oklab, var(--foreground) 10%, transparent), transparent 55%)",
                }}
              />
              <DialogHeader className="relative gap-1.5 text-left">
                <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
                  {required ? "Welcome" : "New organization"}
                </p>
                <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
                  Name your organization
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed">
                  Organizations group networks, machines, and people under one
                  workspace.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="space-y-4 px-6 py-5 sm:px-7">
              <div className="space-y-2">
                <Label htmlFor="org-name">Organization name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Corp"
                  required
                  autoFocus
                  disabled={loading}
                />
              </div>
            </div>

            <DialogFooter className="border-t border-border/70 bg-muted/20 px-6 py-4 sm:px-7">
              {!required ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading}
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={loading || !name.trim()}
                className="min-w-28"
              >
                {loading
                  ? "Creating..."
                  : isCloud
                    ? "Continue"
                    : "Create organization"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div>
            <div className="relative overflow-hidden border-b border-border/70 bg-muted/40 px-6 py-6 sm:px-8">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.35]"
                style={{
                  backgroundImage:
                    "radial-gradient(ellipse 80% 60% at 10% 0%, color-mix(in oklab, var(--foreground) 12%, transparent), transparent 55%), radial-gradient(ellipse 50% 40% at 95% 100%, color-mix(in oklab, var(--foreground) 8%, transparent), transparent 50%)",
                }}
              />
              <DialogHeader className="relative gap-2 text-left">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-8 gap-1.5 px-2"
                    disabled={loading}
                    onClick={() => setStep("name")}
                  >
                    <ArrowLeftIcon className="size-3.5" />
                    Back
                  </Button>
                  <span className="text-muted-foreground hidden text-sm sm:inline">
                    {name.trim()}
                  </span>
                </div>
                <DialogTitle className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                  Choose a plan
                </DialogTitle>
                <DialogDescription className="max-w-2xl text-sm leading-relaxed">
                  Free creates the org right away. Paid plans open Stripe
                  checkout with a 14-day trial.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="grid gap-3 p-5 sm:grid-cols-2 sm:gap-4 sm:p-6 lg:grid-cols-4">
              {creatablePlans.map((plan) => {
                const price = planPriceDisplay(plan.id as CreatablePlanId);
                const paid = isBillablePlanId(plan.id);
                return (
                  <button
                    key={plan.id}
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void createOrganization(plan.id as CreatablePlanId)
                    }
                    className={cn(
                      "group relative flex flex-col rounded-xl border p-5 text-left transition-[border-color,box-shadow,background-color,transform] duration-150",
                      "border-border/80 bg-card/60 hover:border-foreground/35 hover:bg-card hover:shadow-[0_12px_40px_-28px_color-mix(in_oklab,var(--foreground)_35%,transparent)]",
                      "disabled:pointer-events-none disabled:opacity-60",
                      plan.highlight &&
                        "border-foreground/25 bg-card shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]",
                    )}
                  >
                    {plan.highlight ? (
                      <span className="bg-foreground text-background absolute top-3 right-3 rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                        Popular
                      </span>
                    ) : null}

                    <span className="text-lg font-semibold tracking-tight">
                      {plan.name}
                    </span>

                    <div className="mt-3 flex items-end gap-1">
                      <span className="text-3xl font-semibold tracking-tight tabular-nums">
                        {price.amount}
                      </span>
                      {price.cadence ? (
                        <span className="text-muted-foreground mb-1 text-sm">
                          {price.cadence}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {price.detail}
                    </p>
                    <p className="text-muted-foreground mt-3 text-sm leading-snug">
                      {plan.pitch}
                    </p>

                    <ul className="mt-5 flex-1 space-y-2.5">
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

                    <span
                      className={cn(
                        "mt-6 inline-flex h-9 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                        paid
                          ? "bg-foreground text-background group-hover:opacity-90"
                          : "bg-muted text-foreground group-hover:bg-muted/80",
                      )}
                    >
                      {loading
                        ? paid
                          ? "Starting checkout…"
                          : "Creating…"
                        : paid
                          ? plan.cta
                          : "Create free org"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-border/70 px-5 py-4 sm:px-6">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Need Enterprise?{" "}
                <a
                  href="https://cal.com/tunnet/demo"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  Talk to sales
                </a>
                . You can change plans later from Billing.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
