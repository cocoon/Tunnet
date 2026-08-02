import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@tunnet/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { HiOutlineCube, HiOutlineServerStack } from "react-icons/hi2";
import { PageHeader } from "@/components/app/page-header";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useCloudRelays } from "@/lib/queries/management";

export const Route = createFileRoute("/cloud/")({
  component: CloudOverviewPage,
});

function CloudOverviewPage() {
  const { data: entitlements } = useEntitlements();
  const { data: relays } = useCloudRelays();
  const healthyCount =
    relays?.filter((r) => r.status === "healthy").length ?? 0;

  return (
    <>
      <PageHeader
        title="System overview"
        description="Deployment-wide Cloud administration for this Tunnet instance."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HiOutlineServerStack className="size-4" />
              Relays
            </CardTitle>
            <CardDescription>
              Connectivity relays shared across organizations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-semibold tabular-nums">
              {relays?.length ?? "—"}
            </p>
            <p className="text-muted-foreground text-sm">
              {healthyCount} healthy
            </p>
            <Link
              to="/cloud/relays"
              className="text-sm font-medium hover:underline"
            >
              Manage relays →
            </Link>
          </CardContent>
        </Card>

        <Card className="opacity-70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HiOutlineCube className="size-4" />
              Edges
            </CardTitle>
            <CardDescription>
              Hosted public ingress edges (coming soon).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Not available yet</p>
          </CardContent>
        </Card>

        <Card className="opacity-70">
          <CardHeader>
            <CardTitle className="text-base">Infrastructure</CardTitle>
            <CardDescription>
              Control plane and region health (coming soon).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Not available yet</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
