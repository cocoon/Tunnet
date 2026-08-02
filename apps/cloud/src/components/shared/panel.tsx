import { cn } from "@tunnet/ui/lib/utils";
import type { ReactNode } from "react";

export function Panel({
  children,
  screws = false,
  raised = false,
  className,
  bodyClassName,
}: {
  children: ReactNode;
  status?: "idle" | "good" | "warn" | "bad";
  live?: boolean;
  screws?: boolean;
  raised?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={cn(
        "p-panel overflow-hidden",
        raised && "p-panel--raise",
        screws && "p-screws",
        className,
      )}
    >
      <div className={cn("relative", bodyClassName)}>{children}</div>
    </div>
  );
}
