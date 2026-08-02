import { useGSAP } from "@gsap/react";
import { cn } from "@tunnet/ui/lib/utils";
import { ArrowRightIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { PLANS, type Plan } from "#/lib/pricing";

const APP_URL = "https://app.tunnet.io";

function PlanCard({ plan }: { plan: Plan }): ReactNode {
  const enterprise = plan.price === null;
  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-[var(--l1-r-lg)] p-8",
        plan.highlight
          ? "border border-[oklch(0.75_0.115_58/0.4)] bg-gradient-to-b from-[var(--l1-copper-soft)]/60 to-[var(--l1-panel)]/40 shadow-[0_30px_70px_-40px_oklch(0.6_0.115_50/0.4)]"
          : "border border-[var(--l1-steel)] bg-[var(--l1-panel)]/30",
      )}
    >
      {plan.highlight ? (
        <span className="absolute right-6 top-6 rounded-full border border-[oklch(0.75_0.115_58/0.4)] bg-[var(--l1-copper-soft)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--l1-copper)]">
          Popular
        </span>
      ) : null}

      <span className="l1-label text-[var(--l1-muted)]">{plan.name}</span>

      <p className="mt-5 flex items-baseline gap-2">
        <span className="l1-readout text-[3rem] font-semibold l1-engraved text-[var(--l1-fg)]">
          {enterprise ? "Custom" : `$${plan.price}`}
        </span>
        {!enterprise ? (
          <span className="l1-label !text-[10px] text-[var(--l1-muted-2)]">
            {plan.cadence}
          </span>
        ) : null}
      </p>

      <p className="mt-3 text-[14px] text-[var(--l1-muted)]">{plan.pitch}</p>

      <div className="p-hairline my-6" />

      <ul className="flex-1 space-y-3.5">
        {plan.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-3 text-[14px] leading-snug text-[var(--l1-fg-dim)]"
          >
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--l1-copper)]/80" />
            {f}
          </li>
        ))}
      </ul>

      {enterprise ? (
        <a
          href="https://cal.com/tunnet/demo"
          target="_blank"
          rel="noreferrer"
          className="l1-btn l1-btn--steel mt-8 w-full"
        >
          {plan.cta}
          <ArrowRightIcon className="size-4" />
        </a>
      ) : (
        <a
          href={APP_URL}
          className={cn(
            "l1-btn mt-8 w-full",
            plan.highlight ? "l1-btn--copper" : "l1-btn--steel",
          )}
        >
          {plan.cta}
          <ArrowRightIcon className="size-4" />
        </a>
      )}
    </div>
  );
}

export function PlanCards(): ReactNode {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      registerMarketingMotion();
      if (root.current) setupReveals(root.current);
    },
    { scope: root },
  );

  return (
    <section id="plans" className="relative px-5 sm:px-8">
      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>
      </div>
    </section>
  );
}
