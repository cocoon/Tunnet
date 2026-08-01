import { Button } from "@tunnet/ui/components/button";
import { Input } from "@tunnet/ui/components/input";
import { cn } from "@tunnet/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
      ) : null}
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          className={cn(mono && "font-mono text-xs")}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void copy()}
        >
          {copied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
