import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CapabilityGate } from "@/components/CapabilityGate";
import { CopyButton } from "@/components/CopyButton";
import { PeerTable } from "@/components/PeerTable";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useApp } from "@/lib/app-context";
import { useDirectNetwork } from "@/lib/direct-network-context";
import { api } from "@/lib/invoke";
import type { DirectPendingInfo, PeerSummary } from "@/lib/types";
import { appRoute } from "../app";

export const Route = createRoute({
  getParentRoute: () => appRoute,
  path: "/peers",
  component: PeersPage,
});

function PeersPage() {
  const { meta, node, hasPermission } = useApp();
  const { networkId, activeNetwork } = useDirectNetwork();
  const networkName = activeNetwork?.network_name;
  const isDirect = meta?.mode === "direct";
  const canAdmit = hasPermission("network.admit");

  const effectiveNetworkId = isDirect
    ? networkId
    : (node?.networks.find((n) => n.mode === "managed")?.network_id ?? "");

  const [peers, setPeers] = useState<PeerSummary[]>([]);
  const [requests, setRequests] = useState<DirectPendingInfo[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!effectiveNetworkId) return;
    const peerRes = await api.networkPeers(effectiveNetworkId);
    setPeers(peerRes.peers);

    if (isDirect && canAdmit) {
      const reqRes = await api.networkJoinRequests(effectiveNetworkId);
      setRequests(reqRes.requests);
    } else {
      setRequests([]);
    }
  }, [effectiveNetworkId, isDirect, canAdmit]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.directInvite({
        network: networkName || undefined,
      });
      setInviteCode(res.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function acceptPeer(peerId: string) {
    await api.networkJoinAccept(effectiveNetworkId, peerId);
    await load();
  }

  async function denyPeer(peerId: string) {
    await api.networkJoinDeny(effectiveNetworkId, peerId);
    await load();
  }

  async function kickPeer(peerId: string) {
    await api.directKick({
      network: networkName || undefined,
      peer_id: peerId,
    });
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Devices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People and machines on your network.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {isDirect ? (
        <div className="flex flex-wrap items-center gap-3">
          <CapabilityGate permission="network.invite">
            <Button
              disabled={busy || !networkId}
              onClick={() => void createInvite()}
            >
              {busy ? "Creating…" : "Invite device"}
            </Button>
          </CapabilityGate>
          {inviteCode ? (
            <div className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1">
              <code className="font-mono text-sm">{inviteCode}</code>
              <CopyButton value={inviteCode} label="Invite code" />
            </div>
          ) : null}
        </div>
      ) : null}

      {isDirect && requests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Join requests</CardTitle>
            <CardDescription>
              Peers waiting for admission to this network.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {requests.map((req) => (
              <div
                key={req.endpoint_id}
                className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <div className="font-medium">{req.hostname}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {req.ipv4}
                  </div>
                </div>
                <CapabilityGate permission="network.admit">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void acceptPeer(req.endpoint_id)}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void denyPeer(req.endpoint_id)}
                    >
                      Deny
                    </Button>
                  </div>
                </CapabilityGate>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <PeerTable
        peers={peers}
        showActions={isDirect}
        onKick={isDirect ? (id) => void kickPeer(id) : undefined}
      />
    </div>
  );
}
