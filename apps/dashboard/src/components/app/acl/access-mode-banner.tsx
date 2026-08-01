import type { Policy } from "@tunnet/api/management";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@tunnet/ui/components/alert-dialog";
import { Button } from "@tunnet/ui/components/button";
import { Label } from "@tunnet/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tunnet/ui/components/select";
import { cn } from "@tunnet/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

type AccessMode = "allow" | "deny";
type IcmpPolicy = "allow" | "acl" | "deny";

export function AccessModeBanner({
  defaultAction,
  icmpPolicy,
  networkPolicies = [],
  canManage = false,
  loading = false,
  onUpdateDefaultAction,
  onUpdateIcmpPolicy,
  onSuggestAllowAny,
  className,
}: {
  defaultAction: AccessMode;
  icmpPolicy: IcmpPolicy;
  networkPolicies?: Policy[];
  canManage?: boolean;
  loading?: boolean;
  onUpdateDefaultAction: (next: AccessMode) => Promise<void>;
  onUpdateIcmpPolicy: (next: IcmpPolicy) => Promise<void>;
  /** Optional: create a broad allow any→any suggestion when switching to Restricted. */
  onSuggestAllowAny?: () => void;
  className?: string;
}) {
  const isOpen = defaultAction === "allow";
  const [confirmRestricted, setConfirmRestricted] = useState(false);
  const [switching, setSwitching] = useState(false);

  const allowCount = networkPolicies.filter(
    (p) => p.action === "allow" && p.enabled !== false,
  ).length;

  async function switchMode(next: AccessMode) {
    setSwitching(true);
    try {
      await onUpdateDefaultAction(next);
      toast.success(
        next === "allow"
          ? "Switched to Open access mode"
          : "Switched to Restricted access mode",
      );
      setConfirmRestricted(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update access mode",
      );
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          className,
        )}
      >
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            Access mode: {isOpen ? "Open" : "Restricted"}
          </p>
          <p className="text-muted-foreground text-sm">
            {isOpen
              ? "Devices can communicate unless blocked by a policy."
              : "Traffic is denied unless an allow policy matches."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="icmp-policy"
              className="text-muted-foreground text-xs whitespace-nowrap"
            >
              ICMP
            </Label>
            <Select
              value={icmpPolicy}
              disabled={!canManage || loading}
              onValueChange={(v) => {
                if (!v) return;
                void onUpdateIcmpPolicy(v as IcmpPolicy).catch((err) => {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "Failed to update ICMP policy",
                  );
                });
              }}
            >
              <SelectTrigger id="icmp-policy" className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="acl">Follow ACL</SelectItem>
                <SelectItem value="deny">Deny</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || switching}
              onClick={() => {
                if (isOpen) {
                  setConfirmRestricted(true);
                } else {
                  void switchMode("allow");
                }
              }}
            >
              {isOpen ? "Switch to Restricted" : "Switch to Open"}
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog open={confirmRestricted} onOpenChange={setConfirmRestricted}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Restricted?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Unmatched traffic will be denied by default. Existing deny and
                allow policies still apply in order: organization deny → network
                deny → network allow → default deny.
              </span>
              {allowCount === 0 ? (
                <span className="text-destructive block font-medium">
                  This network has no allow policies. After switching,
                  essentially all traffic will be denied until you add allows.
                </span>
              ) : (
                <span className="block">
                  {allowCount} allow polic
                  {allowCount === 1 ? "y" : "ies"} will continue to permit
                  matching traffic.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            {allowCount === 0 && onSuggestAllowAny ? (
              <Button
                type="button"
                variant="secondary"
                className="sm:mr-auto"
                onClick={() => {
                  onSuggestAllowAny();
                  setConfirmRestricted(false);
                }}
              >
                Generate allow any→any
              </Button>
            ) : null}
            <AlertDialogCancel disabled={switching}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={switching}
              onClick={(e) => {
                e.preventDefault();
                void switchMode("deny");
              }}
            >
              {switching ? "Switching…" : "Switch to Restricted"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
