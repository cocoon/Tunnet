import type {
  CreatePolicyBody,
  PatchPolicyBody,
  Policy,
  Selector,
} from "@tunnet/api/management";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@tunnet/ui/components/sheet";
import { cn } from "@tunnet/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { describePolicyRule } from "@/components/app/acl/describe-policy";
import {
  buildEndpointLabelMap,
  formatSelectorLabel,
  suggestPolicySlug,
} from "@/components/app/acl/policy-labels";
import {
  formatPortsInput,
  type PortRange,
  PortsInput,
} from "@/components/app/acl/ports-input";
import { PostureMultiSelect } from "@/components/app/acl/posture-multi-select";
import {
  buildPolicySelector,
  PolicySelectorFields,
  selectorKind,
  selectorValue,
} from "@/components/app/policy-selector-fields";
import { useMachines } from "@/lib/queries/management";
import slugify from "@/lib/slugify";

type Step = "effect" | "who" | "to" | "traffic" | "conditions" | "review";

const STEPS: Step[] = [
  "effect",
  "who",
  "to",
  "traffic",
  "conditions",
  "review",
];

const STEP_LABELS: Record<Step, string> = {
  effect: "Effect",
  who: "Who",
  to: "To",
  traffic: "Traffic",
  conditions: "Conditions",
  review: "Review",
};

export type PolicyFormPrefill = {
  action?: "allow" | "deny";
  srcKind?: string;
  srcValue?: string;
  dstKind?: string;
  dstValue?: string;
  protocol?: string;
  ports?: PortRange[];
  slug?: string;
  srcPosture?: string[];
};

