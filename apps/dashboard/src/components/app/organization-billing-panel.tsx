import {
  getPlan,
  isBillablePlanId,
  type PlanId,
  resourceLimit,
} from "@tunnet/api/billing";
import { Button } from "@tunnet/ui/components/button";
import { Progress } from "@tunnet/ui/components/progress";
import { cn } from "@tunnet/ui/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UpgradePlanDialog } from "@/components/app/upgrade-plan-dialog";
import { useOrgPlan } from "@/hooks/use-org-plan";
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

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function meterPercent(used: number, limit: number | null): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

function UsageMeter({
  label,
  used,
  limit,
  formatValue = (n) => String(n),
  warn,
}: {
  label: string;
  used: number;
  limit: number | null;
  formatValue?: (n: number) => string;
  warn?: boolean;
}) {
  const pct = meterPercent(used, limit);
  const unlimited = limit == null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "text-muted-foreground tabular-nums",
            warn && "text-amber-700 dark:text-amber-400",
          )}
        >
          {formatValue(used)}
          {unlimited ? " · Unlimited" : ` / ${formatValue(limit)}`}
        </span>
      </div>
      {pct != null ? (
        <Progress value={pct} className="gap-0" />
      ) : (
        <div className="bg-muted h-1 w-full rounded-full" />
      )}
    </div>
  );
}

export function OrganizationBillingPanel() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: usage, refetch: refetchUsage } = useOrgPlan();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [billingUnavailable, setBillingUnavailable] = useState(false);

  const active = subscriptions.find(
    (s) => s.status === "active" || s.status === "trialing",
  );
  const planId: PlanId =
    (usage?.planId as PlanId) || (active?.plan as PlanId) || "free";
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
    void refetchUsage();
  }, [orgId, refetchUsage]);

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
          <code className="text-foreground">STRIPE_PRICE_PERSONAL</code>,{" "}
          <code className="text-foreground">STRIPE_PRICE_TEAM</code>, and{" "}
          <code className="text-foreground">STRIPE_PRICE_BUSINESS</code> on the
          management server, then restart it. Until then subscription routes
          return 404.
        </p>
      </div>
    );
  }

  const seatsLimit = usage?.seats ?? plan.limits.maxSeats;
  const resourcesCap =
    usage?.resources ??
    resourceLimit(planId, usage?.seatsQuantity ?? plan.limits.minSeats);
  const trafficWarn = usage?.trafficWarnLevel ?? "ok";

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
                  {plan.pricing === "flat"
                    ? `$${plan.price}/month flat`
                    : plan.pricing === "per_seat"
                      ? `$${plan.price}/seat/month`
                      : plan.pricing === "free"
                        ? "Free forever"
                        : "Custom pricing"}
                  {" · "}
                  {seatsLimit ?? "Unlimited"} seats
                  {" · "}
                  {resourcesCap ?? "Unlimited"} resources
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

      {usage ? (
        <div className="space-y-4 rounded-xl border border-border/80 bg-card px-5 py-5 sm:px-6">
          <div>
            <p className="text-sm font-medium">Usage this period</p>
            <p className="text-muted-foreground text-xs">
              Limits refresh with your plan and seat count.
            </p>
          </div>

          {trafficWarn === "warn" || trafficWarn === "exceeded" ? (
            <div
              className={cn(
                "rounded-lg border px-3 py-2.5 text-sm",
                trafficWarn === "exceeded"
                  ? "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
              )}
            >
              {trafficWarn === "exceeded"
                ? "Managed traffic limit exceeded for this month. Upgrade or wait for the next period."
                : "You have used over 80% of this month’s managed traffic. Consider upgrading soon."}
            </div>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <UsageMeter
              label="Seats"
              used={usage.seatsUsed}
              limit={usage.seats}
              warn={usage.seats != null && usage.seatsUsed >= usage.seats}
            />
            <UsageMeter
              label="Resources"
              used={usage.resourcesUsed}
              limit={usage.resources}
              warn={
                usage.resources != null &&
                usage.resourcesUsed >= usage.resources
              }
            />
            <UsageMeter
              label="Networks"
              used={usage.networksUsed}
              limit={usage.networks}
            />
            <UsageMeter
              label="Public tunnels"
              used={usage.publicTunnelsUsed}
              limit={usage.publicTunnels}
            />
            <div className="sm:col-span-2">
              <UsageMeter
                label="Managed traffic"
                used={usage.trafficBytesUsed}
                limit={usage.trafficBytesLimit}
                formatValue={formatBytes}
                warn={trafficWarn !== "ok"}
              />
            </div>
          </div>
        </div>
      ) : null}

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
            ? planId === "personal"
              ? "team"
              : planId === "team"
                ? "business"
                : "personal"
            : "personal"
        }
      />
    </div>
  );
}
