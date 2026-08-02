import { useGSAP } from "@gsap/react";
import { cn } from "@tunnet/ui/lib/utils";
import {
  GlobeIcon,
  KeyRoundIcon,
  NetworkIcon,
  RadioTowerIcon,
  ShareIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Lamp } from "#/components/shared/lamp";
import { Panel } from "#/components/shared/panel";
import { TerminalDemo } from "#/components/shared/terminal-demo";

type Primitive = {
  id: string;
  name: string;
  index: string;
  tagline: string;
  cmd: string;
  copy: string;
  points: string[];
  icon: ReactNode;
};

const PRIMITIVES: Primitive[] = [
  {
    id: "mesh",
    index: "01",
    name: "Mesh",
    tagline: "Every machine on one private network.",
    icon: <NetworkIcon className="size-4" />,
    cmd: `tunnet status --peers
# 14 peers · 12ms p50 · all direct`,
    copy: "Direct paths when possible, relayed automatically when NAT blocks. Hostnames for every machine - no IPs to remember.",
    points: ["Identity-based paths", "Auto relays when NAT blocks"],
  },
  {
    id: "serve",
    index: "02",
    name: "Serve",
    tagline: "Internal HTTPS in one command.",
    icon: <ShareIcon className="size-4" />,
    cmd: `tunnet serve 3000 \\
  --hostname grafana.acme.mesh \\
  --acl "role:ops"`,
    copy: "Expose a local port to your mesh with TLS from your org's CA. ACLs decide who reaches it - no firewall dance.",
    points: ["TLS from your org CA", "ACL-gated by default"],
  },
  {
    id: "tunnel",
    index: "03",
    name: "Tunnel",
    tagline: "Public HTTPS. Zero firewall theatre.",
    icon: <GlobeIcon className="size-4" />,
    cmd: `tunnet tunnel 3000
# → https://demo-api.rl.acme.tunnet.io`,
    copy: "Give any local port a public HTTPS URL through edges you can self-host. Webhooks, demos, permanent services.",
    points: ["Public HTTPS via edges", "Self-hostable edge"],
  },
  {
    id: "ssh",
    index: "04",
    name: "SSH",
    tagline: "Keyless SSH by identity.",
    icon: <TerminalSquareIcon className="size-4" />,
    cmd: `tunnet ssh db-server
tunnet ssh sessions
tunnet ssh play <id>`,
    copy: "No keys to distribute, no keys to leak. Session recording, replay, and re-auth enforcement by role.",
    points: ["Session recording", "Re-auth by role"],
  },
  {
    id: "send",
    index: "05",
    name: "Send",
    tagline: "P2P file transfer, verified.",
    icon: <RadioTowerIcon className="size-4" />,
    cmd: `tunnet send ./data.tar.gz db-server
tunnet send ./build tag:ci`,
    copy: "Every transfer verified cryptographically. Consent-based receiving, multicast to tagged machines, auto-accept per rule.",
    points: ["Verified transfers", "Multicast by tag"],
  },
  {
    id: "edge",
    index: "06",
    name: "Edge",
    tagline: "Your edge. Your certs. Your control.",
    icon: <KeyRoundIcon className="size-4" />,
    cmd: `tunnet-edge register \\
  --control-url http://control:8080 \\
  --token $TOKEN
tunnet-edge run`,
    copy: "Self-host public tunnel edges. ACME or BYO certs. Point DNS, and your team gets public HTTPS on your infrastructure.",
    points: ["ACME or BYO certs", "Regional pinning"],
  },
];

export function PrimitivesSection(): ReactNode {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const prim = PRIMITIVES[active] ?? PRIMITIVES[0];

  useGSAP(
    () => {
      registerMarketingMotion();
      if (root.current) setupReveals(root.current);
    },
    { scope: root },
  );

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((v) => (v + 1) % PRIMITIVES.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((v) => (v - 1 + PRIMITIVES.length) % PRIMITIVES.length);
      }
    };
    rail.addEventListener("keydown", onKey);
    return () => rail.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section
      ref={root}
      id="mesh"
      className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-x-0 top-0 h-96"
          style={{
            background:
              "radial-gradient(ellipse 45% 55% at 50% 0%, oklch(0.6_0.115_50/0.12), transparent 60%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal mx-auto max-w-[52rem] text-center">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            Six verbs in <span className="l1-copper-text">One mesh</span>
          </h2>
          <p className="l1-lead mt-5 max-w-[56ch] mx-auto">
            Every primitive is a verb that shares the same identity, policy and
            audit. Learn six commands, run a network.
          </p>
        </div>

        <div className="l1-reveal mt-12">
          <Panel
            live
            screws
            className="p-panel--raise"
            bodyClassName="p-brushed"
          >
            <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
              {/* Key rail */}
              <div
                ref={railRef}
                role="tablist"
                aria-label="Tunnet primitives"
                aria-orientation="vertical"
                className="border-b border-[var(--l1-steel)] p-3 lg:border-b-0 lg:border-r"
              >
                <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
                  {PRIMITIVES.map((p, i) => {
                    const on = i === active;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        aria-controls={`prim-panel-${p.id}`}
                        onClick={() => setActive(i)}
                        className={cn(
                          "group flex min-w-[150px] items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200 lg:min-w-0",
                          on
                            ? "border-[oklch(0.75_0.115_58/0.5)] bg-[var(--l1-copper-soft)] shadow-[inset_0_1px_0_oklch(1_0_0/0.05)]"
                            : "border-transparent hover:border-[var(--l1-steel)] hover:bg-[var(--l1-panel)]/60",
                        )}
                      >
                        <span className="l1-label !text-[10px] text-[var(--l1-muted-2)]">
                          {p.index}
                        </span>
                        <span
                          className={cn(
                            "flex items-center gap-2 font-display text-[15px] font-bold uppercase tracking-[0.1em]",
                            on
                              ? "text-[var(--l1-copper)]"
                              : "text-[var(--l1-muted)] group-hover:text-[var(--l1-fg-dim)]",
                          )}
                        >
                          <span
                            className={cn(
                              "transition-colors",
                              on
                                ? "text-[var(--l1-copper)]"
                                : "text-[var(--l1-muted-2)]",
                            )}
                          >
                            {p.icon}
                          </span>
                          {p.name}
                        </span>
                        <Lamp
                          status={on ? "good" : "idle"}
                          live={on}
                          className="ml-auto hidden lg:block"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Terminal panel */}
              <div className="p-4 sm:p-6" id={`prim-panel-${prim.id}`}>
                <div
                  key={prim.id}
                  className="grid gap-5 lg:grid-cols-[1fr_minmax(0,1.05fr)] lg:items-start"
                >
                  <div>
                    <h3 className="font-display text-[clamp(1.6rem,2.8vw,2.1rem)] font-bold uppercase tracking-[0.02em] l1-engraved text-[var(--l1-fg)]">
                      {prim.name} · {prim.tagline}
                    </h3>
                    <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--l1-muted)]">
                      {prim.copy}
                    </p>
                    <ul className="mt-5 space-y-2.5">
                      {prim.points.map((pt) => (
                        <li
                          key={pt}
                          className="flex items-center gap-2.5 text-[13.5px] text-[var(--l1-fg-dim)]"
                        >
                          <Lamp status="good" className="!size-1.5" />
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div
                    style={{
                      animation: "l1-wipe 0.42s cubic-bezier(0.16,1,0.3,1)",
                    }}
                    className="min-w-0"
                  >
                    <TerminalDemo
                      title={`zsh - ${prim.name.toLowerCase()}`}
                      code={prim.cmd}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}
