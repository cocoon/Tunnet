import type { Policy } from "@tunnet/api/management";
import {
  documentFromRows,
  type SimulateReason,
  type SimulateResult,
  simulateDocument,
} from "@tunnet/policy-engine";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function reasonInEnglish(
  reason: SimulateReason,
  result: SimulateResult,
): string {
  const rule = result.ruleSlug ? ` (rule: ${result.ruleSlug})` : "";
  switch (reason) {
    case "org_deny":
      return `Denied by an organization guardrail${rule}.`;
    case "network_deny":
      return `Denied by a network deny policy${rule}.`;
    case "network_allow":
      return `Allowed by a network allow policy${rule}.`;
    case "default_allow":
      return "No policy matched. Network is Open, so traffic is allowed.";
    case "default_deny":
      return "No policy matched. Network is Restricted, so traffic is denied.";
    case "icmp_policy":
      return result.verdict === "allow"
        ? "Allowed by the network ICMP policy."
        : "Denied by the network ICMP policy.";
    case "posture_skip":
      return `A matching rule required source posture that was not met${rule}; fell through to the default.`;
    default:
      return reason;
  }
}

function normalizeSelectorInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*" || trimmed.toLowerCase() === "any") {
    return "*";
  }
  return trimmed;
}

export function ExplainSimulatePanel({
  orgPolicies,
  networkPolicies,
  defaultAction,
  icmpPolicy = "allow",
  className,
}: {
  orgPolicies: Policy[];
  networkPolicies: Policy[];
  defaultAction: "allow" | "deny";
  icmpPolicy?: "allow" | "acl" | "deny";
  className?: string;
}) {
  const [src, setSrc] = useState("*");
  const [dst, setDst] = useState("*");
  const [protocol, setProtocol] = useState("tcp");
  const [port, setPort] = useState("80");
  const [result, setResult] = useState<SimulateResult | null>(null);

  const doc = useMemo(
    () =>
      documentFromRows({
        tags: [],
        hostAliases: [],
        ipSets: [],
        policies: [...orgPolicies, ...networkPolicies].map((p) => ({
          slug: p.slug ?? null,
          action: p.action,
          scope: p.scope,
          srcSelector: p.srcSelector,
          dstSelector: p.dstSelector,
          ports: p.ports,
          protocol: p.protocol,
          priority: p.priority,
          orderIndex: p.orderIndex,
          srcPosture: p.srcPosture ?? null,
          enabled: p.enabled,
        })),
        grants: [],
        sshPolicies: [],
        postures: [],
        autoApprovers: [],
        nodeAttributes: [],
        defaultAction,
        icmpPolicy,
      }),
    [orgPolicies, networkPolicies, defaultAction, icmpPolicy],
  );

  function runSimulate() {
    const portNum = Number(port);
    const next = simulateDocument(doc, {
      src: normalizeSelectorInput(src),
      dst: normalizeSelectorInput(dst),
      protocol,
      port: protocol === "icmp" || Number.isNaN(portNum) ? undefined : portNum,
      srcPostureOk: true,
    });
    setResult(next);
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <h2 className="text-sm font-medium">Explain access</h2>
        <p className="text-muted-foreground text-sm">
          Simulate a flow against the current policy document.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sim-src">Source</Label>
          <Input
            id="sim-src"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            placeholder="tag:eng or endpoint id"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-dst">Destination</Label>
          <Input
            id="sim-dst"
            value={dst}
            onChange={(e) => setDst(e.target.value)}
            placeholder="tag:db or endpoint id"
          />
        </div>
        <div className="space-y-2">
          <Label>Protocol</Label>
          <Select
            value={protocol}
            onValueChange={(v) => setProtocol(v ?? "tcp")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="udp">UDP</SelectItem>
              <SelectItem value="icmp">ICMP</SelectItem>
              <SelectItem value="any">Any</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-port">Port</Label>
          <Input
            id="sim-port"
            type="number"
            min={0}
            max={65535}
            value={port}
            disabled={protocol === "icmp"}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
      </div>

      <Button type="button" size="sm" onClick={runSimulate}>
        Simulate
      </Button>

      {result ? (
        <div
          className={cn(
            "rounded-lg border px-4 py-3",
            result.verdict === "allow"
              ? "border-emerald-600/25 bg-emerald-500/5"
              : "border-destructive/25 bg-destructive/5",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={result.verdict === "allow" ? "secondary" : "destructive"}
              className="capitalize"
            >
              {result.verdict}
            </Badge>
            <span className="text-muted-foreground font-mono text-xs">
              {result.reason}
            </span>
          </div>
          <p className="mt-2 text-sm">
            {reasonInEnglish(result.reason, result)}
          </p>
          {result.matchedRules.length > 0 ? (
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              Matched: {result.matchedRules.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
