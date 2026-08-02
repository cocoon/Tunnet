import { getPlan, isBillablePlanId, type PlanId } from "@tunnet/api/billing";
import { Button } from "@tunnet/ui/components/button";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UpgradePlanDialog } from "@/components/app/upgrade-plan-dialog";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import { getDashboardUrl } from "@/lib/env";

type SubscriptionRow = {
  id: string;
  plan: string;
  status: string;
  seats?: number | null;
  periodEnd?: string | Date | null;
  cancelAtPeriodEnd?: boolean | null;
  stripeSubscriptionId?: string | null;
};

function appOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return getDashboardUrl();
}

export function OrganizationBillingPanel() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [billingUnavailable, setBillingUnavailable] = useState(false);

  const active = subscriptions.find(
    (s) => s.status === "active" || s.status === "trialing",
  );
  const planId: PlanId = (active?.plan as PlanId) || "free";
  const plan = getPlan(planId) ?? getPlan("free");

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await authClient.subscription.list({
      query: {
        referenceId: orgId,
        customerType: "organization",
      },
    });
    setLoading(false);
    if (error) {
      const message = error.message ?? "";
      const status =
        typeof error === "object" && error && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;
      if (status === 404 || /not found/i.test(message) || /404/.test(message)) {
        setBillingUnavailable(true);
        setSubscriptions([]);
        return;
      }
      toast.error(message || "Failed to load billing");
      return;
    }
    setBillingUnavailable(false);
    setSubscriptions((data ?? []) as SubscriptionRow[]);
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openPortal() {
    if (!orgId) return;
    setBusy(true);
    const { error } = await authClient.subscription.billingPortal({
      referenceId: orgId,
      customerType: "organization",
      returnUrl: `${appOrigin()}/organization`,
      disableRedirect: false,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Could not open billing portal");
    }
  }

  async function cancel() {
    if (!orgId || !active?.stripeSubscriptionId) return;
    setBusy(true);
    const { error } = await authClient.subscription.cancel({
      referenceId: orgId,
      customerType: "organization",
      subscriptionId: active.stripeSubscriptionId,
      returnUrl: `${appOrigin()}/organization`,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Cancel failed");
    }
  }

  async function restore() {
    if (!orgId || !active?.stripeSubscriptionId) return;
    setBusy(true);
    const { error } = await authClient.subscription.restore({
      referenceId: orgId,
      customerType: "organization",
      subscriptionId: active.stripeSubscriptionId,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Restore failed");
      return;
    }
    toast.success("Subscription restored");
    void refresh();
  }

  if (!orgId || !plan) return null;

  if (billingUnavailable) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-5 py-6">
        <p className="text-sm font-medium">Stripe billing is not configured</p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Set <code className="text-foreground">STRIPE_SECRET_KEY</code>,{" "}
          <code className="text-foreground">STRIPE_WEBHOOK_SECRET</code>,{" "}
          <code className="text-foreground">STRIPE_PRICE_TEAM</code>, and{" "}
          <code className="text-foreground">STRIPE_PRICE_BUSINESS</code> on the
          management server, then restart it. Until then subscription routes
          return 404.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-medium tracking-[0.12em] uppercase">
              Current plan
            </p>
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : (
              <>
                <p className="text-2xl font-semibold tracking-tight">
                  {plan.name}
                </p>
                <p className="text-muted-foreground text-sm">
                  {active
                    ? `${active.status}${active.cancelAtPeriodEnd ? " · cancels at period end" : ""}`
                    : "Free limits · upgrade when you need more seats or resources"}
                </p>
                {active?.periodEnd ? (
                  <p className="text-muted-foreground text-xs">
                    Period ends{" "}
                    {new Date(active.periodEnd).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {plan.seats ?? "—"} seats included
                  {plan.extraSeat != null
                    ? ` · $${plan.extraSeat}/extra seat`
                    : null}
                  {" · "}
                  {plan.resources ?? "—"} resources
                </p>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={loading || busy}
              onClick={() => setUpgradeOpen(true)}
            >
              {isBillablePlanId(planId) ? "Change plan" : "Upgrade plan"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !active}
              onClick={() => void openPortal()}
            >
              Invoices & payment methods
            </Button>
          </div>
        </div>
      </div>

      {active ? (
        <div className="flex flex-wrap gap-2">
          {active.cancelAtPeriodEnd ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void restore()}
            >
              Restore subscription
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel subscription
            </Button>
          )}
        </div>
      ) : null}

      <UpgradePlanDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        organizationId={orgId}
        currentPlanId={planId}
        subscriptionId={active?.stripeSubscriptionId}
        initialPlan={
          isBillablePlanId(planId)
            ? planId === "team"
              ? "business"
              : "team"
            : "team"
        }
      />
    </div>
  );
}
