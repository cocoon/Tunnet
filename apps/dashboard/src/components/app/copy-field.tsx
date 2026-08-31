import { Input } from "@tunnet/ui/components/input";
import { cn } from "@tunnet/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

type CopyFieldProps = {
  value: string;
  label?: string;
  className?: string;
  mono?: boolean;
};

export function CopyField({
  value,
  label,
  className,
  mono = true,
}: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
      ) : null}
      <Input
        readOnly
        value={value}
        onClick={() => void copy()}
        aria-label={label ? `${label}. Click to copy` : "Click to copy"}
        classNames={{ input: cn("cursor-copy", mono && "font-mono text-xs") }}
        rightIcon={
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void copy();
            }}
            aria-label={copied ? "Copied" : "Copy"}
          >
            {copied ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
          </button>
        }
      />
    </div>
  );
}
