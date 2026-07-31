import {
  parseSelector,
  selectorMatches,
  simulationEndpoint,
  simulationTags,
} from "./selector";
import {
  type AclRule,
  aclKey,
  type PolicyDocument,
  type SimulateReason,
  type SimulateResult,
} from "./types";

type CompiledRule = {
  name: string;
  action: "allow" | "deny";
  scope: "organization" | "network";
  srcSelectors: ReturnType<typeof parseSelector>[];
  dstSelectors: ReturnType<typeof parseSelector>[];
  ports: Array<{ start: number; end: number }>;
  protocol: "tcp" | "udp" | "icmp" | "any";
  priority: number;
  orderIndex: number;
  posture: string[];
  enabled: boolean;
};

function parsePorts(specs: string[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const spec of specs) {
    const single = Number.parseInt(spec, 10);
    if (!Number.isNaN(single)) {
      out.push({ start: single, end: single });
      continue;
    }
    const dash = spec.split("-");
    if (dash.length === 2) {
      const start = Number.parseInt(dash[0] ?? "", 10);
      const end = Number.parseInt(dash[1] ?? "", 10);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        out.push({ start, end });
      }
    }
  }
  return out;
}

function parseProtocol(proto: string): CompiledRule["protocol"] {
  switch (proto.toLowerCase()) {
    case "tcp":
      return "tcp";
    case "udp":
      return "udp";
    case "icmp":
      return "icmp";
    default:
      return "any";
  }
}

function compileRules(doc: PolicyDocument): CompiledRule[] {
  const rules: CompiledRule[] = [];
  for (const acl of doc.acls.filter((a) => a.enabled)) {
    const srcs = acl.src.length > 0 ? acl.src : ["*"];
    const dsts = acl.dst.length > 0 ? acl.dst : ["*"];
    for (const src of srcs) {
      for (const dst of dsts) {
        rules.push({
          name: aclKey(acl),
          action: acl.action === "deny" ? "deny" : "allow",
          scope: acl.scope ?? "network",
          srcSelectors: [parseSelector(src)],
          dstSelectors: [parseSelector(dst)],
          ports: parsePorts(acl.ports),
          protocol: acl.protocol ? parseProtocol(acl.protocol) : "any",
          priority: acl.priority,
          orderIndex: acl.orderIndex ?? 0,
          posture: acl.posture,
          enabled: acl.enabled,
        });
      }
    }
  }
  return rules;
}

function endpointForSelector(sel: ReturnType<typeof parseSelector>): string {
  return (
    simulationEndpoint(sel) ??
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  );
}

function tagsForSelector(sel: ReturnType<typeof parseSelector>): string[] {
  return simulationTags(sel);
}

function portMatches(
  ports: Array<{ start: number; end: number }>,
  port: number | undefined,
  protocol?: string,
): boolean {
  if (ports.length === 0) {
    return true;
  }
  if (protocol === "icmp") {
    return true;
  }
  if (port === undefined) {
    return false;
  }
  return ports.some((range) => port >= range.start && port <= range.end);
}

function ruleMatches(
  rule: CompiledRule,
  srcEndpoint: string,
  srcTags: string[],
  dstEndpoint: string,
  dstTags: string[],
  port: number | undefined,
  parsedProto: CompiledRule["protocol"],
): boolean {
  const srcMatch = rule.srcSelectors.some((sel) =>
    selectorMatches(sel, srcEndpoint, srcTags),
  );
  const dstMatch = rule.dstSelectors.some((sel) =>
    selectorMatches(sel, dstEndpoint, dstTags),
  );
  if (!srcMatch || !dstMatch) {
    return false;
  }
  if (rule.protocol !== "any" && rule.protocol !== parsedProto) {
    return false;
  }
  return portMatches(rule.ports, port, parsedProto);
}

