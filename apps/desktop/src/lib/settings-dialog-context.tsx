import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

interface SettingsDialogContextValue {
  openSettings: (tab?: SettingsDialogTab) => void;
}

export type SettingsDialogTab = "general" | "diagnostics";

const SettingsDialogContext = createContext<SettingsDialogContextValue | null>(
  null,
);

export function useSettingsDialog() {
  const context = useContext(SettingsDialogContext);
  if (!context) {
    throw new Error("useSettingsDialog must be used inside its provider.");
  }
  return context;
}

export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsDialogTab>("general");

  const openSettings = useCallback((nextTab: SettingsDialogTab = "general") => {
    setTab(nextTab);
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ openSettings }), [openSettings]);

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      <SettingsDialog
        open={open}
        onOpenChange={setOpen}
        tab={tab}
        onTabChange={setTab}
      />
    </SettingsDialogContext.Provider>
  );
}
