import type { Selector } from "@tunnet/api/management";

import { shortEndpointId } from "@/components/app/endpoint-combobox";
import { slugifyPolicyName } from "@/lib/slugify";

export type EndpointLabelMap = Map<string, string>;

export function buildEndpointLabelMap(
  machines: Array<{ endpointId: string; name: string }>,
): EndpointLabelMap {
  const map: EndpointLabelMap = new Map();
  for (const m of machines) {
    map.set(m.endpointId.toLowerCase(), m.name);
  }
  return map;
}

export function formatSelectorLabel(
  selector: Selector,
  endpoints?: EndpointLabelMap,
): string {
  if (selector.kind === "any") return "anyone";
  if (selector.kind === "tag") return `tag:${selector.value}`;
  if (selector.kind === "user") return `user:${selector.value}`;
  if (selector.kind === "network") return `network:${selector.value}`;
  if (selector.kind === "cidr") return selector.value;
  if (selector.kind === "endpoint") {
    const name = endpoints?.get(selector.value.toLowerCase());
    if (name) return name;
    return `machine ${shortEndpointId(selector.value)}`;
  }
  return String(selector);
}

export function selectorSlugToken(
  selector: Selector,
  endpoints?: EndpointLabelMap,
): string {
  if (selector.kind === "any") return "any";
  if (selector.kind === "tag")
    return slugifyPolicyName(selector.value) || "tag";
  if (selector.kind === "user") {
    const local = selector.value.split("@")[0] ?? selector.value;
    return slugifyPolicyName(local) || "user";
  }
  if (selector.kind === "network") {
    return slugifyPolicyName(selector.value) || "network";
  }
  if (selector.kind === "cidr") {
    return slugifyPolicyName(selector.value.replace(/\//g, "-")) || "cidr";
  }
  if (selector.kind === "endpoint") {
    const name = endpoints?.get(selector.value.toLowerCase());
    if (name) return slugifyPolicyName(name) || "machine";
    return "machine";
  }
  return "peer";
}

function portsSlugToken(
  ports: Array<{ start: number; end: number }> | undefined,
): string | null {
  if (!ports || ports.length === 0) return null;
  if (ports.length === 1) {
    const p = ports[0]!;
    return p.start === p.end ? String(p.start) : `${p.start}-${p.end}`;
  }
  if (ports.length <= 3) {
    return ports
      .map((p) => (p.start === p.end ? String(p.start) : `${p.start}-${p.end}`))
      .join("-");
  }
  return "ports";
}

export function suggestPolicySlug(input: {
  action: "allow" | "deny";
  src: Selector;
  dst: Selector;
  protocol?: string | null;
  ports?: Array<{ start: number; end: number }>;
  endpoints?: EndpointLabelMap;
}): string {
  const parts = [
    input.action,
    selectorSlugToken(input.src, input.endpoints),
    "to",
    selectorSlugToken(input.dst, input.endpoints),
  ];

  const proto =
    input.protocol && input.protocol !== "any"
      ? input.protocol.toLowerCase()
      : null;
  if (proto === "icmp") {
    parts.push("icmp");
  } else {
    if (proto) parts.push(proto);
    const portTok = portsSlugToken(input.ports);
    if (portTok) parts.push(portTok);
  }

  return slugifyPolicyName(parts.join("-")).slice(0, 64);
}
