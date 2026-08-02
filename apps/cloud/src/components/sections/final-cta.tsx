import { useGSAP } from "@gsap/react";
import { ArrowRightIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { TerminalDemo } from "#/components/shared/terminal-demo";

const APP_URL = "https://app.tunnet.io";

export function FinalCtaSection(): ReactNode {
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
      className="relative isolate overflow-hidden px-5 py-20 sm:px-8"
    >
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[var(--l1-bg)]" />
        <div
          className="absolute inset-x-0 top-0 h-full"
          style={{
            background:
              "radial-gradient(ellipse 62% 52% at 50% 38%, oklch(0.6_0.115_50/0.17), transparent 60%)",
          }}
        />
        <div className="p-perf absolute inset-0 opacity-40" />
        <svg
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[360px] w-full opacity-40"
          viewBox="0 0 1440 360"
          preserveAspectRatio="xMidYMax slice"
        >
          <path
            d="M -40 60 H 340 V 180 H 760 V 90 H 1120 V 210 H 1500"
            fill="none"
            stroke="oklch(0.75 0.115 58 / 0.16)"
            strokeWidth="1"
          />
          <path
            d="M -40 260 H 460 V 150 H 900 V 300 H 1500"
            fill="none"
            stroke="oklch(0.75 0.115 58 / 0.11)"
            strokeWidth="1"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,var(--l1-bg),transparent)]" />
      </div>

      <div className="mx-auto grid max-w-[1160px] items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div>
          <h2 className="l1-reveal l1-h-hero l1-engraved text-[var(--l1-fg)]">
            Ship the mesh
            <br />
            <span className="l1-copper-text">your team can trust.</span>
          </h2>
          <p className="l1-reveal l1-lead mt-6 max-w-[46ch]">
            Start free with Direct mode. Grow into Managed when you're ready.
            Self-host the whole thing whenever you want.
          </p>
          <div className="l1-reveal mt-9 flex flex-wrap items-center gap-3">
            <a href={APP_URL} className="l1-btn l1-btn--copper group">
              Start free
              <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="https://cal.com/tunnet/demo"
              target="_blank"
              rel="noreferrer"
              className="l1-btn l1-btn--steel"
            >
              Book a demo
            </a>
          </div>
        </div>
        <div className="l1-reveal">
          <TerminalDemo
            title="zsh"
            code={`curl -fsSL https://get.tunnet.io | sh
sudo tunnet enroll --control-url https://control.acme.dev --token $TOKEN
tunnet status --peers`}
          />
        </div>
      </div>
    </section>
  );
}
