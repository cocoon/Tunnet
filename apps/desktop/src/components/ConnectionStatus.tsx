import { Badge } from "@tunnet/ui/components/badge";
import { cn } from "@tunnet/ui/lib/utils";

interface ConnectionStatusProps {
  connected: boolean;
  label?: string;
  className?: string;
}

export function ConnectionStatus({
  connected,
  label,
  className,
}: ConnectionStatusProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal",
        connected
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          connected ? "bg-success" : "bg-muted-foreground",
        )}
      />
      {label ?? (connected ? "Connected" : "Disconnected")}
    </Badge>
  );
}
