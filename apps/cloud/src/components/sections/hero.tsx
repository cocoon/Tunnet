import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowRightIcon, TerminalIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  prefersReducedMotion,
  registerMarketingMotion,
} from "#/components/motion/landing-timeline";
import { CopyButton } from "#/components/shared/copy-button";
import { MeshConsole } from "#/components/visuals/topology";

const APP_URL = "https://app.tunnet.io";
const INSTALL_CMD = "curl -fsSL https://get.tunnet.io | sh";

export function HeroSection(): ReactNode {
  const root = useRef<HTMLElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const leadRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      registerMarketingMotion();
      if (prefersReducedMotion()) return;
      const targets = [
        h1Ref.current,
        leadRef.current,
        ctaRef.current,
        consoleRef.current,
      ];
      try {
        gsap.set(targets, { opacity: 0, y: 26 });
        const tl = gsap.timeline({
          defaults: { ease: "expo.out" },
          delay: 0.05,
        });
        tl.to(h1Ref.current, { opacity: 1, y: 0, duration: 1.05 }, 0.15)
          .to(leadRef.current, { opacity: 1, y: 0, duration: 0.9 }, 0.4)
          .to(ctaRef.current, { opacity: 1, y: 0, duration: 0.9 }, 0.55)
          .to(consoleRef.current, { opacity: 1, y: 0, duration: 1.15 }, 0.72);
      } catch {
        gsap.set(targets, { clearProps: "opacity,transform" });
      }
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      className="relative isolate overflow-hidden pt-20 pb-16 sm:pt-28 sm:pb-24"
    >
      {/* Background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[var(--l1-bg)]" />
        <div
          className="absolute inset-x-0 top-0 h-[760px]"
          style={{
            background:
              "radial-gradient(ellipse 62% 58% at 50% 0%, oklch(0.6_0.115_50/0.16), transparent 62%)",
          }}
        />
        <div className="p-perf absolute inset-x-0 top-0 h-[520px] opacity-50" />
        {/* faint copper trace field */}
        <svg
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[420px] w-full opacity-40"
          viewBox="0 0 1440 420"
          preserveAspectRatio="xMidYMin slice"
        >
          <path
            d="M -40 120 H 320 V 60 H 760 V 200 H 1120 V 120 H 1500"
            fill="none"
            stroke="oklch(0.75 0.115 58 / 0.16)"
            strokeWidth="1"
          />
          <path
            d="M -40 300 H 480 V 240 H 900 V 340 H 1500"
            fill="none"
            stroke="oklch(0.75 0.115 58 / 0.12)"
            strokeWidth="1"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(180deg,transparent,var(--l1-bg))]" />
      </div>

      <div className="relative mx-auto flex max-w-[1160px] flex-col items-center px-5 text-center sm:px-8">
        {/* Headline */}
        <h1
          ref={h1Ref}
          className="l1-h-hero mt-6 max-w-[15ch] l1-engraved text-[var(--l1-fg)]"
        >
          The network is
          <br />
          <span className="l1-copper-text">the network.</span>
        </h1>

        <p
          ref={leadRef}
          className="mt-7 max-w-[56ch] text-[15px] leading-relaxed text-[var(--l1-muted)] sm:text-[17px]"
        >
          Everything else just works. Install one agent on every laptop, server
          and CI runner - get an internal IP, SSH by hostname, expose services
          with TLS, and share public tunnels. All under one identity.
        </p>

        {/* Install + CTAs */}
        <div
          ref={ctaRef}
          className="mt-9 flex w-full flex-col items-center gap-4"
        >
          <div className="p-bezel relative flex w-full max-w-[560px] items-center gap-2.5 overflow-hidden rounded-xl px-4 py-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[oklch(0.75_0.115_58/0.4)] bg-[var(--l1-copper-soft)] text-[var(--l1-copper)]">
              <TerminalIcon className="size-3.5" />
            </span>
            <span className="select-none text-[var(--l1-muted-2)]">$</span>
            <code className="flex-1 truncate text-left font-mono text-[13px] text-[var(--l1-fg-dim)]">
              {INSTALL_CMD}
            </code>
            <CopyButton value={INSTALL_CMD} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href={APP_URL} className="l1-btn l1-btn--copper group">
              Start free
              <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a href="#mesh" className="l1-btn l1-btn--steel">
              See the platform
            </a>
          </div>
        </div>

        {/* Mesh console */}
        <div ref={consoleRef} className="mt-16 w-full max-w-[1080px]">
          <MeshConsole />
        </div>
      </div>
    </section>
  );
}
