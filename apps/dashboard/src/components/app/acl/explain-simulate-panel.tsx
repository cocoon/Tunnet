import type { Policy } from "@tunnet/api/management";
import {
  documentFromRows,
  resolveSimulationSelector,
  SelectorParseError,
  type SimulateReason,
  type SimulateResult,
  selectorToString,
  simulateDocument,
} from "@tunnet/policy-engine";
import { Badge } from "@tunnet/ui/components/badge";
import { Button } from "@tunnet/ui/components/button";
import { Input } from "@tunnet/ui/components/input";
import { Label } from "@tunnet/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tunnet/ui/components/select";
import { cn } from "@tunnet/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";
import type { EndpointLabelMap } from "@/components/app/acl/policy-labels";
import {
  buildPolicySelector,
  PolicySelectorFields,
} from "@/components/app/policy-selector-fields";

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

function selectorFieldToRaw(kind: string, value: string): string {
  return selectorToString(buildPolicySelector(kind, value));
}

function isSelectorReady(kind: string, value: string): boolean {
  if (kind === "any") return true;
  return value.trim().length > 0;
}

export function ExplainSimulatePanel({
  orgId,
  networkId,
  orgPolicies,
  networkPolicies,
  defaultAction,
  icmpPolicy = "allow",
  endpointLabels,
  className,
}: {
  orgId?: string;
  networkId?: string;
  orgPolicies: Policy[];
  networkPolicies: Policy[];
  defaultAction: "allow" | "deny";
  icmpPolicy?: "allow" | "acl" | "deny";
  endpointLabels?: EndpointLabelMap;
  className?: string;
}) {
  const [srcKind, setSrcKind] = useState("any");
  const [srcValue, setSrcValue] = useState("");
  const [dstKind, setDstKind] = useState("any");
  const [dstValue, setDstValue] = useState("");
  const [protocol, setProtocol] = useState("tcp");
  const [port, setPort] = useState("80");
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endpointEntries = useMemo(
    () =>
      [...(endpointLabels ?? new Map()).entries()].map(
        ([endpointId, name]) => ({
          endpointId,
          name,
        }),
      ),
    [endpointLabels],
  );

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

  const policyResetKey = useMemo(
    () =>
      [
        defaultAction,
        icmpPolicy,
        ...orgPolicies.map(
          (p) => `${p.id}:${p.orderIndex}:${p.enabled}:${p.action}`,
        ),
        ...networkPolicies.map(
          (p) => `${p.id}:${p.orderIndex}:${p.enabled}:${p.action}`,
        ),
      ].join("|"),
    [orgPolicies, networkPolicies, defaultAction, icmpPolicy],
  );

  const scenarioResetKey = [
    srcKind,
    srcValue,
    dstKind,
    dstValue,
    protocol,
    port,
  ].join("|");

  useEffect(() => {
    setResult(null);
    setError(null);
    void policyResetKey;
    void scenarioResetKey;
  }, [policyResetKey, scenarioResetKey]);

  function runSimulate() {
    setError(null);
    setResult(null);

    if (!isSelectorReady(srcKind, srcValue)) {
      setError("Choose a complete source selector.");
      return;
    }
    if (!isSelectorReady(dstKind, dstValue)) {
      setError("Choose a complete destination selector.");
      return;
    }

    try {
      const srcRaw = resolveSimulationSelector(
        selectorFieldToRaw(srcKind, srcValue),
        endpointEntries,
      );
      const dstRaw = resolveSimulationSelector(
        selectorFieldToRaw(dstKind, dstValue),
        endpointEntries,
      );
      const portNum = Number(port);
      const next = simulateDocument(doc, {
        src: srcRaw,
        dst: dstRaw,
        protocol,
        port:
          protocol === "icmp" || Number.isNaN(portNum) ? undefined : portNum,
        srcPostureOk: true,
      });
      setResult(next);
    } catch (err) {
      const message =
        err instanceof SelectorParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Simulation failed";
      setError(message);
    }
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
        <PolicySelectorFields
          orgId={orgId}
          networkId={networkId}
          label="Source"
          kind={srcKind}
          value={srcValue}
          onKindChange={(kind) => {
            setSrcKind(kind);
            setSrcValue("");
          }}
          onValueChange={setSrcValue}
        />
        <PolicySelectorFields
          orgId={orgId}
          networkId={networkId}
          label="Destination"
          kind={dstKind}
          value={dstValue}
          onKindChange={(kind) => {
            setDstKind(kind);
            setDstValue("");
          }}
          onValueChange={setDstValue}
        />
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
            onChange={setPort}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={runSimulate}>
          Simulate
        </Button>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </div>

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
