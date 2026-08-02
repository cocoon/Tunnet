import { getPlan, type PlanId } from "@tunnet/api/billing";
import { Button } from "@tunnet/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tunnet/ui/components/dialog";
import confetti from "canvas-confetti";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authClient, useActiveOrganization } from "@/lib/auth-client";

type SubscriptionSuccessDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function fireConfetti() {
  const end = Date.now() + 1800;
  const colors = ["#c98a3b", "#e8c48a", "#f4f0e8", "#2f6fed", "#1a1a1a"];

  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors,
      disableForReducedMotion: true,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };

  confetti({
    particleCount: 90,
    spread: 70,
    origin: { y: 0.55 },
    colors,
    disableForReducedMotion: true,
  });
  frame();
}

export function SubscriptionSuccessDialog({
  open,
  onOpenChange,
}: SubscriptionSuccessDialogProps) {
  const { data: activeOrg } = useActiveOrganization();
  const fired = useRef(false);
  const [planId, setPlanId] = useState<PlanId>("team");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !activeOrg?.id) return;
    let cancelled = false;
    void (async () => {
      const { data } = await authClient.subscription.list({
        query: {
          referenceId: activeOrg.id,
          customerType: "organization",
        },
      });
      if (cancelled) return;
      const active = (data ?? []).find(
        (s: { status?: string; plan?: string }) =>
          s.status === "active" || s.status === "trialing",
      );
      if (active?.plan && getPlan(active.plan)) {
        setPlanId(active.plan as PlanId);
      }
      setStatus(active?.status ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeOrg?.id]);

  useEffect(() => {
    if (!open) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    fired.current = true;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) fireConfetti();
  }, [open]);

  const plan = getPlan(planId) ?? getPlan("team");
  if (!plan) return null;
  const trial = status === "trialing";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton
      >
        <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-amber-500/15 via-background to-sky-500/10 px-6 pt-8 pb-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-amber-400/20 blur-3xl"
          />
          <div className="relative flex items-start gap-3">
            <DialogHeader className="gap-1.5 text-left">
              <DialogTitle className="text-2xl tracking-tight">
                You&apos;re on {plan.name}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {trial
                  ? `Thanks for starting your ${plan.trialDays ?? 14}-day trial`
                  : "Thanks for upgrading"}
                {activeOrg?.name ? ` · ${activeOrg.name}` : ""}. Your mesh just
                leveled up.
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="flex flex-wrap items-end gap-2">
            <p className="text-3xl font-semibold tracking-tight">
              {plan.price == null ? "Custom" : `$${plan.price}`}
            </p>
            {plan.price != null ? (
              <p className="pb-1 text-sm text-muted-foreground">
                {plan.cadence}
                {trial ? " after trial" : ""}
              </p>
            ) : null}
          </div>

          <ul className="grid gap-2.5">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <CheckIcon className="size-3" strokeWidth={3} />
                </span>
                <span className="text-foreground/90">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="border-t border-border/60 bg-muted/30 px-6 py-4 sm:justify-end">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Start building
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
