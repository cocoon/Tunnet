import { type ReactNode, useEffect, useState } from "react";
import { Panel } from "#/components/shared/panel";

type NodeStatus = "good" | "warn" | "idle";

const NODES: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  status: NodeStatus;
  hub?: boolean;
  badge?: boolean;
}[] = [
  {
    id: "laptop",
    x: 70,
    y: 114,
    w: 100,
    h: 36,
    label: "LAPTOP",
    status: "good",
  },
  {
    id: "work",
    x: 70,
    y: 242,
    w: 100,
    h: 36,
    label: "WORKSTATION",
    status: "good",
  },
  {
    id: "ci",
    x: 70,
    y: 370,
    w: 100,
    h: 36,
    label: "CI-RUNNER",
    status: "good",
  },
  {
    id: "hub",
    x: 494,
    y: 236,
    w: 132,
    h: 48,
    label: "MESH FABRIC",
    sub: "encrypted by default",
    status: "good",
    hub: true,
  },
  {
    id: "edge",
    x: 512,
    y: 51,
    w: 96,
    h: 30,
    label: "EDGE",
    status: "good",
    badge: true,
  },
  { id: "api", x: 950, y: 120, w: 100, h: 36, label: "API-02", status: "good" },
  { id: "db", x: 950, y: 242, w: 100, h: 36, label: "DB-PROD", status: "warn" },
  { id: "gw", x: 950, y: 364, w: 100, h: 36, label: "GATEWAY", status: "good" },
];

const TRACES: {
  id: string;
  d: string;
  dur: number;
  begins: number[];
  reverse?: boolean;
}[] = [
  {
    id: "lap-hub",
    d: "M 170 132 H 360 V 236 H 486",
    dur: 3.6,
    begins: [-0.6, -2.3],
  },
  { id: "work-hub", d: "M 170 260 H 486", dur: 2.9, begins: [-0.2, -1.9] },
  {
    id: "ci-hub",
    d: "M 170 388 H 360 V 284 H 486",
    dur: 3.6,
    begins: [-1.1, -2.8],
  },
  {
    id: "hub-api",
    d: "M 634 236 V 138 H 950",
    dur: 3.4,
    begins: [-0.9, -2.5],
    reverse: true,
  },
  {
    id: "hub-db",
    d: "M 634 260 H 950",
    dur: 2.8,
    begins: [-0.4, -2.1],
    reverse: true,
  },
  {
    id: "hub-gw",
    d: "M 634 284 V 382 H 950",
    dur: 3.4,
    begins: [-1.3, -3.0],
    reverse: true,
  },
  { id: "hub-edge", d: "M 560 236 V 96", dur: 2.4, begins: [-0.5] },
];

const READOUTS = [
  { key: "PEERS", base: 14, delta: 1 },
  { key: "P50", base: 12, delta: 2, unit: "ms" },
  { key: "P95", base: 38, delta: 4, unit: "ms" },
  { key: "TUNNELS", base: 3, delta: 1 },
  { key: "EDGES", base: 2, delta: 0 },
  { key: "UPLINK", base: 9.2, delta: 0.6, unit: "Gb/s", dec: 1 },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useTickingReadouts() {
  const [vals, setVals] = useState(() =>
    READOUTS.map((r) => ({
      ...r,
      v: r.base,
      blink: false,
    })),
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      setVals((prev) =>
        prev.map((r, i) => {
          if (Math.random() < 0.45 && r.delta > 0) {
            const next = Math.max(
              1,
              r.v +
                (Math.random() < 0.5 ? -1 : 1) * (r.delta / (i > 4 ? 3 : 1)),
            );
            return { ...r, v: Number(next.toFixed(r.dec ?? 0)), blink: true };
          }
          return { ...r, blink: false };
        }),
      );
    }, 1400);
    return () => window.clearInterval(id);
  }, []);
  return vals;
}