export function PolicyFormSheet({
  open,
  onOpenChange,
  scope,
  editing = null,
  orgId,
  networkId,
  defaultAction = "allow",
  loading = false,
  prefill,
  nextOrderIndex = 0,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "organization" | "network";
  editing?: Policy | null;
  orgId?: string;
  networkId?: string;
  defaultAction?: "allow" | "deny";
  loading?: boolean;
  prefill?: PolicyFormPrefill | null;
  /** Default order for new policies (max existing + 1). */
  nextOrderIndex?: number;
  onSubmit: (body: CreatePolicyBody | PatchPolicyBody) => Promise<void>;
}) {
  const orgOnlyDeny = scope === "organization";
  const { data: machines } = useMachines(orgId);
  const endpointLabels = useMemo(
    () =>
      buildEndpointLabelMap(
        (machines ?? []).map((m) => ({
          endpointId: m.endpointId,
          name: m.name,
        })),
      ),
    [machines],
  );

  const [step, setStep] = useState<Step>("effect");
  const [action, setAction] = useState<"allow" | "deny">(
    orgOnlyDeny ? "deny" : "allow",
  );
  const [srcKind, setSrcKind] = useState("any");
  const [dstKind, setDstKind] = useState("any");
  const [srcValue, setSrcValue] = useState("");
  const [dstValue, setDstValue] = useState("");
  const [protocol, setProtocol] = useState("any");
  const [ports, setPorts] = useState<PortRange[]>([]);
  const [portsError, setPortsError] = useState<string | null>(null);
  const [srcPosture, setSrcPosture] = useState<string[]>([]);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [portsKey, setPortsKey] = useState(0);
  const [orderIndex, setOrderIndex] = useState(0);

  useEffect(() => {
    if (!open) return;

    if (editing) {
      setStep("effect");
      setAction(orgOnlyDeny ? "deny" : editing.action);
      setSrcKind(selectorKind(editing.srcSelector));
      setSrcValue(selectorValue(editing.srcSelector));
      setDstKind(selectorKind(editing.dstSelector));
      setDstValue(selectorValue(editing.dstSelector));
      setProtocol(editing.protocol ?? "any");
      setPorts(editing.ports ?? []);
      setPortsError(null);
      setSrcPosture(editing.srcPosture ?? []);
      setSlug(editing.slug ?? "");
      setSlugTouched(Boolean(editing.slug));
      setOrderIndex(editing.orderIndex);
      setPortsKey((k) => k + 1);
      return;
    }

    const initialAction = orgOnlyDeny ? "deny" : (prefill?.action ?? "allow");
    setStep("effect");
    setAction(initialAction);
    setSrcKind(prefill?.srcKind ?? "any");
    setSrcValue(prefill?.srcValue ?? "");
    setDstKind(prefill?.dstKind ?? "any");
    setDstValue(prefill?.dstValue ?? "");
    setProtocol(prefill?.protocol ?? "any");
    setPorts(prefill?.ports ?? []);
    setPortsError(null);
    setSrcPosture(prefill?.srcPosture ?? []);
    setSlug(prefill?.slug ?? "");
    setSlugTouched(Boolean(prefill?.slug));
    setOrderIndex(nextOrderIndex);
    setPortsKey((k) => k + 1);
  }, [open, editing, orgOnlyDeny, prefill, nextOrderIndex]);

  const srcSelector: Selector = buildPolicySelector(srcKind, srcValue);
  const dstSelector: Selector = buildPolicySelector(dstKind, dstValue);

  const description = useMemo(
    () =>
      describePolicyRule({
        action,
        src: srcSelector,
        dst: dstSelector,
        protocol,
        ports,
        endpoints: endpointLabels,
        srcPosture,
      }),
    [
      action,
      srcSelector,
      dstSelector,
      protocol,
      ports,
      endpointLabels,
      srcPosture,
    ],
  );

  const autoSlug = useMemo(
    () =>
      suggestPolicySlug({
        action,
        src: srcSelector,
        dst: dstSelector,
        protocol,
        ports,
        endpoints: endpointLabels,
      }),
    [action, srcSelector, dstSelector, protocol, ports, endpointLabels],
  );

  const effectiveSlug = slugTouched ? slugify(slug, 128) : autoSlug;

  const srcComplete = isSelectorComplete(srcKind, srcValue);
  const dstComplete = isSelectorComplete(dstKind, dstValue);
  const trafficComplete = !portsError;
  const formComplete =
    srcComplete && dstComplete && trafficComplete && Boolean(effectiveSlug);

  const stepIndex = STEPS.indexOf(step);

  function stepReachable(target: Step): boolean {
    const targetIndex = STEPS.indexOf(target);
    if (targetIndex <= stepIndex) return true;
    // Can only jump forward through completed earlier steps.
    if (!srcComplete && targetIndex > STEPS.indexOf("who")) return false;
    if (!dstComplete && targetIndex > STEPS.indexOf("to")) return false;
    if (!trafficComplete && targetIndex > STEPS.indexOf("traffic"))
      return false;
    return true;
  }

  const canAdvance = (() => {
    if (step === "who") return srcComplete;
    if (step === "to") return dstComplete;
    if (step === "traffic") return trafficComplete;
    if (step === "review") return formComplete;
    return true;
  })();

  const whoError =
    step === "who" && !srcComplete ? selectorRequiredMessage(srcKind) : null;
  const toError =
    step === "to" && !dstComplete ? selectorRequiredMessage(dstKind) : null;
  const reviewErrors =
    step === "review" && !formComplete
      ? [
          !srcComplete ? `Source: ${selectorRequiredMessage(srcKind)}` : null,
          !dstComplete
            ? `Destination: ${selectorRequiredMessage(dstKind)}`
            : null,
          !trafficComplete ? "Fix port ranges before saving." : null,
          !effectiveSlug ? "Enter a valid name (slug)." : null,
        ].filter(Boolean)
      : [];

  function applyTemplate(next: PolicyFormPrefill) {
    if (next.action && !orgOnlyDeny) setAction(next.action);
    if (next.srcKind) setSrcKind(next.srcKind);
    if (next.srcValue !== undefined) setSrcValue(next.srcValue);
    if (next.dstKind) setDstKind(next.dstKind);
    if (next.dstValue !== undefined) setDstValue(next.dstValue);
    if (next.protocol) setProtocol(next.protocol);
    if (next.ports) {
      setPorts(next.ports);
      setPortsError(null);
      setPortsKey((k) => k + 1);
    }
    if (next.srcPosture) setSrcPosture(next.srcPosture);
    if (next.slug) {
      setSlug(next.slug);
      setSlugTouched(true);
    } else {
      setSlugTouched(false);
      setSlug("");
    }
    // Jump to who/to if template left tag empty for user to fill.
    if (
      (next.srcKind === "tag" && !next.srcValue) ||
      (next.dstKind === "tag" && !next.dstValue)
    ) {
      setStep(next.srcKind === "tag" && !next.srcValue ? "who" : "to");
      return;
    }
    setStep("review");
  }

  async function handleSubmit() {
    if (!formComplete) return;

    const body: CreatePolicyBody = {
      action: orgOnlyDeny ? "deny" : action,
      srcSelector,
      dstSelector,
      protocol:
        protocol === "any" ? null : (protocol as "tcp" | "udp" | "icmp"),
      ports,
      priority: editing?.priority ?? 0,
      orderIndex: Number.isFinite(orderIndex) ? orderIndex : 0,
      enabled: editing?.enabled ?? true,
      slug: effectiveSlug,
      srcPosture,
    };

    await onSubmit(body);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl!"
      >
        <SheetHeader className="border-b border-border/60 px-6 py-4 text-left">
          <SheetTitle className="text-base">
            {editing
              ? "Edit policy"
              : scope === "organization"
                ? "Add organization deny"
                : "Add policy"}
          </SheetTitle>
          <SheetDescription>
            {scope === "organization"
              ? "Organization policies are Deny-only guardrails across every mesh."
              : "Define who can reach whom, on which protocol and ports."}
          </SheetDescription>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => {
              const reachable = stepReachable(s);
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={!reachable && s !== step}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      s === step
                        ? "bg-foreground text-background"
                        : i < stepIndex
                          ? "bg-muted text-foreground"
                          : reachable
                            ? "text-muted-foreground hover:bg-muted/60"
                            : "cursor-not-allowed text-muted-foreground/40",
                    )}
                    onClick={() => {
                      if (reachable || s === step) setStep(s);
                    }}
                  >
                    {i + 1}. {STEP_LABELS[s]}
                  </button>
                </li>
              );
            })}
          </ol>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {step === "effect" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Effect</Label>
                <div className="grid grid-cols-2 gap-2">
                  <EffectCard
                    title="Allow"
                    description="Permit matching traffic"
                    selected={action === "allow"}
                    disabled={orgOnlyDeny}
                    onClick={() => setAction("allow")}
                  />
                  <EffectCard
                    title="Deny"
                    description={
                      orgOnlyDeny
                        ? "Org policies can only deny"
                        : "Block matching traffic"
                    }
                    selected={action === "deny"}
                    onClick={() => setAction("deny")}
                  />
                </div>
              </div>

              {!editing ? (
                <div className="space-y-2">
                  <Label>Templates</Label>
                  <div className="flex flex-wrap gap-2">
                    {scope === "network" && defaultAction === "deny" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            applyTemplate({
                              action: "allow",
                              srcKind: "any",
                              srcValue: "",
                              dstKind: "any",
                              dstValue: "",
                              protocol: "tcp",
                              ports: [{ start: 80, end: 80 }],
                              slug: "allow-any-to-any-tcp-80",
                            })
                          }
                        >
                          Allow any → any TCP/80
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            applyTemplate({
                              action: "allow",
                              srcKind: "tag",
                              srcValue: "",
                              dstKind: "tag",
                              dstValue: "",
                              protocol: "tcp",
                              ports: [],
                            })
                          }
                        >
                          Allow tag → tag
                        </Button>
                      </>
                    ) : null}
                    {scope === "network" && defaultAction === "allow" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            applyTemplate({
                              action: "deny",
                              srcKind: "tag",
                              srcValue: "guest",
                              dstKind: "any",
                              dstValue: "",
                              protocol: "any",
                              ports: [],
                              slug: "deny-guest-to-any",
                            })
                          }
                        >
                          Deny guest → any
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            applyTemplate({
                              action: "deny",
                              srcKind: "any",
                              srcValue: "",
                              dstKind: "tag",
                              dstValue: "prod",
                              protocol: "tcp",
                              ports: [{ start: 22, end: 22 }],
                              slug: "deny-any-to-prod-tcp-22",
                            })
                          }
                        >
                          Deny any → prod SSH
                        </Button>
                      </>
                    ) : null}
                    {scope === "organization" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          applyTemplate({
                            action: "deny",
                            srcKind: "tag",
                            srcValue: "untrusted",
                            dstKind: "any",
                            dstValue: "",
                            protocol: "any",
                            ports: [],
                            slug: "deny-untrusted-to-any",
                          })
                        }
                      >
                        Deny untrusted → any
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "who" ? (
            <div className="space-y-2">
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
              {whoError ? (
                <p className="text-destructive text-xs">{whoError}</p>
              ) : null}
            </div>
          ) : null}

          {step === "to" ? (
            <div className="space-y-2">
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
              {toError ? (
                <p className="text-destructive text-xs">{toError}</p>
              ) : null}
            </div>
          ) : null}

          {step === "traffic" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Protocol</Label>
                <Select
                  value={protocol}
                  onValueChange={(v) => setProtocol(v ?? "any")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="icmp">ICMP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {protocol === "icmp" ? (
                <p className="text-muted-foreground text-xs">
                  ICMP ignores port ranges. Network ICMP policy may still
                  override ACL evaluation.
                </p>
              ) : (
                <PortsInput
                  key={portsKey}
                  value={ports}
                  onChange={(next, error) => {
                    setPorts(next);
                    setPortsError(error);
                  }}
                />
              )}
            </div>
          ) : null}

          {step === "conditions" ? (
            <div className="space-y-2">
              <Label>Source posture</Label>
              <PostureMultiSelect
                orgId={orgId}
                networkId={networkId}
                value={srcPosture}
                onChange={setSrcPosture}
              />
            </div>
          ) : null}

          {step === "review" ? (
            <div className="space-y-4">
              {reviewErrors.length > 0 ? (
                <div className="border-destructive/30 bg-destructive/5 rounded-lg border px-3 py-2">
                  <p className="text-destructive text-xs font-medium">
                    Finish these before creating:
                  </p>
                  <ul className="text-destructive mt-1 list-inside list-disc text-xs">
                    {reviewErrors.map((err) => (
                      <li key={String(err)}>{err}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="rounded-lg border border-border/70 bg-muted/30 px-4 py-3">
                <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Rule
                </p>
                <p className="mt-1 text-sm leading-relaxed">{description}</p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <ReviewField
                    label="From"
                    value={formatSelectorLabel(srcSelector, endpointLabels)}
                  />
                  <ReviewField
                    label="To"
                    value={formatSelectorLabel(dstSelector, endpointLabels)}
                  />
                  <ReviewField
                    label="Traffic"
                    value={
                      protocol === "icmp"
                        ? "ICMP"
                        : `${(protocol === "any" ? "any" : protocol).toUpperCase()}${
                            ports.length
                              ? ` · ${formatPortsInput(ports)}`
                              : " · any port"
                          }`
                    }
                  />
                  <ReviewField
                    label="Posture"
                    value={
                      srcPosture.length > 0
                        ? srcPosture.join(" or ")
                        : "None required"
                    }
                  />
                </dl>
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy-slug">Name (slug)</Label>
                <Input
                  id="policy-slug"
                  value={slugTouched ? slug : autoSlug}
                  onChange={(value) => {
                    setSlugTouched(true);
                    setSlug(value);
                  }}
                  placeholder="allow-eng-to-db-tcp-5432"
                />
                <p className="text-muted-foreground text-xs">
                  Short identifier for GitOps and the policy table.
                  {effectiveSlug ? (
                    <>
                      {" "}
                      <span className="font-mono text-foreground/80">
                        {effectiveSlug}
                      </span>
                    </>
                  ) : (
                    " Enter letters or numbers."
                  )}
                </p>
                {slugTouched ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setSlugTouched(false);
                      setSlug("");
                    }}
                  >
                    Reset to suggested name
                  </Button>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy-order">Order</Label>
                <Input
                  id="policy-order"
                  type="number"
                  min={0}
                  step={1}
                  value={String(orderIndex)}
                  onChange={(value) => {
                    const n = Number.parseInt(value, 10);
                    setOrderIndex(Number.isNaN(n) ? 0 : n);
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Lower values are evaluated first within the same action phase.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <SheetFooter className="border-t border-border/60 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={stepIndex === 0}
            onClick={() => {
              const previousStep = STEPS[stepIndex - 1];
              if (previousStep) setStep(previousStep);
            }}
          >
            Back
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {step !== "review" ? (
              <Button
                type="button"
                disabled={!canAdvance}
                onClick={() => {
                  const nextStep = STEPS[stepIndex + 1];
                  if (nextStep) setStep(nextStep);
                }}
              >
                Continue
              </Button>
            ) : (
              <Button
                type="button"
                disabled={loading || !canAdvance}
                onClick={() => void handleSubmit()}
              >
                {loading
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create policy"}
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function isSelectorComplete(kind: string, value: string): boolean {
  if (kind === "any") return true;
  return value.trim().length > 0;
}

function selectorRequiredMessage(kind: string): string {
  switch (kind) {
    case "endpoint":
      return "Select a machine.";
    case "tag":
      return "Select a tag.";
    case "cidr":
      return "Enter a CIDR (e.g. 10.0.0.0/8).";
    case "network":
      return "Enter a network name.";
    case "user":
      return "Enter a user email.";
    default:
      return "Complete this field.";
  }
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium wrap-break-word">{value}</dd>
    </div>
  );
}

function EffectCard({
  title,
  description,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-3 text-left transition-colors",
        selected
          ? "border-foreground bg-muted/40"
          : "border-border/70 hover:bg-muted/30",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
    </button>
  );
}
