import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tunnet/ui/components/card";
import { cn } from "@tunnet/ui/lib/utils";
import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  description?: string;
  className?: string;
  mono?: boolean;
}

export function MetricCard({
  label,
  value,
  description,
  className,
  mono = false,
}: MetricCardProps) {
  return (
    <Card size="sm" className={cn("min-w-0", className)}>
      <CardHeader className="pb-0">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-lg font-medium tracking-tight",
            mono && "font-mono text-base",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      {description ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {description}
        </CardContent>
      ) : null}
    </Card>
  );
}
