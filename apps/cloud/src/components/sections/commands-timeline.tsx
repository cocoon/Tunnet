import { useGSAP } from "@gsap/react";
import { cn } from "@tunnet/ui/lib/utils";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Lamp } from "#/components/shared/lamp";
import { TerminalDemo } from "#/components/shared/terminal-demo";

const ITEMS = [
  {
    title: "Enroll",
    code: `sudo tunnet enroll --control-url https://control.acme.dev --token $TOKEN
tunnet status --peers`,
    title2: "join the mesh",
  },
  {
    title: "Route a LAN",
    code: `tunnet route add 192.168.1.0/24
tunnet route list
tunnet netcheck`,
    title2: "advertise a subnet",
  },
  {
    title: "Expose internal",
    code: `tunnet serve 3000 \\
  --hostname grafana.acme.mesh \\
  --acl "role:ops"
tunnet serve status`,
    title2: "serve to the mesh",
  },
  {
    title: "Public in one command",
    code: `tunnet tunnel 3000
# → https://demo-api.rl.acme.tunnet.io
tunnet tunnel status`,
    title2: "public tunnel via relay",
  },
  {
    title: "SSH by identity",
    code: `tunnet ssh db-server
tunnet ssh sessions
tunnet ssh play <session_id>`,
    title2: "passwordless, keyless SSH",
  },
  {
    title: "Grow up",
    code: `tunnet upgrade-to-managed
# Migrates your network to the full control plane
# without losing connectivity`,
    title2: "direct → managed",
  },
];

export function CommandsTimelineSection(): ReactNode {
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
      id="cli"
      className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="p-perf absolute inset-0 opacity-40" />
      </div>

      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal max-w-[52rem]">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            From install to
            <br />
            <span className="l1-copper-text">full-fleet zero-trust.</span>
          </h2>
          <p className="l1-lead mt-5 max-w-[54ch]">
            Every primitive is a verb. Every verb does one thing. Follow a
            machine from its first enroll to running a fleet-wide policy.
          </p>
        </div>

        {/* Spine */}
        <div className="relative mt-14">
          <div
            aria-hidden
            className="absolute bottom-2 left-4 top-2 w-px bg-[linear-gradient(180deg,oklch(0.75_0.115_58/0.5),oklch(0.75_0.115_58/0.12))] lg:left-1/2"
          />
          <ol className="space-y-10 lg:space-y-14">
            {ITEMS.map((it, i) => {
              const right = i % 2 === 1;
              return (
                <li key={it.title} className="relative">
                  {/* spine node */}
                  <span
                    aria-hidden
                    className="absolute left-4 top-7 grid size-4 -translate-x-1/2 place-items-center rounded-full border border-[oklch(0.75_0.115_58/0.6)] bg-[var(--l1-bg)] lg:left-1/2"
                  >
                    <Lamp status="good" live className="!size-1.5" />
                  </span>

                  <div
                    className={cn(
                      "l1-reveal pl-10 lg:grid lg:grid-cols-2 lg:gap-16 lg:pl-0",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[540px]",
                        right && "lg:col-start-2",
                        !right && "lg:justify-self-end",
                      )}
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <span className="l1-label !text-[10px] text-[var(--l1-muted-2)]">
                          {String(i + 1).padStart(2, "0")} ·{" "}
                          {it.title2.toUpperCase()}
                        </span>
                      </div>
                      <TerminalDemo
                        title={`zsh - ${it.title2}`}
                        code={it.code}
                      />
                      <p className="l1-readout mt-2.5 text-[var(--l1-muted-2)]">
                        {it.title}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
