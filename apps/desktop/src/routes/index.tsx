import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/invoke";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: BootPage,
});

function BootPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Checking daemon…");
  const startAttempted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function poll() {
      try {
        const probe = await api.daemonProbe();
        if (cancelled) return;

        if (!probe.reachable && !probe.service.installed) {
          void navigate({ to: "/install" });
          return;
        }

        if (!probe.reachable) {
          setMessage("Starting daemon…");
          if (probe.service.installed && !startAttempted.current) {
            startAttempted.current = true;
            void api.serviceStart().catch((err) => {
              if (cancelled) return;
              startAttempted.current = false;
              setMessage(
                err instanceof Error
                  ? err.message
                  : String(err ?? "Failed to start service"),
              );
            });
          }
          return;
        }

        const mode = probe.meta?.mode ?? "idle";
        if (mode === "idle") {
          void navigate({ to: "/setup" });
          return;
        }

        if (mode === "direct" || mode === "managed") {
          void navigate({ to: "/app" });
        }
      } catch {
        if (!cancelled) setMessage("Waiting for daemon…");
      }
    }

    void poll();
    timer = setInterval(() => void poll(), 1000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [navigate]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-xs text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Tunnet</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-6 space-y-2">
          <Skeleton className="mx-auto h-2 w-32" />
          <Skeleton className="mx-auto h-2 w-24 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
