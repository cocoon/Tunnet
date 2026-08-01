import type { Policy } from "@tunnet/api/management";
import { Badge } from "@tunnet/ui/components/badge";
import { cn } from "@tunnet/ui/lib/utils";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { describePolicyRule } from "@/components/app/acl/describe-policy";
import { buildEndpointLabelMap } from "@/components/app/acl/policy-labels";
import { useMachines } from "@/lib/queries/management";

function PolicyStackItem({
  policy,
  endpoints,
}: {
  policy: Policy;
  endpoints: ReturnType<typeof buildEndpointLabelMap>;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-sm">
      <span className="font-mono text-xs">
        {policy.slug ?? policy.id.slice(0, 8)}
      </span>
      <span className="text-muted-foreground text-xs">
        {describePolicyRule({
          action: policy.action,
          src: policy.srcSelector,
          dst: policy.dstSelector,
          protocol: policy.protocol,
          ports: policy.ports,
          endpoints,
          srcPosture: policy.srcPosture ?? undefined,
        })}
      </span>
      {!policy.enabled ? (
        <Badge variant="outline" className="text-[10px]">
          disabled
        </Badge>
      ) : null}
    </li>
  );
}

function StackSection({
  title,
  tone,
  items,
  empty,
  endpoints,
  children,
}: {
  title: string;
  tone: "deny" | "allow" | "default";
  items?: Policy[];
  empty?: string;
  endpoints: ReturnType<typeof buildEndpointLabelMap>;
  children?: ReactNode;
}) {
  const list = items ?? [];
  const showList = list.length > 0 || Boolean(children);
  return (
    <section
      className={cn(
        "rounded-lg border px-3 py-2.5",
        tone === "deny" && "border-destructive/25 bg-destructive/5",
        tone === "allow" && "border-emerald-600/20 bg-emerald-500/5",
        tone === "default" && "border-border/70 bg-muted/20",
      )}
    >
      <h3 className="text-[12px] font-medium tracking-tight">{title}</h3>
      {showList ? (
        <ul className="mt-1 divide-y divide-border/40">
          {list.map((p) => (
            <PolicyStackItem key={p.id} policy={p} endpoints={endpoints} />
          ))}
          {children}
        </ul>
      ) : empty ? (
        <p className="text-muted-foreground mt-1 text-xs">{empty}</p>
      ) : null}
    </section>
  );
}

export function EffectivePolicyPanel({
  orgId,
  orgPolicies,
  networkPolicies,
  defaultAction,
  className,
}: {
  orgId?: string;
  orgPolicies: Policy[];
  networkPolicies: Policy[];
  defaultAction: "allow" | "deny";
  className?: string;
}) {
  const { data: machines } = useMachines(orgId);
  const endpoints = useMemo(
    () =>
      buildEndpointLabelMap(
        (machines ?? []).map((m) => ({
          endpointId: m.endpointId,
          name: m.name,
        })),
      ),
    [machines],
  );

  const orgDeny = orgPolicies
    .filter((p) => p.action === "deny")
    .sort((a, b) => a.orderIndex - b.orderIndex || a.priority - b.priority);
  const netDeny = networkPolicies
    .filter((p) => p.action === "deny")
    .sort((a, b) => a.orderIndex - b.orderIndex || a.priority - b.priority);
  const netAllow = networkPolicies
    .filter((p) => p.action === "allow")
    .sort((a, b) => a.orderIndex - b.orderIndex || a.priority - b.priority);

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h2 className="text-sm font-medium">Effective policy stack</h2>
        <p className="text-muted-foreground text-sm">
          Denies are checked before allows; unmatched traffic follows the
          network access mode.
        </p>
      </div>

      <div className="relative space-y-2 pl-3 before:absolute before:top-2 before:bottom-2 before:left-0 before:w-px before:bg-border">
        <StackSection
          title="1. Organization Deny"
          tone="deny"
          items={orgDeny}
          empty="No organization deny policies."
          endpoints={endpoints}
        />
        <StackSection
          title="2. Network Deny"
          tone="deny"
          items={netDeny}
          empty="No network deny policies."
          endpoints={endpoints}
        />
        <StackSection
          title="3. Network Allow"
          tone="allow"
          items={netAllow}
          empty="No network allow policies."
          endpoints={endpoints}
        />
        <StackSection title="4. Default" tone="default" endpoints={endpoints}>
          <li className="py-1.5 text-sm">
            {defaultAction === "allow" ? (
              <>
                <span className="font-medium">Open</span>
                <span className="text-muted-foreground">
                  {" "}
                  - unmatched traffic is allowed
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">Restricted</span>
                <span className="text-muted-foreground">
                  {" "}
                  - unmatched traffic is denied
                </span>
              </>
            )}
          </li>
        </StackSection>
      </div>
    </div>
  );
}
