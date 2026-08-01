import { Button } from "@tunnet/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tunnet/ui/components/dialog";
import { Input } from "@tunnet/ui/components/input";
import { Label } from "@tunnet/ui/components/label";
import { cn } from "@tunnet/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { useNetworkMutations } from "@/lib/queries/management";

type CreateNetworkDialogProps = {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateNetworkDialog({
  orgId,
  open,
  onOpenChange,
}: CreateNetworkDialogProps) {
  const { create } = useNetworkMutations(orgId);
  const [name, setName] = useState("");
  const [cidr, setCidr] = useState("10.7.0.0/24");
  const [mtu, setMtu] = useState("1280");
  const [defaultAction, setDefaultAction] = useState<"allow" | "deny">("allow");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({
        name: name.trim(),
        cidr,
        mtu: Number(mtu) || 1280,
        defaultAction,
      });
      toast.success("Network created");
      setName("");
      setCidr("10.7.0.0/24");
      setMtu("1280");
      setDefaultAction("allow");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create network",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Create network</DialogTitle>
            <DialogDescription>
              Networks define the virtual address space for your machines.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="network-name">Name</Label>
              <Input
                id="network-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="production"
                pattern="[a-z0-9-]{3,32}"
                required
              />
              <p className="text-muted-foreground text-xs">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="network-cidr">CIDR</Label>
              <Input
                id="network-cidr"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="network-mtu">MTU</Label>
              <Input
                id="network-mtu"
                type="number"
                min={576}
                max={9000}
                value={mtu}
                onChange={(e) => setMtu(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Access mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDefaultAction("allow")}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition-colors",
                    defaultAction === "allow"
                      ? "border-foreground bg-muted/40"
                      : "border-border/70 hover:bg-muted/30",
                  )}
                >
                  <p className="text-sm font-medium">Open</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Allow unless a deny policy matches
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDefaultAction("deny")}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition-colors",
                    defaultAction === "deny"
                      ? "border-foreground bg-muted/40"
                      : "border-border/70 hover:bg-muted/30",
                  )}
                >
                  <p className="text-sm font-medium">Restricted</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Deny unless an allow policy matches
                  </p>
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating..." : "Create network"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
