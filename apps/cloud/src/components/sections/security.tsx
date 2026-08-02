import { useGSAP } from "@gsap/react";
import { HoverFeatureCards } from "@tunnet/ui/components/unlumen-ui/hover-feature-cards";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Panel } from "#/components/shared/panel";
import { ArchitectureDiagram } from "#/components/visuals/architecture";

const PILLARS = [
  {
    name: "TLS 1.3 over QUIC",
    description:
      "Every link is encrypted end to end. No unencrypted paths, no shared secrets on the wire.",
    img: "/security/tls.png",
  },
  {
    name: "Device identity, not keys",
    description:
      "Machines enroll with verifiable identity. No SSH keys to distribute, rotate, or leak.",
    img: "/security/identity.png",
  },
  {
    name: "Policy engine by default",
    description:
      "ACLs, roles, and tags decide reachability. Zero trust isn't a mode - it's the default.",
    img: "/security/policy.png",
  },
  {
    name: "Full audit trail",
    description:
      "Every session, tunnel, and file transfer is logged. SSH sessions can be replayed on demand.",
    img: "/security/audit.png",
  },
  {
    name: "You can read every line",
    description:
      "Agent, control plane, dashboard, edge - AGPL, MPL and Apache by component. Self-host the entire stack.",
    img: "/security/opensource.png",
  },
  {
    name: "Verified file transfers",
    description:
      "Send verifies every transfer cryptographically. Consent-based receiving, per-rule.",
    img: "/security/send.png",
  },
] as const;

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

        <div className="l1-reveal mt-10">
          <HoverFeatureCards
            className="lg:grid-cols-3"
            items={PILLARS.map((p) => ({
              name: p.name,
              description: p.description,
              img: p.img,
              fadeBottom: true,
              href: "#security",
            }))}
          />
        </div>
      </div>
    </section>
  );
}
