import { useGSAP } from "@gsap/react";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  registerMarketingMotion,
  setupReveals,
} from "#/components/motion/landing-timeline";

type Cell = string | "yes" | "no";

const HEADERS = ["Free", "Team", "Business", "Enterprise"];

const RAW_ROWS: { label: string; cells: Cell[] }[] = [
  { label: "Price", cells: ["$0", "$29 /mo", "$149 /mo", "Custom"] },
  { label: "Seats", cells: ["3", "5", "15", "Custom"] },
  { label: "Additional seat", cells: ["-", "$5", "$8", "-"] },
  { label: "Resources", cells: ["20", "100", "500", "Unlimited"] },
  { label: "Managed traffic", cells: ["5 GB", "50 GB", "500 GB", "Custom"] },
  {
    label: "Mesh · Serve · Tunnel · Send · SSH",
    cells: ["yes", "yes", "yes", "yes"],
  },
  { label: "SSO / OIDC", cells: ["no", "yes", "yes", "yes"] },
  { label: "Roles & audit log", cells: ["no", "yes", "yes", "yes"] },
  { label: "SSH session recording", cells: ["no", "yes", "yes", "yes"] },
  { label: "REST API", cells: ["no", "yes", "yes", "yes"] },
  { label: "Public tunnels", cells: ["no", "yes", "yes", "yes"] },
  { label: "Policy as Code", cells: ["no", "no", "yes", "yes"] },
  { label: "Dedicated relays", cells: ["no", "no", "yes", "yes"] },
  { label: "Self-host control plane", cells: ["no", "no", "no", "yes"] },
  { label: "24/7 support & SLA", cells: ["no", "no", "no", "yes"] },
];

const ROWS = RAW_ROWS.map((r) => ({
  label: r.label,
  cols: HEADERS.map((h, i) => ({
    id: `${r.label}-${h}`,
    value: r.cells[i] as Cell,
  })),
}));

function Cell({ value }: { value: Cell }) {
  if (value === "yes")
    return <CheckIcon className="mx-auto size-4 text-[var(--l1-copper)]" />;
  if (value === "no")
    return <span className="l1-readout text-[var(--l1-muted-2)]">-</span>;
  return (
    <span className="l1-readout whitespace-nowrap text-[13px] text-[var(--l1-fg-dim)]">
      {value}
    </span>
  );
}

export function Comparison(): ReactNode {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      registerMarketingMotion();
      if (root.current) setupReveals(root.current);
    },
    { scope: root },
  );

  return (
    <section id="compare" className="relative px-5 pt-20 sm:px-8 sm:pt-24">
      <div className="mx-auto max-w-[1160px]">
        <div className="l1-reveal max-w-[46rem]">
          <h2 className="l1-h-section l1-engraved mt-5 text-[var(--l1-fg)]">
            Compare plans.
          </h2>
        </div>

        <div className="l1-reveal mt-9 overflow-hidden rounded-[var(--l1-r-lg)] border border-[var(--l1-steel)] bg-[var(--l1-panel)]/30">
          <div className="l1-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--l1-steel)]">
                  <th className="px-6 py-5 text-left">
                    <span className="l1-label !text-[10px] text-[var(--l1-muted-2)]">
                      plan
                    </span>
                  </th>
                  {HEADERS.map((h, i) => (
                    <th
                      key={h}
                      className={
                        i === 1
                          ? "border-l border-[oklch(0.75_0.115_58/0.3)] bg-[var(--l1-copper-soft)]/50 px-5 py-5 text-center"
                          : "border-l border-[var(--l1-steel)] px-5 py-5 text-center"
                      }
                    >
                      <span
                        className={
                          i === 1
                            ? "l1-label !text-[11px] text-[var(--l1-copper)]"
                            : "l1-label !text-[11px] text-[var(--l1-muted)]"
                        }
                      >
                        {h}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-[var(--l1-steel)] transition-colors last:border-0 hover:bg-[var(--l1-copper-faint)]"
                  >
                    <td className="px-6 py-4 text-[14px] text-[var(--l1-fg-dim)]">
                      {row.label}
                    </td>
                    {row.cols.map((col) => (
                      <td
                        key={col.id}
                        className={
                          col.id.endsWith("-Team")
                            ? "border-l border-[oklch(0.75_0.115_58/0.3)] bg-[var(--l1-copper-soft)]/25 px-5 py-4 text-center"
                            : "border-l border-[var(--l1-steel)] px-5 py-4 text-center"
                        }
                      >
                        <Cell value={col.value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
