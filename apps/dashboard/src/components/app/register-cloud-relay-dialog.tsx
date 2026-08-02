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
  useCloudRelayMutations,
  useCloudRelays,
} from "@/lib/queries/management";

type RegisterCloudRelayDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RegisterCloudRelayDialog({
  open,
  onOpenChange,
}: RegisterCloudRelayDialogProps) {
  const { create } = useCloudRelayMutations();
  const { data: relays } = useCloudRelays();
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

  const createdRelay = relays?.find((r) => r.id === createdRelayId);
  const isHealthy = createdRelay?.status === "healthy";

  useEffect(() => {
    if (!createdRelayId || !isHealthy) return;
    toast.success("Cloud relay connected and healthy");
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
      toast.success("Cloud relay registered - copy the token before closing");
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
              <DialogTitle>Cloud relay registration token</DialogTitle>
              <DialogDescription>
                Run this command on the relay host. The token is shown only
                once. This registers a deployment-wide connectivity relay.
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
              <DialogTitle>Register Cloud relay</DialogTitle>
              <DialogDescription>
                Add a deployment-wide connectivity relay available to all
                organizations (subject to each org&apos;s relay policy).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="cloud-relay-name">Name</Label>
                <Input
                  id="cloud-relay-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="cloud-eu-1"
                  pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloud-relay-region">Region</Label>
                <Input
                  id="cloud-relay-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="eu-west"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloud-relay-url">Relay URL (optional)</Label>
                <Input
                  id="cloud-relay-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://relay.tunnet.cloud:443"
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
                <Label htmlFor="cloud-relay-qad">QAD enabled</Label>
                <Switch
                  id="cloud-relay-qad"
                  checked={qadEnabled}
                  onCheckedChange={setQadEnabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloud-relay-metrics">
                  Metrics URL (optional)
                </Label>
                <Input
                  id="cloud-relay-metrics"
                  value={metricsUrl}
                  onChange={(e) => setMetricsUrl(e.target.value)}
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
