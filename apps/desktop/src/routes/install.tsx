import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ElevatedConfirm } from "@/components/ElevatedConfirm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/invoke";
import { Route as rootRoute } from "./__root";

const STEPS = [
  "Checking",
  "Elevating",
  "Downloading",
  "Installing",
  "Starting",
  "Waiting for API",
] as const;

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
    setStep("Checking");

    try {
      setStep("Elevating");
      await api.serviceInstallAndStart();
      setStep("Starting");
      toast.success("Install requested. Waiting for daemon…");
    } catch (err) {
      try {
        setStep("Downloading");
        const result = await api.installDaemonFromGithub();
        setStep("Installing");
        toast.message(result.message);
        setStep("Starting");
      } catch (inner) {
        setError(inner instanceof Error ? inner.message : String(inner ?? err));
        setStep(null);
      }
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
            Tunnet runs as a system service on your machine. The desktop app
            connects to the local daemon - it does not replace the service after
            install.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {step ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Install progress</span>
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
              description="Installing the Tunnet daemon requires elevated privileges. Windows will show a UAC prompt to install the system service."
              confirmLabel="Install"
              onConfirm={install}
              disabled={busy}
            >
              {busy ? "Installing…" : "Install daemon"}
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
