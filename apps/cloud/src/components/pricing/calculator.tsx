import { useGSAP } from "@gsap/react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";
import { Lamp } from "#/components/shared/lamp";
import { Panel } from "#/components/shared/panel";
import { PLANS, planForResources, seatCost } from "#/lib/pricing";

const TEAM = PLANS.find((p) => p.id === "team") ?? PLANS[1];
const BUSINESS = PLANS.find((p) => p.id === "business") ?? PLANS[2];

const MAX_RESOURCES = 1000;

function Stepper({
  value,
  onChange,
  min = 1,
  max = 500,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid size-9 place-items-center rounded-lg border border-[var(--l1-steel-strong)] bg-[var(--l1-panel)] text-[var(--l1-fg-dim)] transition-colors hover:border-[oklch(0.75_0.115_58/0.5)] hover:text-[var(--l1-copper)] disabled:opacity-40"
        aria-label="Decrease seats"
        disabled={value <= min}
      >
        <MinusIcon className="size-4" />
      </button>
      <span className="l1-readout grid min-w-[72px] place-items-center rounded-lg border border-[var(--l1-steel)] bg-[var(--l1-bezel)] px-3 py-2 text-[17px] font-semibold text-[var(--l1-fg)]">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid size-9 place-items-center rounded-lg border border-[var(--l1-steel-strong)] bg-[var(--l1-panel)] text-[var(--l1-fg-dim)] transition-colors hover:border-[oklch(0.75_0.115_58/0.5)] hover:text-[var(--l1-copper)] disabled:opacity-40"
        aria-label="Increase seats"
        disabled={value >= max}
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}

export function Calculator(): ReactNode {
  const root = useRef<HTMLElement>(null);
  const [seats, setSeats] = useState(8);
  const [resources, setResources] = useState(80);

  useGSAP(
    () => {
      registerMarketingMotion();
      if (root.current) setupReveals(root.current);
    },
    { scope: root },
  );

  const teamCost = useMemo(() => seatCost(TEAM, seats) ?? 0, [seats]);
  const bizCost = useMemo(() => seatCost(BUSINESS, seats) ?? 0, [seats]);
  const fit = useMemo(() => planForResources(resources), [resources]);
  const fill = (resources / MAX_RESOURCES) * 100;

  const teamExtra = Math.max(0, seats - (TEAM.seats ?? 0));
  const bizExtra = Math.max(0, seats - (BUSINESS.seats ?? 0));

  return (
    <section id="calculator" className="relative px-5 pt-20 sm:px-8 sm:pt-24">
      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal mx-auto max-w-[46rem] text-center">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            Know your monthly number
            <br />
            <span className="l1-copper-text">before you sign up.</span>
          </h2>
        </div>

        <div className="l1-reveal mt-10">
          <Panel live screws raised className="p-brushed">
            <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
              {/* Inputs */}
              <div className="border-b border-[var(--l1-steel)] p-6 sm:p-8 lg:border-b-0 lg:border-r">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="l1-label text-[var(--l1-muted)]">
                      Seats
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <Stepper value={seats} onChange={setSeats} />
                    <span className="l1-readout text-right text-[12px] text-[var(--l1-muted)]">
                      Team includes {TEAM.seats} · Business {BUSINESS.seats}
                    </span>
                  </div>
                </div>

                <div className="mt-8">
                  <div className="flex items-center justify-between">
                    <span className="l1-label text-[var(--l1-muted)]">
                      Resources
                    </span>
                    <span className="l1-readout text-[var(--l1-copper)]">
                      {resources}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={MAX_RESOURCES}
                    value={resources}
                    onChange={(e) => setResources(Number(e.target.value))}
                    className="l1-range mt-4"
                    style={{ ["--l1-fill" as string]: `${fill}%` }}
                    aria-label="Number of resources"
                  />
                  <div className="mt-1.5 flex justify-between">
                    <span className="l1-label !text-[8.5px] text-[var(--l1-muted-2)]">
                      1
                    </span>
                    <span className="l1-label !text-[8.5px] text-[var(--l1-muted-2)]">
                      {MAX_RESOURCES}+
                    </span>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-2">
                  <span className="l1-label !text-[9.5px] text-[var(--l1-muted-2)]">
                    FITS
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.75_0.115_58/0.45)] bg-[var(--l1-copper-soft)] px-2.5 py-1">
                    <span className="l1-readout text-[var(--l1-copper)]">
                      {fit.name}
                    </span>
                  </span>
                  <span className="l1-readout text-[11px] text-[var(--l1-muted-2)]">
                    {fit.id === "enterprise"
                      ? "- talk to sales"
                      : `- ${fit.resources} resources`}
                  </span>
                </div>
              </div>

              {/* Output */}
              <div className="p-6 sm:p-8">
                <div className="grid gap-4">
                  <CostRow
                    plan="Team"
                    included={TEAM.seats ?? 0}
                    extraRate={TEAM.extraSeat ?? 0}
                    extra={teamExtra}
                    cost={teamCost}
                    highlighted
                  />
                  <CostRow
                    plan="Business"
                    included={BUSINESS.seats ?? 0}
                    extraRate={BUSINESS.extraSeat ?? 0}
                    extra={bizExtra}
                    cost={bizCost}
                  />
                </div>
                <div className="mt-6 rounded-xl border border-[var(--l1-steel)] bg-[var(--l1-bezel)]/70 p-4">
                  <p className="l1-label !text-[9px] text-[var(--l1-muted-2)]">
                    HOW IT'S CALCULATED
                  </p>
                  <p className="l1-readout mt-2 text-[12px] leading-relaxed text-[var(--l1-fg-dim)]">
                    Team = $29 + (seats − 5) × $5
                    <br />
                    Business = $149 + (seats − 15) × $8
                  </p>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function CostRow({
  plan,
  included,
  extraRate,
  extra,
  cost,
  highlighted,
}: {
  plan: string;
  included: number;
  extraRate: number;
  extra: number;
  cost: number;
  highlighted?: boolean;
}) {
  return (
    <div
      className={
        highlighted
          ? "rounded-xl border border-[oklch(0.75_0.115_58/0.5)] bg-[var(--l1-copper-soft)]/70 p-4"
          : "rounded-xl border border-[var(--l1-steel)] bg-[var(--l1-panel)]/50 p-4"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Lamp
            status={highlighted ? "good" : "idle"}
            live={highlighted}
            className="!size-1.5"
          />
          <span className="l1-label text-[var(--l1-fg-dim)]">{plan}</span>
        </span>
        <span className="l1-readout text-[26px] font-semibold l1-engraved text-[var(--l1-fg)]">
          ${cost}
          <span className="ml-1 text-[12px] font-normal text-[var(--l1-muted-2)]">
            /mo
          </span>
        </span>
      </div>
      <p className="l1-readout mt-1.5 text-[11.5px] text-[var(--l1-muted)]">
        {included} seats included
        {extra > 0
          ? ` · ${extra} extra seat${extra === 1 ? "" : "s"} × $${extraRate}`
          : " · no extra seats"}
      </p>
    </div>
  );
}
