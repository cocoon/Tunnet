import { CapabilityGate } from "@/components/CapabilityGate";
import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PeerSummary } from "@/lib/types";

interface PeerTableProps {
  peers: PeerSummary[];
  onKick?: (peerId: string) => void;
  showActions?: boolean;
  compact?: boolean;
}

export function PeerTable({
  peers,
  onKick,
  showActions,
  compact = false,
}: PeerTableProps) {
  if (peers.length === 0) {
    return (
      <Card className="shadow-none">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No other devices on this network yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden py-0 shadow-none">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Status</TableHead>
            {!compact ? <TableHead>Path</TableHead> : null}
            {!compact ? <TableHead>Latency</TableHead> : null}
            {showActions ? <TableHead className="w-20" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {peers.map((peer) => (
            <TableRow key={peer.endpoint_id}>
              <TableCell>
                <div className="font-medium">{peer.hostname}</div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-0.5">
                  <span className="font-mono text-xs">{peer.ip}</span>
                  {peer.ip ? (
                    <CopyButton value={peer.ip} label="Device address" />
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    peer.online === true
                      ? "border-success/30 bg-success/10 text-success"
                      : peer.online == null
                        ? "border-muted-foreground/30 text-muted-foreground"
                        : undefined
                  }
                >
                  {peer.online === true
                    ? "Online"
                    : peer.online == null
                      ? "Unknown"
                      : "Offline"}
                </Badge>
              </TableCell>
              {!compact ? (
                <TableCell className="capitalize text-muted-foreground">
                  {peer.path ?? "—"}
                </TableCell>
              ) : null}
              {!compact ? (
                <TableCell className="font-mono text-xs">
                  {peer.latency_ms != null
                    ? `${peer.latency_ms.toFixed(0)} ms`
                    : "—"}
                </TableCell>
              ) : null}
              {showActions ? (
                <TableCell>
                  {onKick ? (
                    <CapabilityGate permission="network.admit">
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => onKick(peer.endpoint_id)}
                      >
                        Remove
                      </Button>
                    </CapabilityGate>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
