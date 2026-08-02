import { cn } from "@tunnet/ui/lib/utils";

export function Lamp({
  status = "idle",
  live = false,
  className,
}: {
  status?: "idle" | "good" | "warn" | "bad";
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "l1-lamp",
        status === "good" && "l1-lamp--good",
        status === "warn" && "l1-lamp--warn",
        status === "bad" && "l1-lamp--bad",
        live && "l1-lamp--live",
        className,
      )}
    />
  );
}