export function MeshConsole({ className }: { className?: string }): ReactNode {
  const reduced = usePrefersReducedMotion();
  const readouts = useTickingReadouts();

  return (
    <Panel live screws raised className={className} bodyClassName="p-brushed">
      <div className="relative">
        <div
          aria-hidden
          className="p-perf pointer-events-none absolute inset-0 opacity-60"
        />
        <svg
          viewBox="0 0 1120 520"
          className="relative block w-full"
          role="img"
          aria-label="Animated mesh topology: devices, services and edges connected by copper traces with flowing packets"
          style={{ minHeight: 280 }}
        >
          {/* Base traces */}
          {TRACES.map((t) => (
            <path
              key={`base-${t.id}`}
              d={t.d}
              className="p-trace p-trace--dim"
            />
          ))}
          {/* Live copper dash */}
          {!reduced &&
            TRACES.map((t) => (
              <path
                key={`live-${t.id}`}
                d={t.d}
                className="p-trace-live"
                style={{ animationDelay: `${t.begins[0] ?? 0}s` }}
              />
            ))}
          {/* Packets */}
          {!reduced &&
            TRACES.map((t) =>
              t.begins.map((begin) => (
                <circle
                  key={`pkt-${t.id}-${begin}`}
                  r={2.6}
                  className="p-pkt-svg"
                  fill={
                    begin < 0 ? "oklch(0.79 0.13 150)" : "oklch(0.84 0.09 62)"
                  }
                >
                  <animateMotion
                    dur={`${t.dur}s`}
                    begin={`${begin}s`}
                    repeatCount="indefinite"
                    path={t.d}
                    keyPoints={t.reverse ? "1;0" : "0;1"}
                    keyTimes="0;1"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;0.06;0.94;1"
                    dur={`${t.dur}s`}
                    begin={`${begin}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              )),
            )}

          {/* Nodes */}
          {NODES.map((n) => (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={8}
                className={
                  n.hub ? "p-node-hub" : n.badge ? "p-node-badge" : "p-node"
                }
              />
              {n.hub ? (
                <rect
                  x={n.x + 1}
                  y={n.y + 1}
                  width={n.w - 2}
                  height={n.h - 2}
                  rx={7}
                  fill="oklch(0.75 0.115 58 / 0.12)"
                >
                  <animate
                    attributeName="opacity"
                    values="0.5;0.95;0.5"
                    dur="2.6s"
                    repeatCount="indefinite"
                  />
                </rect>
              ) : null}
              {/* status lamp */}
              <circle
                cx={n.x + n.w - 11}
                cy={n.y + 10}
                r={2.2}
                fill={
                  n.status === "warn"
                    ? "oklch(0.82 0.12 85)"
                    : n.status === "good"
                      ? "oklch(0.79 0.13 150)"
                      : "oklch(0.49 0.01 252)"
                }
              />
              {n.hub ? (
                <text
                  x={n.x + n.w / 2}
                  y={n.y + 21}
                  textAnchor="middle"
                  className="font-display"
                  fill="oklch(0.84 0.09 62)"
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                  }}
                >
                  {n.label}
                </text>
              ) : (
                <text
                  x={n.x + n.w / 2}
                  y={n.y + n.h / 2 + 4}
                  textAnchor="middle"
                  fill={
                    n.badge ? "oklch(0.75 0.115 58)" : "oklch(0.62 0.011 250)"
                  }
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                  }}
                >
                  {n.label}
                </text>
              )}
              {n.sub ? (
                <text
                  x={n.x + n.w / 2}
                  y={n.y + 37}
                  textAnchor="middle"
                  fill="oklch(0.49 0.01 252)"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {n.sub}
                </text>
              ) : null}
            </g>
          ))}
        </svg>

        {/* Readout strip */}
        <div className="relative flex flex-wrap items-center gap-x-7 gap-y-2 border-t border-[var(--l1-steel)] bg-[var(--l1-bezel)]/80 px-5 py-3.5">
          {readouts.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <span className="l1-label !text-[9.5px] text-[var(--l1-muted-2)]">
                {r.key}
              </span>
              <span
                className={`l1-readout text-[var(--l1-fg-dim)] ${r.blink ? "l1-anim-tick" : ""}`}
              >
                {r.v}
                {r.unit ?? ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
