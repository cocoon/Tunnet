import { useGSAP } from "@gsap/react";
import { Link } from "@tanstack/react-router";
import { TiltCard } from "@tunnet/ui/components/unlumen-ui/tilt-card";
import { ArrowRightIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { PLANS } from "#/lib/pricing";

export function PricingTeaserSection(): ReactNode {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      registerMarketingMotion();
      if (root.current) setupReveals(root.current);
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      id="pricing"
      className="relative isolate overflow-hidden px-5 py-20 sm:px-8"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-x-0 top-0 h-96"
          style={{
            background:
              "radial-gradient(ellipse 45% 55% at 50% 0%, oklch(0.6_0.115_50/0.13), transparent 60%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal mx-auto max-w-[52rem] text-center">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            Start free. <span className="l1-copper-text">Scale the mesh.</span>
          </h2>
          <p className="l1-lead mt-5 mx-auto max-w-[56ch]">
            Direct mode is free forever - even for commercial use. Managed plans
            from $5/month; seats and managed traffic, never per device.
          </p>
        </div>

        <div className="l1-reveal mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PLANS.map((p) => (
            <TiltCard
              key={p.id}
              title={p.name}
              description={p.pitch}
              price={
                p.pricing === "custom" || p.price === null
                  ? "Custom"
                  : p.pricing === "free"
                    ? "$0"
                    : `$${p.price}`
              }
              badgeLabel={p.highlight ? "Popular" : p.cadence}
              badgeVariant={p.highlight ? "success" : "warning"}
              href="/pricing"
              className="!h-auto min-h-48 !rounded-[var(--l1-r-lg)] !border-[var(--l1-steel)] !bg-[var(--l1-panel)] text-[var(--l1-fg)] shadow-none hover:!shadow-[0_24px_50px_-30px_oklch(0.6_0.115_50/0.45)]"
              tiltProps={{ isReverse: false }}
            >
              <span className="w-full inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--l1-copper-bright)]">
                {p.pricing === "custom" || p.price === null
                  ? "Talk to sales"
                  : "Choose plan"}
                <ArrowRightIcon className="size-3.5" />
              </span>
            </TiltCard>
          ))}
        </div>

        <div className="l1-reveal mt-10 flex justify-center">
          <Link
            to="/pricing"
            className="l1-btn l1-btn--steel inline-flex items-center gap-2"
          >
            Compare plans
            <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
