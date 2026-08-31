import { Input } from "@tunnet/ui/components/input";
import { Label } from "@tunnet/ui/components/label";
import { cn } from "@tunnet/ui/lib/utils";
import { useId, useMemo, useState } from "react";

export type PortRange = { start: number; end: number };

/** Parse `80`, `443`, `8000-9000`, `80,443`, `*` into ranges. Empty/`*` → [] (any). */
export function parsePortsInput(raw: string): {
  ports: PortRange[];
  error: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*") {
    return { ports: [], error: null };
  }

  const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
  const ports: PortRange[] = [];

  for (const part of parts) {
    if (part === "*") {
      return { ports: [], error: null };
    }

    const rangeMatch = /^(\d{1,5})\s*-\s*(\d{1,5})$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > 65535 || end > 65535) {
        return { ports: [], error: `Port out of range: ${part}` };
      }
      if (start > end) {
        return {
          ports: [],
          error: `Invalid range ${part}: start must be ≤ end`,
        };
      }
      ports.push({ start, end });
      continue;
    }

    if (!/^\d{1,5}$/.test(part)) {
      return {
        ports: [],
        error: `Invalid port "${part}". Use 80, 443, 8000-9000, or *`,
      };
    }

    const port = Number(part);
    if (port > 65535) {
      return { ports: [], error: `Port out of range: ${part}` };
    }
    ports.push({ start: port, end: port });
  }

  return { ports, error: null };
}

export function formatPortsInput(ports: PortRange[]): string {
  if (ports.length === 0) return "";
  return ports
    .map((p) => (p.start === p.end ? String(p.start) : `${p.start}-${p.end}`))
    .join(",");
}

export function PortsInput({
  value,
  onChange,
  disabled,
  id,
  label = "Ports",
  className,
}: {
  value: PortRange[];
  onChange: (ports: PortRange[], error: string | null) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
  className?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [text, setText] = useState(() => formatPortsInput(value));
  const [touched, setTouched] = useState(false);

  const parsed = useMemo(() => parsePortsInput(text), [text]);
  const showError = touched && parsed.error;

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        value={text}
        disabled={disabled}
        placeholder="80, 443, 8000-9000, or * for any"
        aria-invalid={Boolean(showError)}
        onChange={(value) => {
          const next = value;
          setText(next);
          setTouched(true);
          const result = parsePortsInput(next);
          onChange(result.ports, result.error);
        }}
        onBlur={() => setTouched(true)}
      />
      {showError ? (
        <p className="text-destructive text-xs" role="alert">
          {parsed.error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Leave empty or use * for any port. Ranges use start-end.
        </p>
      )}
    </div>
  );
}
