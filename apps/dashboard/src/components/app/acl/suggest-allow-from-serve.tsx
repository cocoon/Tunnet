import type { CreatePolicyBody, PatchPolicyBody } from "@tunnet/api/management";
import { Button } from "@tunnet/ui/components/button";
import { cn } from "@tunnet/ui/lib/utils";
import { useState } from "react";
import {
  type PolicyFormPrefill,
  PolicyFormSheet,
} from "@/components/app/acl/policy-form-sheet";

export function SuggestAllowFromServe({
  orgId,
  networkId,
  endpointId,
  localPort,
  protocol = "tcp",
  restricted,
  canManage = false,
  loading = false,
  onSubmit,
  className,
}: {
  orgId?: string;
  networkId: string;
  endpointId: string;
  localPort: number;
  protocol?: "tcp" | "udp";
  /** When true (Restricted / defaultAction=deny), show the banner. */
  restricted: boolean;
  canManage?: boolean;
  loading?: boolean;
  onSubmit: (body: CreatePolicyBody | PatchPolicyBody) => Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!restricted || !canManage || !localPort) {
    return null;
  }

  const prefill: PolicyFormPrefill = {
    action: "allow",
    srcKind: "any",
    srcValue: "",
    dstKind: "endpoint",
    dstValue: endpointId,
    protocol,
    ports: [{ start: localPort, end: localPort }],
  };

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          className,
        )}
      >
        <p className="text-sm">
          This service needs {protocol.toUpperCase()}/{localPort}. Create a
          matching allow rule?
        </p>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          Create allow rule
        </Button>
      </div>

      <PolicyFormSheet
        open={open}
        onOpenChange={setOpen}
        scope="network"
        orgId={orgId}
        networkId={networkId}
        defaultAction="deny"
        prefill={prefill}
        loading={loading}
        editing={null}
        onSubmit={async (body) => {
          await onSubmit(body);
          setOpen(false);
        }}
      />
    </>
  );
}
