import { useQueryClient } from "@tanstack/react-query";
import {
  CREATABLE_PLAN_IDS,
  type CreatablePlanId,
  isBillablePlanId,
  PLANS,
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
import { useState } from "react";
import { toast } from "sonner";
import { useFeature } from "@/hooks/use-entitlements";
import { authClient } from "@/lib/auth-client";
import { getDashboardUrl } from "@/lib/env";
import slugify from "@/lib/slugify";

type CreateOrganizationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  showCloseButton?: boolean;
  initialPlan?: CreatablePlanId;
};

const creatablePlans = PLANS.filter((p) =>
  (CREATABLE_PLAN_IDS as readonly string[]).includes(p.id),
);

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
  showCloseButton = true,
  initialPlan = "free",
}: CreateOrganizationDialogProps) {
  const queryClient = useQueryClient();
  const isCloud = useFeature("openSignUp");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<CreatablePlanId>(initialPlan);

  function resetForm() {
    setName("");
    setPlan(initialPlan);
    setLoading(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      const origin =
        typeof window !== "undefined"
          ? window.location.origin
          : getDashboardUrl();
      const { error: upgradeError } = await authClient.subscription.upgrade({
        plan,
        referenceId: data.id,
        customerType: "organization",
        seats: 1,
        successUrl: `${origin}/organization?billing=success`,
        cancelUrl: `${origin}/organization?billing=cancel`,
        disableRedirect: false,
      });
      if (upgradeError) {
        setLoading(false);
        toast.error(
          upgradeError.message ??
            "Organization created, but checkout failed. Open Billing to subscribe.",
        );
        void queryClient.invalidateQueries();
        resetForm();
        onOpenChange(false);
        onCreated?.();
        return;
      }
      return;
    }

    setLoading(false);
    void queryClient.invalidateQueries();
    toast.success("Organization created");
    resetForm();
    onOpenChange(false);
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={showCloseButton}>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Organizations group your networks, machines, and team members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                required
                autoFocus
              />
            </div>
            {isCloud ? (
              <div className="space-y-2">
                <Label>Plan</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {creatablePlans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlan(p.id as CreatablePlanId)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition-colors",
                        plan === p.id
                          ? "border-foreground bg-muted"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {p.price === 0
                          ? "Free forever"
                          : `$${p.price}${p.cadence}`}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  Need Enterprise?{" "}
                  <a
                    href="https://cal.com/tunnet/demo"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Talk to sales
                  </a>
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            {showCloseButton ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
            ) : null}
            <Button type="submit" disabled={loading}>
              {loading
                ? isBillablePlanId(plan)
                  ? "Starting checkout..."
                  : "Creating..."
                : isBillablePlanId(plan)
                  ? "Create & checkout"
                  : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
