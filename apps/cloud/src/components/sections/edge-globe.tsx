import { useGSAP } from "@gsap/react";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { EdgeGlobe } from "#/components/visuals/edge-map";

const BULLETS = [
  "Anycast public HTTPS endpoints for every tunnel",
  "ACME out of the box, BYO cert supported",
  "Regional pinning, health checks, graceful drain",
  "Same identity everywhere - one policy engine",
];

export function EdgeGlobeSection(): ReactNode {
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
      id="edge"
      className="relative isolate overflow-hidden border-y border-[var(--l1-steel)]"
      style={{ backgroundColor: "var(--l1-bg-2)" }}
    >
      <div
        aria-hidden
        className="p-perf pointer-events-none absolute inset-0 -z-0 opacity-40"
      />
      {/* Globe as background on large screens */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 hidden items-center justify-end lg:flex"
      >
        <div className="absolute -right-[14%] top-1/2 aspect-square w-[min(1080px,118%)] -translate-y-1/2 opacity-80">
          <EdgeGlobe interactive size={900} />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_65%_85%_at_18%_50%,var(--l1-bg-2)_15%,transparent_72%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--l1-bg-2)_0%,transparent_12%,transparent_88%,var(--l1-bg-2)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto grid max-w-[1160px] items-center gap-14 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="l1-reveal">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            Global edge.
            <br />
            <span className="l1-copper-text">Your control plane.</span>
          </h2>
          <p className="mt-5 max-w-[54ch] text-[15px] leading-relaxed text-[var(--l1-muted)] sm:text-lg">
            Tunnet's public tunnels ride on edges you can run yourself. Point
            DNS, configure ACME, and your team gets public HTTPS endpoints on
            infrastructure that never leaves your account.
          </p>

          <ul className="mt-7 space-y-3">
            {BULLETS.map((b) => (
              <li
                key={b}
                className="flex items-start gap-3 text-[14.5px] text-[var(--l1-fg-dim)]"
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-[oklch(0.75_0.115_58/0.45)] bg-[var(--l1-copper-soft)] text-[var(--l1-copper)]">
                  <CheckIcon className="size-3.5" />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Globe - inline on mobile, ambient on desktop */}
        <div className="l1-reveal relative lg:hidden">
          <div className="mx-auto aspect-square w-full max-w-md">
            <EdgeGlobe size={560} />
          </div>
        </div>
      </div>
    </section>
  );
}
