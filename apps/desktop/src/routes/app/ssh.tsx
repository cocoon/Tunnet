import { createRoute } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { Terminal } from "lucide-react";
import { appRoute } from "../app";

export const Route = createRoute({
  getParentRoute: () => appRoute,
  path: "/ssh",
  component: SshPage,
});

function SshPage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-muted">
            <Terminal className="size-6 text-muted-foreground" />
          </div>
          <CardTitle>SSH sessions</CardTitle>
          <CardDescription>
            Recorded sessions, cast replay, and in-app terminal access are
            coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use the CLI for SSH in the meantime:{" "}
          <code className="font-mono">tunnet ssh</code>
        </CardContent>
      </Card>
    </div>
  );
}
