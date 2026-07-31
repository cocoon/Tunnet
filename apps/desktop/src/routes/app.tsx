import { createRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AppProvider } from "@/lib/app-context";
import { DirectNetworkProvider } from "@/lib/direct-network-context";
import { Route as rootRoute } from "./__root";

export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: AppLayout,
});

function AppLayout() {
  return (
    <AppProvider>
      <DirectNetworkProvider>
        <AppShell />
      </DirectNetworkProvider>
    </AppProvider>
  );
}
