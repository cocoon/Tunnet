import { useGSAP } from "@gsap/react";
import { cn } from "@tunnet/ui/lib/utils";
import { ArrowRightIcon, BuildingIcon, UsersIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Panel } from "#/components/shared/panel";
import { TerminalDemo } from "#/components/shared/terminal-demo";

const MODES = [
  {
    id: "direct",
    icon: <UsersIcon className="size-4" />,
    title: "Direct mode",
    subtitle: "Individuals & small groups",
    body: "Spin up a mesh from your laptop with a passphrase. No control plane, no server, no billing.",
    specs: [
      ["SETUP", "one command"],
      ["INFRA", "no servers"],
      ["AUTH", "a passphrase"],
      ["COST", "free forever"],
    ],
    code: `sudo tunnet create --name my-net --secret "a-strong-passphrase"
tunnet invite --name my-net
sudo tunnet join <INVITE_CODE>`,
    footer: "Free, forever.",
  },
  {
    id: "managed",
    icon: <BuildingIcon className="size-4" />,
    title: "Managed mode",
    subtitle: "Teams & organizations",
    body: "Full control plane with SSO, audit and API. Deploy on your infra or self-host with Docker.",
    specs: [
      ["IDENTITY", "SSO · OIDC"],
      ["CONTROL", "dashboard + API"],
      ["TRUST", "audit + recording"],
      ["HOSTING", "cloud or self-hosted"],
    ],
    code: `docker compose up -d
sudo tunnet enroll \\
  --control-url https://control.acme.dev \\
  --token $TOKEN`,
    footer: "Cloud or self-hosted.",
    emphasis: true,
  },
];

export function TwoModesSection(): ReactNode {
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
      id="modes"
      className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="p-perf absolute inset-0 opacity-40" />
      </div>

      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal mx-auto max-w-[52rem] text-center">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            Solo hackers and 5,000-person orgs.
            <br />
            <span className="l1-copper-text">Same tool. Same commands.</span>
          </h2>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2 lg:gap-7">
          {MODES.map((m) => (
            <div key={m.id} className="l1-reveal">
              <Panel
                live
                screws
                raised={m.emphasis}
                className={cn(
                  "h-full",
                  m.emphasis &&
                    "shadow-[0_0_0_1px_oklch(0.75_0.115_58/0.28),var(--l1-shadow-lift)]",
                )}
              >
                <div className="p-6 sm:p-8">
                  <div className="flex items-center gap-2 text-[var(--l1-muted-2)]">
                    <span className="grid size-6 place-items-center rounded-md border border-[var(--l1-steel-strong)] bg-[var(--l1-panel)] text-[var(--l1-copper)]">
                      {m.icon}
                    </span>
                    <span className="l1-label !text-[10px]">{m.subtitle}</span>
                  </div>

                  <h3 className="l1-h-sub mt-4 l1-engraved text-[var(--l1-fg)]">
                    {m.title}
                  </h3>
                  <p className="mt-2 max-w-[46ch] text-[14.5px] leading-relaxed text-[var(--l1-muted)]">
                    {m.body}
                  </p>

                  <dl className="mt-6 divide-y divide-[var(--l1-steel)] border-y border-[var(--l1-steel)]">
                    {m.specs.map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-baseline justify-between gap-4 py-2.5"
                      >
                        <dt className="l1-label !text-[10px] text-[var(--l1-muted-2)]">
                          {k}
                        </dt>
                        <dd className="l1-readout text-right text-[var(--l1-fg-dim)]">
                          {v}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-6">
                    <TerminalDemo title="zsh - quick start" code={m.code} />
                  </div>

                  <p className="l1-readout mt-5 text-[var(--l1-muted-2)]">
                    {m.footer}
                  </p>
                </div>
              </Panel>
            </div>
          ))}
        </div>

        {/* Migration patch */}
        <div className="l1-reveal relative mx-auto mt-10 max-w-3xl">
          <div className="relative overflow-hidden rounded-xl border border-dashed border-[oklch(0.75_0.115_58/0.4)] bg-[var(--l1-copper-soft)]/50 px-6 py-5 text-center backdrop-blur">
            <span
              aria-hidden
              className="absolute left-4 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full border border-[oklch(0.75_0.115_58/0.5)]"
            >
              <span className="size-1.5 rounded-full bg-[var(--l1-copper)]" />
            </span>
            <p className="flex flex-wrap items-center justify-center gap-2 text-[13.5px] text-[var(--l1-fg-dim)]">
              Outgrowing Direct?
              <code className="rounded-md border border-[oklch(0.75_0.115_58/0.4)] bg-[var(--l1-copper-soft)] px-2 py-0.5 font-mono text-[12px] text-[var(--l1-copper)]">
                tunnet upgrade-to-managed
              </code>
              migrates your network without losing connectivity.
              <ArrowRightIcon className="size-3.5 text-[var(--l1-copper)]" />
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
