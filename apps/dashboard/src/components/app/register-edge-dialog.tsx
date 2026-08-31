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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyField } from "@/components/app/copy-field";
import { getControlPlaneUrl } from "@/lib/env";
import { useEdgeMutations, useEdges } from "@/lib/queries/management";

type RegisterEdgeDialogProps = {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RegisterEdgeDialog({
  orgId,
  open,
  onOpenChange,
}: RegisterEdgeDialogProps) {
  const { create } = useEdgeMutations(orgId);
  const { data: edges } = useEdges(orgId);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("unknown");
  const [domain, setDomain] = useState("");
  const [publicIp, setPublicIp] = useState("");
  const [capacity, setCapacity] = useState("100");
  const [registrationToken, setRegistrationToken] = useState<string | null>(
    null,
  );
  const [createdEdgeId, setCreatedEdgeId] = useState<string | null>(null);

  const createdEdge = edges?.find((r) => r.id === createdEdgeId);
  const isHealthy = createdEdge?.status === "healthy";

  useEffect(() => {
    if (!createdEdgeId || !isHealthy) return;
    toast.success("Edge connected and healthy");
  }, [createdEdgeId, isHealthy]);

  function reset() {
    setName("");
    setRegion("unknown");
    setDomain("");
    setPublicIp("");
    setCapacity("100");
    setRegistrationToken(null);
    setCreatedEdgeId(null);
  }

  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        region: region.trim() || "unknown",
        domain: domain.trim(),
        publicIp: publicIp.trim() || undefined,
        capacityLimit: Number(capacity) || 100,
        kind: "self_hosted",
      });
      setRegistrationToken(result.registrationToken);
      setCreatedEdgeId(result.edge.id);
      toast.success("Edge registered - copy the token before closing");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to register edge",
      );
    }
  }

  const command = registrationToken
    ? `tunnet-edge register --control-url ${getControlPlaneUrl()} --token ${registrationToken}`
    : "";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        {registrationToken ? (
          <>
            <DialogHeader>
              <DialogTitle>Edge registration token</DialogTitle>
              <DialogDescription>
                Run this command on your edge host. The token is shown only
                once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <CopyField label="Registration token" value={registrationToken} />
              <CopyField label="Register command" value={command} />
              {isHealthy ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                  ✓ Connected - edge is healthy
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Waiting for edge to connect… status updates automatically.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <DialogHeader>
              <DialogTitle>Register edge</DialogTitle>
              <DialogDescription>
                Add a self-hosted edge that terminates public tunnels for your
                organization. Point wildcard DNS{" "}
                <span className="font-mono">*.your-domain</span> at the edge IP.
                Provide TLS via <span className="font-mono">--cert/--key</span>{" "}
                or <span className="font-mono">--acme-domain</span> (HTTP-01,
                non-wildcard).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edge-name">Name</Label>
                <Input
                  id="edge-name"
                  value={name}
                  onChange={setName}
                  placeholder="eu-edge-1"
                  pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edge-region">Region</Label>
                <Input
                  id="edge-region"
                  value={region}
                  onChange={setRegion}
                  placeholder="eu-west"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edge-domain">Domain</Label>
                <Input
                  id="edge-domain"
                  value={domain}
                  onChange={setDomain}
                  placeholder="tunnel.example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edge-ip">Public IP (optional)</Label>
                <Input
                  id="edge-ip"
                  value={publicIp}
                  onChange={setPublicIp}
                  placeholder="203.0.113.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edge-capacity">Capacity</Label>
                <Input
                  id="edge-capacity"
                  type="number"
                  min={1}
                  max={100000}
                  value={capacity}
                  onChange={setCapacity}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Registering..." : "Register edge"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
