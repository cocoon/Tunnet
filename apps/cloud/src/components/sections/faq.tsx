import { useGSAP } from "@gsap/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@tunnet/ui/components/accordion";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";

const FAQ = [
  {
    q: "How is Tunnet different from Tailscale or NetBird?",
    a: "Tunnet packages six primitives - mesh, serve, tunnel, send, SSH, edge - under one identity and one policy system, instead of stitching together a VPN, a tunnel tool, a file tool and a bastion. Everything is open source, and you can self-host the whole stack.",
  },
  {
    q: "Do I need to open firewall ports?",
    a: "No. Peers connect outbound over an encrypted connection. Direct paths are attempted first; relays take over automatically when NAT prevents a direct hop.",
  },
  {
    q: "What is Direct mode?",
    a: "A zero-infrastructure peer-to-peer mode - no control plane, no server, no billing. Perfect for personal fleets and small teams. Run `tunnet upgrade-to-managed` when you outgrow it.",
  },
  {
    q: "Which platforms does the agent support?",
    a: "macOS, Linux, and Windows. Linux and macOS require root to create a TUN interface. Windows requires Administrator with the Wintun driver installed.",
  },
  {
    q: "Can I bring my own edges and certificates?",
    a: "Yes. Register an edge with `tunnet-edge register`, point DNS at it, and either use built-in ACME or bring your own certs.",
  },
  {
    q: "Does SSH really work without keys?",
    a: "Yes - the SSH primitive is bound to your Tunnet identity. Authentication follows organization policies, sessions can be recorded, and re-auth can be enforced by role.",
  },
  {
    q: "How do file transfers stay verified?",
    a: "Send verifies every transfer cryptographically, and receiving is consent-based. Multicast to tagged machines and configure auto-accept per rule.",
  },
  {
    q: "What's the license?",
    a: "Tunnet uses MPL-2.0, AGPL-3.0-only, and Apache-2.0 by component. A Commercial License is available as an alternative for AGPL components when AGPL doesn't fit. Contributions require a signed CLA.",
  },
];

export function FaqSection(): ReactNode {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      registerMarketingMotion();
      if (root.current) setupReveals(root.current);
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[900px]">
        <div className="l1-reveal max-w-[46rem]">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            The questions everyone asks first.
          </h2>
        </div>

        <div className="l1-reveal mt-10">
          <Accordion className="divide-y divide-[var(--l1-steel)] border-y border-[var(--l1-steel)]">
            {FAQ.map((f) => (
              <AccordionItem key={f.q} value={f.q} className="border-none">
                <AccordionTrigger className="py-5 text-left text-[15.5px] font-medium text-[var(--l1-fg)] transition-colors hover:text-[var(--l1-copper)] data-panel-open:text-[var(--l1-copper)]">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="pb-5 pr-8 text-[14.5px] leading-relaxed text-[var(--l1-muted)]">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
