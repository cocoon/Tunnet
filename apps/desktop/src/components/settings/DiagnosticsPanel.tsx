import { Badge } from "@tunnet/ui/components/badge";
import { Button } from "@tunnet/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDirectNetworkId } from "@/lib/direct-network-context";
import { api } from "@/lib/invoke";
import type {
  DiagInfo,
  DnsStatusInfo,
  NetcheckInfo,
  RoutesInfo,
} from "@/lib/types";

export function DiagnosticsPanel() {
  const networkId = useDirectNetworkId();
  const [diag, setDiag] = useState<DiagInfo | null>(null);
  const [netcheck, setNetcheck] = useState<NetcheckInfo | null>(null);
  const [dns, setDns] = useState<DnsStatusInfo | null>(null);
  const [routes, setRoutes] = useState<RoutesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [diagRes, netcheckRes, dnsRes, routesRes] = await Promise.all([
      api.diag(),
      api.netcheck(),
      api.dns(),
      networkId ? api.networkRoutes(networkId) : api.routesList(),
    ]);
    setDiag(diagRes);
    setNetcheck(netcheckRes);
    setDns(dnsRes);
    setRoutes(routesRes);
  }, [networkId]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={refreshing ? "size-4 animate-spin" : "size-4"}
          />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {diag ? (
        <Card size="sm" className="shadow-none">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Status</CardTitle>
              <Badge
                variant="outline"
                className={
                  diag.endpoint_online
                    ? "border-success/30 bg-success/10 text-success"
                    : undefined
                }
              >
                {diag.endpoint_online ? "Online" : "Offline"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-muted-foreground">NAT type</div>
              <div className="mt-1 font-mono">{diag.nat_type}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Relay reachable</div>
              <div className="mt-1">{diag.relay_reachable ? "Yes" : "No"}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-muted-foreground">Peers</div>
              <div className="mt-1">
                {diag.direct_peers} direct · {diag.relayed_peers} relayed ·{" "}
                {diag.total_peers} total
              </div>
            </div>
            {diag.notes.length > 0 ? (
              <ul className="md:col-span-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {diag.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {netcheck ? (
        <Card size="sm" className="shadow-none">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Netcheck</CardTitle>
              <Badge
                variant="outline"
                className={
                  netcheck.ok
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }
              >
                {netcheck.ok ? "Pass" : "Issues"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {netcheck.checks.map((check) => (
              <div
                key={check.name}
                className="flex items-start justify-between gap-4 border-b border-border py-2 text-sm last:border-0"
              >
                <div>
                  <div className="font-medium">{check.name}</div>
                  <div className="text-muted-foreground">{check.detail}</div>
                </div>
                <Badge variant="outline">{check.pass ? "OK" : "Fail"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {dns ? (
        <Card size="sm" className="shadow-none">
          <CardHeader>
            <CardTitle>DNS</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-muted-foreground">Suffix</div>
              <div className="mt-1 font-mono">{dns.suffix}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Magic IP</div>
              <div className="mt-1 font-mono">{dns.magic_ip}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Upstream</div>
              <div className="mt-1 font-mono">
                {dns.upstream.join(", ") || "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Peer DNS</div>
              <div className="mt-1">
                {dns.peer_dns_active ? "Active" : "Inactive"}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {routes ? (
        <Card size="sm" className="shadow-none">
          <CardHeader>
            <CardTitle>Routes</CardTitle>
            <CardDescription>
              Split tunnel: {routes.split_tunnel_mode}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {routes.subnet_routes.length === 0 ? (
              <p className="text-muted-foreground">No subnet routes</p>
            ) : (
              routes.subnet_routes.map((route) => (
                <div
                  key={route.cidr}
                  className="flex justify-between gap-2 font-mono text-xs"
                >
                  <span>{route.cidr}</span>
                  <span className="text-muted-foreground">
                    via {route.via_hostname}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