function phaseResult(
  rule: CompiledRule,
  reason: SimulateReason,
): SimulateResult {
  return {
    verdict: rule.action,
    reason,
    matchedRules: [rule.name],
    ruleSlug: rule.name,
    scope: rule.scope,
  };
}

function firstInPhase(
  rules: CompiledRule[],
  scope: "organization" | "network",
  action: "allow" | "deny",
  match: (rule: CompiledRule) => boolean,
  srcPostureOk: boolean,
  postureSkip: { current: CompiledRule | null },
): CompiledRule | null {
  const candidates = rules
    .filter((r) => r.enabled && r.scope === scope && r.action === action)
    .sort((a, b) => a.orderIndex - b.orderIndex || a.priority - b.priority);

  for (const rule of candidates) {
    if (!match(rule)) {
      continue;
    }
    if (rule.posture.length > 0 && !srcPostureOk) {
      if (!postureSkip.current) {
        postureSkip.current = rule;
      }
      continue;
    }
    return rule;
  }
  return null;
}

function evaluateRules(
  rules: CompiledRule[],
  srcEndpoint: string,
  srcTags: string[],
  dstEndpoint: string,
  dstTags: string[],
  port: number | undefined,
  protocol: string,
  defaultAction: "allow" | "deny",
  icmpPolicy: "allow" | "acl" | "deny",
  srcPostureOk: boolean,
): SimulateResult {
  const parsedProto = parseProtocol(protocol);

  if (parsedProto === "icmp") {
    if (icmpPolicy === "allow") {
      return {
        verdict: "allow",
        reason: "icmp_policy",
        matchedRules: ["builtin:icmp"],
      };
    }
    if (icmpPolicy === "deny") {
      return {
        verdict: "deny",
        reason: "icmp_policy",
        matchedRules: ["builtin:icmp"],
      };
    }
  }

  const match = (rule: CompiledRule) =>
    ruleMatches(
      rule,
      srcEndpoint,
      srcTags,
      dstEndpoint,
      dstTags,
      port,
      parsedProto,
    );
  const postureSkip: { current: CompiledRule | null } = { current: null };

  const orgDeny = firstInPhase(
    rules,
    "organization",
    "deny",
    match,
    srcPostureOk,
    postureSkip,
  );
  if (orgDeny) {
    return phaseResult(orgDeny, "org_deny");
  }

  const netDeny = firstInPhase(
    rules,
    "network",
    "deny",
    match,
    srcPostureOk,
    postureSkip,
  );
  if (netDeny) {
    return phaseResult(netDeny, "network_deny");
  }

  const netAllow = firstInPhase(
    rules,
    "network",
    "allow",
    match,
    srcPostureOk,
    postureSkip,
  );
  if (netAllow) {
    return phaseResult(netAllow, "network_allow");
  }

  if (postureSkip.current) {
    return {
      verdict: defaultAction,
      reason: "posture_skip",
      matchedRules: [postureSkip.current.name],
      ruleSlug: postureSkip.current.name,
      scope: postureSkip.current.scope,
    };
  }

  return {
    verdict: defaultAction,
    reason: defaultAction === "allow" ? "default_allow" : "default_deny",
    matchedRules: [],
  };
}

export function simulateDocument(
  doc: PolicyDocument,
  scenario: {
    src: string;
    dst: string;
    port?: number;
    protocol?: string;
    srcPostureOk?: boolean;
  },
): SimulateResult {
  const rules = compileRules(doc);
  const srcSel = parseSelector(scenario.src);
  const dstSel = parseSelector(scenario.dst);
  return evaluateRules(
    rules,
    endpointForSelector(srcSel),
    tagsForSelector(srcSel),
    endpointForSelector(dstSel),
    tagsForSelector(dstSel),
    scenario.port,
    scenario.protocol ?? "tcp",
    doc.default_action ?? "allow",
    doc.icmp_policy ?? "allow",
    scenario.srcPostureOk ?? true,
  );
}

export function compileAclRules(doc: PolicyDocument): AclRule[] {
  return doc.acls;
}
