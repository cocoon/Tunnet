import { createRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
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
import type { PeerSummary } from "@/lib/types";
import { appRoute } from "../app";

export const Route = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: OverviewPage,
});

function OverviewPage() {
  const { node, meta, apiReachable, loading } = useApp();
  const { activeNetwork } = useDirectNetwork();
  const isManaged = (meta?.mode ?? node?.mode) === "managed";

  const network = useMemo(() => {
    if (!node) return undefined;
    if (isManaged) return node.networks.find((n) => n.mode === "managed");
    return activeNetwork ?? node.networks.find((n) => n.mode === "direct");
  }, [node, isManaged, activeNetwork]);

  const [peers, setPeers] = useState<PeerSummary[]>([]);

  useEffect(() => {
    if (!network?.network_id || !apiReachable) {
      setPeers([]);
      return;
    }
    const id = network.network_id;
    let cancelled = false;
    void api
      .networkPeers(id)
      .then((res) => {
        if (!cancelled) setPeers(res.peers);
      })
      .catch(() => {
        if (!cancelled) setPeers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [network?.network_id, apiReachable]);

  if (loading && !node) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const online = network?.peers_online ?? peers.filter((p) => p.online).length;
  const total = network?.peers_total ?? peers.length;
  const role =
    network?.role === "coordinator"
      ? "You created this network"
      : network?.role === "member"
        ? "You joined this network"
        : network?.role === "managed"
          ? "Managed by your organization"
          : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <motion.section
        className="space-y-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {node?.hostname || "This device"}
          </h1>
          {role ? (
            <p className="mt-1 text-sm text-muted-foreground">{role}</p>
          ) : null}
        </div>

        <Card className="rounded-2xl shadow-none">
          <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Your address</p>
              <div className="flex items-center gap-1">
                <span className="font-mono text-sm">
                  {network?.ip || "Not assigned yet"}
                </span>
                {network?.ip ? (
                  <CopyButton value={network.ip} label="Address" />
                ) : null}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Other devices</p>
              <p className="text-sm">
                {total === 0 ? "None yet" : `${online} online · ${total} total`}
              </p>
            </div>
          </CardContent>
        </Card>

        {isManaged && (network?.dashboard_url || network?.control_url) ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const base = network?.dashboard_url ?? network?.control_url;
              if (!base || !node) return;
              const url = network?.dashboard_url
                ? `${base.replace(/\/$/, "")}/app/machines/${node.endpoint_id}`
                : base;
              void api.openUrl(url);
            }}
          >
            Open organization dashboard
          </Button>
        ) : null}
      </motion.section>

      <motion.section
        className="space-y-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05, ease: "easeOut" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Devices nearby</h2>
            <p className="text-xs text-muted-foreground">
              Machines you can reach on this network
            </p>
          </div>
          <Link
            to="/app/peers"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        <PeerTable peers={peers.slice(0, 6)} compact />
      </motion.section>

      {!node?.data_plane_up ? (
        <Card className="rounded-2xl border-dashed shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Connection paused</CardTitle>
            <CardDescription>
              Your device is still on the network, but traffic is paused. You
              can resume from Settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/app/settings"
              className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm transition-colors hover:bg-muted"
            >
              Open settings
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
