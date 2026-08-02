import { useGSAP } from "@gsap/react";
import { NumberTicker } from "@tunnet/ui/components/number-ticker";
import { CodeIcon, HeartHandshakeIcon, ScaleIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { FaGithub } from "react-icons/fa";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Panel } from "#/components/shared/panel";

const STATS = [
  { icon: CodeIcon, label: "lines of open Rust", value: 148000 },
  { label: "components", value: 3, suffix: " licenses" },
  { icon: HeartHandshakeIcon, label: "contributors", value: 42 },
  { icon: FaGithub, label: "GitHub stars", value: 3200, plus: true },
];

const LICENSES = [
  { name: "MPL-2.0", scope: "runtime · agent · SDKs" },
  { name: "AGPL-3.0", scope: "control plane · dashboard · relay" },
  { name: "Apache-2.0", scope: "protocol · tooling · scripts" },
];

export function OpenSourceSection(): ReactNode {
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
      className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-28"
    >
      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal">
          <Panel live screws raised className="p-brushed">
            <div className="grid gap-10 p-8 sm:p-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center">
              <div>
                <h2 className="l1-h-section l1-engraved text-[var(--l1-fg)]">
                  Not just the agent.
                  <br />
                  <span className="l1-copper-text">Every line.</span>
                </h2>
                <p className="l1-lead mt-5 max-w-[54ch]">
                  Agent, control plane, management API, dashboard, relay - read
                  every line, audit every path, self-host the whole thing.
                  Commercial licenses exist for AGPL components when AGPL
                  doesn't fit; the freedom stays either way.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <a
                    href="https://github.com/tunnetio/Tunnet"
                    target="_blank"
                    rel="noreferrer"
                    className="l1-btn l1-btn--copper"
                  >
                    <FaGithub className="size-4" />
                    View on GitHub
                  </a>
                  <a
                    href="https://discord.gg/y5bNc3MYKz"
                    target="_blank"
                    rel="noreferrer"
                    className="l1-btn l1-btn--steel"
                  >
                    Join Discord
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {STATS.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border border-[var(--l1-steel)] bg-[var(--l1-bezel)]/60 p-5"
                  >
                    {s.icon ? (
                      <s.icon className="size-4 text-[var(--l1-copper)]" />
                    ) : (
                      <ScaleIcon className="size-4 text-[var(--l1-copper)]" />
                    )}
                    <p className="l1-readout mt-4 text-[26px] font-semibold l1-engraved text-[var(--l1-fg)]">
                      {typeof s.value === "number" ? (
                        <>
                          <NumberTicker
                            value={s.value}
                            className="!text-[inherit]"
                          />
                          {s.plus ? "+" : ""}
                        </>
                      ) : null}
                      {s.suffix ?? ""}
                    </p>
                    <p className="l1-label mt-1 !text-[9.5px] text-[var(--l1-muted-2)]">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* License map */}
            <div className="grid divide-y divide-[var(--l1-steel)] border-t border-[var(--l1-steel)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {LICENSES.map((l) => (
                <div key={l.name} className="flex items-center gap-3 px-8 py-4">
                  <span className="l1-readout text-[var(--l1-copper)]">
                    {l.name}
                  </span>
                  <span className="l1-label !text-[9.5px] text-[var(--l1-muted-2)]">
                    {l.scope}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}
