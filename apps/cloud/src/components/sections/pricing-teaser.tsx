import { useGSAP } from "@gsap/react";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Lamp } from "#/components/shared/lamp";
import { Panel } from "#/components/shared/panel";
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
      className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
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
          <p className="l1-lead mt-5 max-w-[56ch] mx-auto">
            Direct mode is free forever - even for commercial use. Managed plans
            bill by seats and managed traffic, never per device.
          </p>
        </div>

        <div className="l1-reveal mt-12">
          <Panel screws>
            <div className="grid divide-y divide-[var(--l1-steel)] sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
              {PLANS.map((p) => (
                <Link
                  key={p.id}
                  to="/pricing"
                  className="group relative flex flex-col p-6 transition-colors hover:bg-[var(--l1-copper-faint)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="l1-label text-[var(--l1-muted)]">
                      {p.name}
                    </span>
                    <Lamp
                      status={p.highlight ? "good" : "idle"}
                      live={p.highlight}
                      className="!size-1.5"
                    />
                  </div>
                  <p className="l1-readout mt-4 text-[26px] font-semibold l1-engraved text-[var(--l1-fg)]">
                    {p.price === null ? "Custom" : `$${p.price}`}
                    <span className="ml-1 text-[12px] font-normal text-[var(--l1-muted-2)]">
                      {p.price === null ? "" : p.cadence}
                    </span>
                  </p>
                  <p className="mt-3 flex-1 text-[13px] leading-relaxed text-[var(--l1-muted)]">
                    {p.pitch}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--l1-copper)]">
                    {p.price === null ? "Talk to sales" : "Choose plan"}
                    <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>

            <div className="border-t border-[var(--l1-steel)] bg-[var(--l1-bezel)]/70 px-6 py-4">
              <Link
                to="/pricing"
                className="group inline-flex items-center gap-2 text-[13.5px] font-semibold text-[var(--l1-fg-dim)] transition-colors hover:text-[var(--l1-copper)]"
              >
                Open full pricing with the live seat calculator
                <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}
