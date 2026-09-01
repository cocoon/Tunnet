import { createRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@tunnet/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { Progress } from "@tunnet/ui/components/progress";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ElevatedConfirm } from "@/components/ElevatedConfirm";
import { api } from "@/lib/invoke";
import { Route as rootRoute } from "./__root";

const STEPS = ["Starting", "Waiting for API"] as const;

type InstallStep = (typeof STEPS)[number];

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/install",
  component: InstallPage,
});

function InstallPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<InstallStep | null>(null);

  const progress = step ? ((STEPS.indexOf(step) + 1) / STEPS.length) * 100 : 0;

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      const probe = await api.daemonProbe();
      if (cancelled) return;
      if (probe.reachable) {
        void navigate({ to: "/" });
      } else if (probe.service.installed && step) {
        setStep("Waiting for API");
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [navigate, step]);

  async function install() {
    setBusy(true);
    setError(null);
    setStep("Starting");

    try {
      await api.serviceStart();
      toast.success("Service started");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Tunnet</CardTitle>
          <CardDescription>
            Tunnet runs as a system service. The desktop app connects to that
            service; it does not install a second copy of Core.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {step ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{step}</span>
              </div>
              <Progress value={progress} />
              <div className="flex flex-wrap gap-2">
                {STEPS.map((label) => (
                  <span
                    key={label}
                    className={
                      label === step
                        ? "text-xs font-medium text-foreground"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <ElevatedConfirm
              title="Administrator permission required"
              description="Windows will ask for permission to install and start the Tunnet service."
              confirmLabel="Start"
              onConfirm={install}
              disabled={busy}
            >
              {busy ? "Starting…" : "Start service"}
            </ElevatedConfirm>
            <Button variant="outline" onClick={() => void api.openReleases()}>
              Open releases
            </Button>
            <Button
              variant="outline"
              onClick={() => void navigate({ to: "/" })}
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
