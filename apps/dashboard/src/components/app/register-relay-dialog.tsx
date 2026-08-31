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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tunnet/ui/components/select";
import { Switch } from "@tunnet/ui/components/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyField } from "@/components/app/copy-field";
import { getControlPlaneUrl } from "@/lib/env";
import {
  useConnectivityRelays,
  useOrgRelayMutations,
} from "@/lib/queries/management";

type RegisterRelayDialogProps = {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RegisterRelayDialog({
  orgId,
  open,
  onOpenChange,
}: RegisterRelayDialogProps) {
  const { create } = useOrgRelayMutations(orgId);
  const { data: list } = useConnectivityRelays(orgId);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("unknown");
  const [url, setUrl] = useState("");
  const [accessMode, setAccessMode] = useState<
    "open" | "shared_token" | "http"
  >("open");
  const [qadEnabled, setQadEnabled] = useState(false);
  const [metricsUrl, setMetricsUrl] = useState("");
  const [registrationToken, setRegistrationToken] = useState<string | null>(
    null,
  );
  const [createdRelayId, setCreatedRelayId] = useState<string | null>(null);

  const createdRelay = list?.relays.find((r) => r.id === createdRelayId);
  const isHealthy = createdRelay?.status === "healthy";

  useEffect(() => {
    if (!createdRelayId || !isHealthy) return;
    toast.success("Relay connected and healthy");
  }, [createdRelayId, isHealthy]);

  function reset() {
    setName("");
    setRegion("unknown");
    setUrl("");
    setAccessMode("open");
    setQadEnabled(false);
    setMetricsUrl("");
    setRegistrationToken(null);
    setCreatedRelayId(null);
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
        url: url.trim(),
        accessMode,
        qadEnabled,
        metricsUrl: metricsUrl.trim() || null,
      });
      setRegistrationToken(result.registrationToken);
      setCreatedRelayId(result.relay.id);
      toast.success("Relay registered - copy the token before closing");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to register relay",
      );
    }
  }

  const command = registrationToken
    ? `tunnet-relay register --control-url ${getControlPlaneUrl()} --token ${registrationToken}`
    : "";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        {registrationToken ? (
          <>
            <DialogHeader>
              <DialogTitle>Relay registration token</DialogTitle>
              <DialogDescription>
                Run this command on your relay host. The token is shown only
                once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <CopyField label="Registration token" value={registrationToken} />
              <CopyField label="Register command" value={command} />
              {isHealthy ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                  Connected - relay is healthy
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Waiting for relay to connect… status updates automatically.
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
              <DialogTitle>Register connectivity relay</DialogTitle>
              <DialogDescription>
                Add an org-scoped{" "}
                <span className="font-mono">tunnet-relay</span> for mesh
                connectivity. Distinct from Edges (public tunnel ingress).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="relay-name">Name</Label>
                <Input
                  id="relay-name"
                  value={name}
                  onChange={setName}
                  placeholder="eu-relay-1"
                  pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="relay-region">Region</Label>
                <Input
                  id="relay-region"
                  value={region}
                  onChange={setRegion}
                  placeholder="eu-west"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="relay-url">Relay URL (optional)</Label>
                <Input
                  id="relay-url"
                  value={url}
                  onChange={setUrl}
                  placeholder="https://relay.example.com:443"
                />
              </div>
              <div className="space-y-2">
                <Label>Access mode</Label>
                <Select
                  value={accessMode}
                  onValueChange={(v) =>
                    setAccessMode(v as "open" | "shared_token" | "http")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="shared_token">Shared token</SelectItem>
                    <SelectItem value="http">HTTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="relay-qad">QAD enabled</Label>
                <Switch
                  id="relay-qad"
                  checked={qadEnabled}
                  onCheckedChange={setQadEnabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="relay-metrics">Metrics URL (optional)</Label>
                <Input
                  id="relay-metrics"
                  value={metricsUrl}
                  onChange={setMetricsUrl}
                  placeholder="https://metrics.example.com"
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
                {create.isPending ? "Registering..." : "Register relay"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
