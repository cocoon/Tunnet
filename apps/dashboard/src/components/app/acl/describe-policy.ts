import type { Selector } from "@tunnet/api/management";

import {
  type EndpointLabelMap,
  formatSelectorLabel,
} from "@/components/app/acl/policy-labels";

export type DescribePolicyRuleInput = {
  action: "allow" | "deny";
  src: Selector;
  dst: Selector;
  protocol?: string | null;
  ports?: Array<{ start: number; end: number }>;
  /** Resolve endpoint IDs to machine names in the sentence. */
  endpoints?: EndpointLabelMap;
  srcPosture?: string[];
};

function formatPorts(
  ports: Array<{ start: number; end: number }> | undefined,
): string {
  if (!ports || ports.length === 0) return "any port";
  return ports
    .map((p) => (p.start === p.end ? String(p.start) : `${p.start}-${p.end}`))
    .join(", ");
}

function formatProtocol(
  protocol: string | null | undefined,
  ports: Array<{ start: number; end: number }> | undefined,
): string {
  const proto = !protocol || protocol === "any" ? null : protocol.toUpperCase();
  const portLabel = formatPorts(ports);

  if (protocol === "icmp") {
    return "ICMP";
  }

  if (proto) {
    if (portLabel === "any port") return `${proto} (any port)`;
    return `${proto} ${portLabel}`;
  }

  if (portLabel === "any port") return "any traffic";
  return `ports ${portLabel}`;
}

/** Human sentence for a policy rule, e.g. "Allow eng-laptop → db-1 on TCP 5432". */
export function describePolicyRule(input: DescribePolicyRuleInput): string {
  const verb = input.action === "allow" ? "Allow" : "Deny";
  const src = formatSelectorLabel(input.src, input.endpoints);
  const dst = formatSelectorLabel(input.dst, input.endpoints);
  const traffic = formatProtocol(input.protocol, input.ports);
  let sentence = `${verb} ${src} → ${dst} on ${traffic}`;
  if (input.srcPosture && input.srcPosture.length > 0) {
    sentence += ` when source passes ${input.srcPosture.join(" or ")}`;
  }
  return sentence;
}
