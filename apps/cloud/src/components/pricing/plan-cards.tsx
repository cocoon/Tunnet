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

const CORE_PLANS = PLANS.filter((p) => p.id !== "enterprise");
const ENTERPRISE = PLANS.find((p) => p.id === "enterprise");

function priceLabel(plan: Plan): string {
  if (plan.pricing === "custom" || plan.price === null) return "Custom";
  if (plan.pricing === "free") return "$0";
  return `$${plan.price}`;
}

function cadenceLabel(plan: Plan): string | null {
  if (plan.pricing === "custom") return null;
  if (plan.pricing === "free") return "forever";
  return plan.cadence;
}

function priceDetail(plan: Plan): string | null {
  if (plan.pricing === "flat") return "Flat · 1 user";
  if (plan.pricing === "per_seat") {
    return `Per seat · ${plan.limits.minSeats ?? 2}+ users`;
  }
  if (plan.pricing === "free") return "No card required";
  return null;
}

function PlanCard({ plan }: { plan: Plan }): ReactNode {
  const bullets = plan.featureBullets.slice(0, 4);

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-[var(--l1-r-lg)] p-7 sm:p-8",
        "border bg-[var(--l1-panel)]/40 shadow-[var(--l1-shadow-panel)]",
        "transition-[border-color,background-color,transform] duration-300",
        plan.highlight
          ? "border-[oklch(0.75_0.115_58/0.45)] bg-gradient-to-b from-[var(--l1-copper-soft)]/70 to-[var(--l1-panel)]/50"
          : "border-[var(--l1-steel)] hover:border-[var(--l1-steel-strong)] hover:bg-[var(--l1-panel)]/55",
      )}
    >
      {plan.highlight ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--l1-copper)]/70 to-transparent"
        />
      ) : null}

      <header className="flex items-start justify-between gap-3">
        <span className="l1-label text-[var(--l1-muted)]">{plan.name}</span>
        {plan.highlight ? (
          <span className="rounded-[6px] border border-[oklch(0.75_0.115_58/0.35)] bg-[var(--l1-copper-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--l1-copper)]">
            Popular
          </span>
        ) : plan.trialDays ? (
          <span className="l1-label !text-[10px] text-[var(--l1-muted-2)]">
            {plan.trialDays}d trial
          </span>
        ) : null}
      </header>

      <div className="mt-6 flex items-baseline gap-2">
        <span className="l1-readout text-[3rem] leading-none font-semibold tracking-tight l1-engraved text-[var(--l1-fg)] sm:text-[3.25rem]">
          {priceLabel(plan)}
        </span>
        {cadenceLabel(plan) ? (
          <span className="l1-label !text-[10px] pb-1 text-[var(--l1-muted-2)]">
            {cadenceLabel(plan)}
          </span>
        ) : null}
      </div>

      {priceDetail(plan) ? (
        <p className="mt-2 text-[12.5px] text-[var(--l1-muted-2)]">
          {priceDetail(plan)}
        </p>
      ) : null}

      <p className="mt-4 text-[15px] leading-snug text-[var(--l1-muted)]">
        {plan.pitch}
      </p>

      <div className="p-hairline my-7" />

      <ul className="flex-1 space-y-3.5">
        {bullets.map((f) => (
          <li
            key={f}
            className="flex items-start gap-3 text-[14px] leading-snug text-[var(--l1-fg-dim)]"
          >
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--l1-copper)]/80" />
            {f}
          </li>
        ))}
      </ul>

      <a
        href={APP_URL}
        className={cn(
          "l1-btn mt-9 w-full",
          plan.highlight ? "l1-btn--copper" : "l1-btn--steel",
        )}
      >
        {plan.cta}
        <ArrowRightIcon className="size-4" />
      </a>
    </article>
  );
}

function EnterpriseBand({ plan }: { plan: Plan }): ReactNode {
  return (
    <article className="l1-reveal relative overflow-hidden rounded-[var(--l1-r-lg)] border border-[var(--l1-steel)] bg-[var(--l1-panel)]/35 shadow-[var(--l1-shadow-panel)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 80% at 100% 50%, oklch(0.6_0.115_50/0.12), transparent 60%), linear-gradient(90deg, transparent, oklch(1_0_0/0.02))",
        }}
      />
      <div className="relative grid gap-8 p-7 sm:p-9 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12">
        <div>
          <span className="l1-label text-[var(--l1-muted)]">{plan.name}</span>
          <h3 className="l1-h-sub l1-engraved mt-4 text-[var(--l1-fg)]">
            Custom mesh at <span className="l1-copper-text">your scale.</span>
          </h3>
          <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-[var(--l1-muted)]">
            {plan.pitch} Dedicated edges, commercial self-host, SSO at volume,
            and an SLA that matches the control plane.
          </p>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between lg:flex-col lg:items-stretch">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {plan.featureBullets.slice(0, 4).map((f) => (
              <li
                key={f}
                className="flex items-start gap-3 text-[14px] leading-snug text-[var(--l1-fg-dim)]"
              >
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--l1-copper)]/80" />
                {f}
              </li>
            ))}
          </ul>
          <a
            href="https://cal.com/tunnet/demo"
            target="_blank"
            rel="noreferrer"
            className="l1-btn l1-btn--steel w-full shrink-0 sm:w-auto lg:w-full"
          >
            {plan.cta}
            <ArrowRightIcon className="size-4" />
          </a>
        </div>
      </div>
    </article>
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
    <section ref={root} id="plans" className="relative px-5 pb-6 sm:px-8">
      <div className="mx-auto max-w-[1180px]">
        <div className="l1-reveal grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
          {CORE_PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>

        {ENTERPRISE ? (
          <div className="mt-5 xl:mt-6">
            <EnterpriseBand plan={ENTERPRISE} />
          </div>
        ) : null}

        <p className="l1-reveal mt-8 text-center text-[13px] text-[var(--l1-muted-2)]">
          Full limits and feature matrix below - no per-device tax, no egress
          fees.
        </p>
      </div>
    </section>
  );
}
