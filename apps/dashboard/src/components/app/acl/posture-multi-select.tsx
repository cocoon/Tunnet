import { Link } from "@tanstack/react-router";
import { Badge } from "@tunnet/ui/components/badge";
import { Skeleton } from "@tunnet/ui/components/skeleton";
import { cn } from "@tunnet/ui/lib/utils";
import { CheckIcon } from "lucide-react";
import { useOrgPostures } from "@/lib/queries/management";

export function PostureMultiSelect({
  orgId,
  networkId,
  value,
  onChange,
  className,
}: {
  orgId?: string;
  networkId?: string;
  value: string[];
  onChange: (names: string[]) => void;
  className?: string;
}) {
  const { data: postures, isPending } = useOrgPostures(orgId, networkId);
  const selected = new Set(value);

  function toggle(name: string) {
    if (selected.has(name)) {
      onChange(value.filter((n) => n !== name));
    } else {
      onChange([...value, name]);
    }
  }

  if (isPending) {
    return (
      <div className={cn("space-y-2", className)}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!postures?.length) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border/70 px-4 py-5 text-sm",
          className,
        )}
      >
        <p className="text-muted-foreground">
          No posture definitions yet. Conditions are optional - skip this step,
          or create definitions under Security → Posture.
        </p>
        <Link
          to="/posture"
          className="text-foreground mt-3 inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted/40"
        >
          Open posture
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-muted-foreground text-xs">
        Require the source device to pass at least one selected definition (OR).
        Leave none selected for no posture gate.
      </p>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((name) => (
            <Badge
              key={name}
              variant="secondary"
              className="cursor-pointer gap-1"
              onClick={() => toggle(name)}
            >
              {name}
              <span className="text-muted-foreground">×</span>
            </Badge>
          ))}
        </div>
      ) : null}
      <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/70">
        {postures.map((def) => {
          const on = selected.has(def.name);
          return (
            <li key={def.id}>
              <button
                type="button"
                onClick={() => toggle(def.name)}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
                  on ? "bg-muted/50" : "hover:bg-muted/30",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border",
                  )}
                  aria-hidden
                >
                  {on ? <CheckIcon className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{def.name}</span>
                  {def.description ? (
                    <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs">
                      {def.description}
                    </span>
                  ) : (
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {def.assertions.length} assertion
                      {def.assertions.length === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
