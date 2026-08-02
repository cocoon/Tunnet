import { useGSAP } from "@gsap/react";
import {
  EyeIcon,
  FileTextIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  RadioIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Panel } from "#/components/shared/panel";
import { ArchitectureDiagram } from "#/components/visuals/architecture";

const PILLARS = [
  {
    icon: LockKeyholeIcon,
    title: "TLS 1.3 over QUIC",
    body: "Every link is encrypted end to end. No unencrypted paths, no shared secrets on the wire.",
  },
  {
    icon: KeyRoundIcon,
    title: "Device identity, not keys",
    body: "Machines enroll with verifiable identity. No SSH keys to distribute, rotate, or leak.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Policy engine by default",
    body: "ACLs, roles, and tags decide reachability. Zero trust isn't a mode - it's the default.",
  },
  {
    icon: FileTextIcon,
    title: "Full audit trail",
    body: "Every session, tunnel, and file transfer is logged. SSH sessions can be replayed on demand.",
  },
  {
    icon: EyeIcon,
    title: "You can read every line",
    body: "Agent, control plane, dashboard, edge - AGPL, MPL and Apache by component. Self-host the entire stack.",
  },
  {
    icon: RadioIcon,
    title: "Verified file transfers",
    body: "Send verifies every transfer cryptographically. Consent-based receiving, per-rule.",
  },
];

export function SecuritySection(): ReactNode {
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
      id="security"
      className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-x-0 top-0 h-[560px]"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 50% 0%, oklch(0.6_0.115_50/0.12), transparent 60%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal max-w-[52rem]">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            The network doesn't have to be
            <br />
            <span className="l1-copper-text">the weakest link.</span>
          </h2>
          <p className="l1-lead mt-5 max-w-[54ch]">
            Tunnet ships with the posture your auditors ask for on day one -
            identity everywhere, encryption everywhere, audit everywhere.
            Because everything is open source, you never have to take our word
            for it.
          </p>
        </div>

        {/* Architecture diagram */}
        <div className="l1-reveal mt-12">
          <Panel live screws>
            <div className="relative p-4 sm:p-8">
              <div
                aria-hidden
                className="p-perf pointer-events-none absolute inset-0 opacity-50"
              />
              <ArchitectureDiagram />
            </div>
          </Panel>
        </div>

        {/* Inspection sheet - not cards */}
        <div className="l1-reveal mt-10">
          <div className="overflow-hidden rounded-[var(--l1-r-lg)] border border-[var(--l1-steel)] bg-[var(--l1-panel)]/40">
            {PILLARS.map((p, i) => (
              <div
                key={p.title}
                className="group grid grid-cols-[auto_auto_1fr] items-start gap-x-4 gap-y-1 border-b border-[var(--l1-steel)] px-5 py-5 transition-colors last:border-0 hover:bg-[var(--l1-copper-faint)] sm:px-8 sm:grid-cols-[52px_auto_1fr]"
              >
                <span className="l1-label mt-1 !text-[10px] text-[var(--l1-muted-2)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mt-0.5 grid size-10 place-items-center rounded-lg border border-[var(--l1-steel-strong)] bg-[var(--l1-panel)] text-[var(--l1-copper)] transition-colors group-hover:border-[oklch(0.75_0.115_58/0.5)]">
                  <p.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-display text-[17px] font-bold uppercase tracking-[0.04em] l1-engraved text-[var(--l1-fg)]">
                    {p.title}
                  </h3>
                  <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-[var(--l1-muted)]">
                    {p.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
