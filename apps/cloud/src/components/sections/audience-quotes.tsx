import { useGSAP } from "@gsap/react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";

const QUOTES = [
  {
    quote:
      "I stopped writing VPN docs. New engineers install one binary and can SSH to prod within an hour - with audit and re-auth already on. It's the closest thing to a magic packet I've seen.",
    author: "Ravi Nair",
    title: "Staff Platform Engineer, Halogen",
    mono: "RV",
  },
  {
    quote:
      "Our auditors saw identity-scoped access, encrypted transport, and session recording out of the box. Deployment went from six weeks of ZTNA rollout to one afternoon per office.",
    author: "Marta Cohen",
    title: "Head of Security, Northgate",
    mono: "MC",
  },
];

export function AudienceQuotesSection(): ReactNode {
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
      className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-x-0 bottom-0 h-96"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 50% 100%, oklch(0.6_0.115_50/0.1), transparent 60%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal mx-auto max-w-[46rem] text-center">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            Loved by the engineers.
            <br />
            <span className="l1-copper-text">Trusted by the auditors.</span>
          </h2>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-2 lg:gap-10">
          {QUOTES.map((q, i) => (
            <figure
              key={q.author}
              className={`l1-reveal relative rounded-[var(--l1-r-lg)] border border-[var(--l1-steel)] bg-gradient-to-b from-[var(--l1-panel)]/60 to-transparent p-8 sm:p-10 ${
                i % 2 === 1 ? "lg:mt-10" : ""
              }`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute right-6 top-4 font-display text-[7rem] font-extrabold leading-none text-[var(--l1-copper-soft)]"
              >
                "
              </span>
              <blockquote className="relative max-w-[52ch] font-display text-[clamp(1.5rem,2.4vw,1.9rem)] font-semibold leading-[1.2] l1-engraved text-[var(--l1-fg)]">
                {q.quote}
              </blockquote>
              <figcaption className="mt-7 flex items-center gap-3.5 border-t border-[var(--l1-steel)] pt-5">
                <span className="grid size-10 place-items-center rounded-lg border border-[oklch(0.75_0.115_58/0.45)] bg-[var(--l1-copper-soft)] font-mono text-[12px] font-semibold text-[var(--l1-copper)]">
                  {q.mono}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--l1-fg)]">
                    {q.author}
                  </span>
                  <span className="l1-label !text-[9.5px] text-[var(--l1-muted-2)]">
                    {q.title}
                  </span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
