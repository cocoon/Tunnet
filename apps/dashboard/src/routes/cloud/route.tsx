import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { CloudShell } from "@/components/app/cloud-shell";
import { fetchEntitlements } from "@/hooks/use-entitlements";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/cloud")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      throw redirect({ to: "/login", search: { redirect: "/cloud" } });
    }

    const { data } = await authClient.admin.hasPermission({
      permissions: { cloud: ["access"] },
    });
    if (!data?.success) {
      throw redirect({ to: "/" });
    }

    const entitlements = await fetchEntitlements();
    if (!entitlements.cloudInfrastructure) {
      throw redirect({ to: "/" });
    }
  },
  component: CloudLayout,
});

function CloudLayout() {
  return (
    <CloudShell>
      <Outlet />
    </CloudShell>
  );
}
