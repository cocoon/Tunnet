import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@tunnet/ui/components/sonner";
import { TooltipProvider } from "@tunnet/ui/components/tooltip";
import { DesktopUpdateProvider } from "@/lib/desktop-update-context";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <DesktopUpdateProvider>
      <TooltipProvider>
        <Outlet />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </DesktopUpdateProvider>
  );
}
