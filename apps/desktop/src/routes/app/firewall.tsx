import { createRoute, redirect } from "@tanstack/react-router";
import { Badge } from "@tunnet/ui/components/badge";
import { Button } from "@tunnet/ui/components/button";
import { Card } from "@tunnet/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tunnet/ui/components/table";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CapabilityGate } from "@/components/CapabilityGate";
import { useDirectNetwork } from "@/lib/direct-network-context";
import { api } from "@/lib/invoke";
import type { DirectFirewallResponse } from "@/lib/types";
import { appRoute } from "../app";

export const Route = createRoute({
  getParentRoute: () => appRoute,
  path: "/firewall",
  beforeLoad: async () => {
    const probe = await api.daemonProbe();
    if (probe.meta?.mode === "managed") {
      throw redirect({ to: "/app" });
    }
  },
  component: FirewallPage,
});

function FirewallPage() {
  const { activeNetwork, networkId } = useDirectNetwork();
  const networkName = activeNetwork?.network_name;
  const [firewall, setFirewall] = useState<DirectFirewallResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState("in");
  const [action, setAction] = useState("allow");
  const [protocol, setProtocol] = useState("tcp");
  const [port, setPort] = useState("443");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!networkId) return;
    const res = await api.networkFirewall(networkId);
    setFirewall(res);
  }, [networkId]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  async function addRule() {
    setBusy(true);
    setError(null);
    try {
      await api.directFirewallAdd({
        network: networkName || undefined,
        direction,
        action,
        protocol,
        port,
      });
      await load();
      setOpen(false);
      setPort("443");
      toast.success("Rule added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(index: number) {
    try {
      await api.directFirewallRemove({
        network: networkName || undefined,
        index,
      });
      await load();
      toast.success("Rule removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const rules = firewall?.rules ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Firewall</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Control which traffic is allowed between devices on this network.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              firewall?.enabled
                ? "border-success/30 bg-success/10 text-success"
                : undefined
            }
          >
            {firewall?.enabled ? "Protecting" : "Off"}
          </Badge>
          <CapabilityGate permission="firewall.write">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger render={<Button size="sm" />}>
                Add rule
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add firewall rule</DialogTitle>
                  <DialogDescription>
                    Allow or block a port for devices on this network.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label>Direction</Label>
                    <Select
                      value={direction}
                      onValueChange={(v) => setDirection(v ?? "in")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in">Incoming</SelectItem>
                        <SelectItem value="out">Outgoing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Action</Label>
                    <Select
                      value={action}
                      onValueChange={(v) => setAction(v ?? "allow")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="allow">Allow</SelectItem>
                        <SelectItem value="deny">Block</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="fw-protocol">Protocol</Label>
                      <Input
                        id="fw-protocol"
                        value={protocol}
                        onChange={setProtocol}
                        placeholder="tcp"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="fw-port">Port</Label>
                      <Input
                        id="fw-port"
                        value={port}
                        onChange={setPort}
                        placeholder="443"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={busy || !port.trim()}
                    onClick={() => void addRule()}
                  >
                    {busy ? "Adding…" : "Add rule"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CapabilityGate>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card className="overflow-hidden py-0 shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Direction</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Ports</TableHead>
              <TableHead>Device</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  No custom rules yet. Traffic follows the default policy.
                </TableCell>
              </TableRow>
            ) : (
              rules.map((rule) => (
                <TableRow key={rule.index}>
                  <TableCell className="capitalize">
                    {rule.direction === "in" ? "Incoming" : "Outgoing"}
                  </TableCell>
                  <TableCell className="capitalize">
                    {rule.action === "deny" ? "Block" : "Allow"}
                  </TableCell>
                  <TableCell className="uppercase">{rule.protocol}</TableCell>
                  <TableCell className="font-mono">
                    {rule.ports ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {rule.peer ?? "Any"}
                  </TableCell>
                  <TableCell>
                    <CapabilityGate permission="firewall.write">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive"
                        onClick={() => void removeRule(rule.index)}
                      >
                        Remove
                      </Button>
                    </CapabilityGate>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
