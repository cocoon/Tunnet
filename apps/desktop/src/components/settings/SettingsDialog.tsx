import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@tunnet/ui/components/dialog";
import { cn } from "@tunnet/ui/lib/utils";
import { Activity, Settings2, X } from "lucide-react";
import type { ComponentType } from "react";
import type { SettingsDialogTab } from "@/lib/settings-dialog-context";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { SettingsGeneral } from "./SettingsGeneral";

const tabs: {
  id: SettingsDialogTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SettingsDialogTab;
  onTabChange: (tab: SettingsDialogTab) => void;
}

function DialogCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close settings"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
    >
      <X className="size-4" />
    </button>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  tab,
  onTabChange,
}: SettingsDialogProps) {
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(640px,85vh)] max-w-3xl! gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/30 p-2 sm:w-52 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 sm:p-3"
          >
            <p className="hidden px-2 pb-1 text-xs font-medium text-muted-foreground sm:block">
              Settings
            </p>
            {tabs.map((item) => {
              const Icon = item.icon;
              const selected = item.id === active.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    "flex min-h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border py-3 pr-3 pl-5">
              <h2 className="truncate text-base font-semibold tracking-tight">
                {active.label}
              </h2>
              <DialogCloseButton onClose={() => onOpenChange(false)} />
            </div>
            <div className="settings-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4">
              {active.id === "diagnostics" ? (
                <DiagnosticsPanel />
              ) : (
                <SettingsGeneral />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
