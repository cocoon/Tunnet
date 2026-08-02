import { type ReactNode, useEffect, useState } from "react";

const FLOW: { d: string; dur: number; begins: number[]; reverse?: boolean }[] =
  [
    { d: "M 190 190 H 258", dur: 2.2, begins: [-0.3] },
    { d: "M 450 190 H 482", dur: 2.2, begins: [-0.9] },
    { d: "M 600 140 V 90 H 760", dur: 3.0, begins: [-0.5, -2.0] },
    { d: "M 680 190 H 760", dur: 2.4, begins: [-0.6] },
    { d: "M 600 240 V 290 H 760", dur: 3.0, begins: [-1.2] },
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

function Box({
  x,
  y,
  w,
  h,
  label,
  sub,
  hub = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  hub?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={9}
        className={hub ? "p-node-hub" : "p-node"}
      />
      {hub ? (
        <rect
          x={x + 1}
          y={y + 1}
          width={w - 2}
          height={h - 2}
          rx={8}
          fill="oklch(0.75 0.115 58 / 0.12)"
        />
      ) : null}
      <text
        x={x + w / 2}
        y={y + (sub ? h / 2 - 1 : h / 2 + 4)}
        textAnchor="middle"
        fill={hub ? "oklch(0.84 0.09 62)" : "oklch(0.72 0.011 250)"}
        style={{
          fontSize: 10.5,
          letterSpacing: "0.14em",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
        }}
      >
        {label}
      </text>
      {sub ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 14}
          textAnchor="middle"
          fill="oklch(0.49 0.01 252)"
          style={{
            fontSize: 9,
            letterSpacing: "0.1em",
            fontFamily: "var(--font-mono)",
          }}
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

export function ArchitectureDiagram(): ReactNode {
  const reduced = usePrefersReducedMotion();
  return (
    <svg
      viewBox="0 0 1120 380"
      className="block w-full"
      role="img"
      aria-label="Request flow: client through encrypted transport into the mesh fabric, gated by policy and audit, with self-hosted edge"
      style={{ minHeight: 220 }}
    >
      {FLOW.map((f) => (
        <path key={`base-${f.d}`} d={f.d} className="p-trace p-trace--dim" />
      ))}
      {!reduced &&
        FLOW.map((f) => (
          <path
            key={`live-${f.d}`}
            d={f.d}
            className="p-trace-live"
            style={{ animationDelay: `${f.begins[0]}s` }}
          />
        ))}
      {!reduced &&
        FLOW.map((f) =>
          f.begins.map((begin) => (
            <circle
              key={`pkt-${f.d}-${begin}`}
              r={2.5}
              className="p-pkt-svg"
              fill="oklch(0.84 0.09 62)"
            >
              <animateMotion
                dur={`${f.dur}s`}
                begin={`${begin}s`}
                repeatCount="indefinite"
                path={f.d}
                keyPoints={f.reverse ? "1;0" : "0;1"}
                keyTimes="0;1"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.08;0.92;1"
                dur={`${f.dur}s`}
                begin={`${begin}s`}
                repeatCount="indefinite"
              />
            </circle>
          )),
        )}

      <Box
        x={60}
        y={140}
        w={130}
        h={100}
        label="CLIENT NODE"
        sub="any laptop · server · runner"
      />
      <Box x={298} y={168} w={152} h={44} label="QUIC · TLS 1.3" />
      <Box
        x={520}
        y={140}
        w={160}
        h={100}
        label="MESH FABRIC"
        sub="one identity · one policy"
        hub
      />
      <Box
        x={800}
        y={60}
        w={170}
        h={60}
        label="POLICY ENGINE"
        sub="default-deny"
      />
      <Box
        x={800}
        y={160}
        w={170}
        h={60}
        label="AUDIT LOG"
        sub="everything is logged"
      />
      <Box
        x={800}
        y={260}
        w={170}
        h={60}
        label="EDGE"
        sub="your infra · your certs"
      />
    </svg>
  );
}
