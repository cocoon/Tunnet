export type ParsedSelector =
  | { kind: "any" }
  | { kind: "endpoint"; value: string }
  | { kind: "tag"; value: string }
  | { kind: "network"; value: string }
  | { kind: "cidr"; value: string }
  | { kind: "user"; value: string }
  | { kind: "host_alias"; value: string }
  | { kind: "ip_set"; value: string };

export class SelectorParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectorParseError";
  }
}

export type EndpointResolveEntry = {
  endpointId: string;
  name: string;
};

function isEndpointHex(s: string): boolean {
  return s.length >= 16 && s.length <= 64 && /^[0-9a-fA-F]+$/.test(s);
}

function looksLikeCidr(s: string): boolean {
  return /^[\d.:a-fA-F/]+$/.test(s) && s.includes("/");
}

function hasKnownPrefix(s: string): boolean {
  return (
    s.startsWith("tag:") ||
    s.startsWith("user:") ||
    s.startsWith("host:") ||
    s.startsWith("ipset:") ||
    s.startsWith("network:") ||
    s.startsWith("machine:") ||
    s.startsWith("group:")
  );
}

function matchesShortEndpointId(endpointId: string, short: string): boolean {
  const id = endpointId.toLowerCase();
  const token = short.trim().toLowerCase();
  if (!token) return false;
  if (id === token) return true;
  // UI short form: first6…last4 (ellipsis may be `…` or `...`)
  const parts = token.split(/…|\.\.\./);
  if (parts.length === 2) {
    const [prefix, suffix] = parts;
    if (prefix && suffix && id.startsWith(prefix) && id.endsWith(suffix)) {
      return true;
    }
  }
  return id.startsWith(token) || id.endsWith(token);
}

export function parseSelector(raw: string): ParsedSelector {
  const s = raw.trim();
  if (!s) {
    throw new SelectorParseError("empty selector");
  }
  if (s === "*") {
    return { kind: "any" };
  }
  if (s.startsWith("tag:")) {
    return { kind: "tag", value: s.slice(4) };
  }
  if (s.startsWith("user:")) {
    return { kind: "user", value: s.slice(5) };
  }
  if (s.startsWith("network:")) {
    return { kind: "network", value: s.slice(8) };
  }
  if (s.startsWith("group:user:") || s.startsWith("group:device:")) {
    throw new SelectorParseError(`unsupported group selector: ${s}`);
  }
  if (s.startsWith("host:")) {
    return { kind: "host_alias", value: s.slice(5) };
  }
  if (s.startsWith("ipset:")) {
    return { kind: "ip_set", value: s.slice(6) };
  }
  if (looksLikeCidr(s)) {
    return { kind: "cidr", value: s };
  }
  if (isEndpointHex(s)) {
    return { kind: "endpoint", value: s };
  }
  throw new SelectorParseError(`invalid selector syntax: ${s}`);
}

/**
 * Resolve human-friendly simulator input to a parseable selector string.
 * Accepts hostnames from endpoint labels, `machine:<shortId>`, and standard prefixes.
 */
export function resolveSimulationSelector(
  raw: string,
  endpoints: EndpointResolveEntry[] = [],
): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*" || trimmed.toLowerCase() === "any") {
    return "*";
  }

  if (trimmed.toLowerCase().startsWith("machine:")) {
    const short = trimmed.slice("machine:".length);
    const match = endpoints.find((e) =>
      matchesShortEndpointId(e.endpointId, short),
    );
    if (match) {
      return match.endpointId;
    }
    throw new SelectorParseError(`unknown machine selector: ${trimmed}`);
  }

  if (
    hasKnownPrefix(trimmed) ||
    looksLikeCidr(trimmed) ||
    isEndpointHex(trimmed)
  ) {
    // Validate; throws SelectorParseError on bad syntax.
    parseSelector(trimmed);
    return trimmed;
  }

  const byName = endpoints.find(
    (e) => e.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (byName) {
    return byName.endpointId;
  }

  throw new SelectorParseError(
    `unknown selector "${trimmed}". Use a machine name, tag:…, network:…, user:…, CIDR, or endpoint id.`,
  );
}

export function simulationTags(parsed: ParsedSelector): string[] {
  switch (parsed.kind) {
    case "any":
    case "endpoint":
    case "cidr":
      return [];
    case "tag":
      return [parsed.value];
    case "network":
      return [`network:${parsed.value}`, parsed.value];
    case "user":
      return [`user:${parsed.value}`, parsed.value];
    case "host_alias":
      return [`host:${parsed.value}`];
    case "ip_set":
      return [`ipset:${parsed.value}`];
  }
}

export function simulationEndpoint(parsed: ParsedSelector): string | undefined {
  if (parsed.kind === "endpoint") {
    return parsed.value;
  }
  return undefined;
}

export function selectorMatches(
  parsed: ParsedSelector,
  endpointHex: string,
  tags: string[],
): boolean {
  switch (parsed.kind) {
    case "any":
      return true;
    case "endpoint":
      return endpointHex.toLowerCase() === parsed.value.toLowerCase();
    case "tag":
      return tags.includes(parsed.value);
    case "network":
      return (
        tags.includes(`network:${parsed.value}`) || tags.includes(parsed.value)
      );
    case "user":
      return (
        tags.includes(`user:${parsed.value}`) || tags.includes(parsed.value)
      );
    case "host_alias":
      return tags.includes(`host:${parsed.value}`);
    case "ip_set":
      return tags.includes(`ipset:${parsed.value}`);
    case "cidr":
      return false;
  }
}
