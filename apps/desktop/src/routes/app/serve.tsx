import { createRoute } from "@tanstack/react-router";
import { Button } from "@tunnet/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { Input } from "@tunnet/ui/components/input";
import { Progress } from "@tunnet/ui/components/progress";
import { useCallback, useEffect, useState } from "react";
import { CapabilityGate } from "@/components/CapabilityGate";
import { api } from "@/lib/invoke";
import type { ServeInfo, TransferInfo, TunnelInfo } from "@/lib/types";
import { appRoute } from "../app";

export const Route = createRoute({
  getParentRoute: () => appRoute,
  path: "/serve",
  component: ServePage,
});

function isIncomingPending(transfer: TransferInfo): boolean {
  return (
    transfer.direction === "inbound" &&
    (transfer.status === "pending" || transfer.status === "offered")
  );
}

function ServePage() {
  const [serves, setServes] = useState<ServeInfo[]>([]);
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [transfers, setTransfers] = useState<TransferInfo[]>([]);
  const [servePort, setServePort] = useState("8080");
  const [tunnelPort, setTunnelPort] = useState("3000");
  const [sendPath, setSendPath] = useState("");
  const [sendTarget, setSendTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [serveRes, tunnelRes, transferRes] = await Promise.all([
      api.servesList(),
      api.tunnelsList(),
      api.transfersList(),
    ]);
    setServes(serveRes.serves);
    setTunnels(tunnelRes.tunnels);
    setTransfers(transferRes.transfers);
  }, []);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  return (
    <div className="space-y-8">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Serve</h2>
        <CapabilityGate permission="serve">
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-32"
              value={servePort}
              onChange={setServePort}
              placeholder="Port"
            />
            <Button
              onClick={() =>
                void api
                  .servesStart({
                    port: Number(servePort),
                    // Local desktop serve is TCP; HTTPS serves need dashboard certs.
                    protocol: "tcp",
                  })
                  .then(() => load())
                  .catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  )
              }
            >
              Start serve
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Starts a TCP mesh serve. Create HTTPS serves from the management
            dashboard (certificates are pushed over WebSocket).
          </p>
        </CapabilityGate>
        <ResourceList
          items={serves.map((s) => ({
            id: s.id,
            label: `${s.port} · ${s.url} (${s.status})`,
            onStop: () => void api.servesOff(s.port).then(() => load()),
          }))}
          empty="No active serves"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Tunnels</h2>
        <CapabilityGate permission="tunnel">
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-32"
              value={tunnelPort}
              onChange={setTunnelPort}
              placeholder="Port"
            />
            <Button
              onClick={() =>
                void api
                  .tunnelsStart({ port: Number(tunnelPort) })
                  .then(() => load())
              }
            >
              Start tunnel
            </Button>
          </div>
        </CapabilityGate>
        <ResourceList
          items={tunnels.map((t) => ({
            id: t.id,
            label: `${t.port} · ${t.public_url}`,
            onStop: () => void api.tunnelsOff(t.port).then(() => load()),
          }))}
          empty="No active tunnels"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Transfers</h2>
        <CapabilityGate permission="send">
          <div className="grid gap-2 md:grid-cols-3">
            <Input
              value={sendPath}
              onChange={setSendPath}
              placeholder="File path"
            />
            <Input
              value={sendTarget}
              onChange={setSendTarget}
              placeholder="Target peer"
            />
            <Button
              onClick={() =>
                void api
                  .transfersSend({ path: sendPath, target: sendTarget })
                  .then(() => load())
              }
            >
              Send file
            </Button>
          </div>
        </CapabilityGate>
        <TransferList transfers={transfers} onAction={() => void load()} />
      </section>
    </div>
  );
}

function ResourceList({
  items,
  empty,
}: {
  items: { id: string; label: string; onStop?: () => void }[];
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {empty}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <span className="font-mono">{item.label}</span>
            {item.onStop ? (
              <Button size="xs" variant="outline" onClick={item.onStop}>
                Stop
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TransferList({
  transfers,
  onAction,
}: {
  transfers: TransferInfo[];
  onAction: () => void;
}) {
  if (transfers.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No active transfers
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {transfers.map((transfer) => {
        const pending = isIncomingPending(transfer);
        return (
          <Card key={transfer.transfer_id} size="sm">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm">
                {transfer.file_name}
              </CardTitle>
              <CardDescription>
                {transfer.direction === "inbound" ? "from" : "to"}{" "}
                {transfer.peer_hostname ?? transfer.peer_endpoint_id} ·{" "}
                {transfer.status}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={transfer.percent} />
              {pending ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void api
                        .transfersAccept(transfer.transfer_id)
                        .then(onAction)
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void api
                        .transfersReject(transfer.transfer_id)
                        .then(onAction)
                    }
                  >
                    Reject
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
