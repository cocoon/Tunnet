import { cn } from "@tunnet/ui/lib/utils";
import type { ReactNode } from "react";
import { UpgradeCTA } from "@/components/app/plan/upgrade-cta";

type PlanGateProps = {
  locked: boolean;
  title: string;
  description: string;
  requiredPlan?: string;
  onUpgrade?: () => void;
  upgradeLabel?: string;
  children?: ReactNode;
  className?: string;
  /** When false, children stay interactive (banner only). Default true. */
  inert?: boolean;
};

export function PlanGate({
  locked,
  title,
  description,
  requiredPlan,
  onUpgrade,
  upgradeLabel,
  children,
  className,
  inert = true,
}: PlanGateProps) {
  if (!locked) return <>{children}</>;

  return (
    <div className={cn("relative", className)}>
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium tracking-tight">{title}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        </div>
        <UpgradeCTA
          requiredPlan={requiredPlan}
          onUpgrade={onUpgrade}
          label={upgradeLabel}
          className="shrink-0"
        />
      </div>
      {children != null ? (
        <div
          aria-hidden={inert || undefined}
          className={cn(inert && "pointer-events-none select-none opacity-45")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
