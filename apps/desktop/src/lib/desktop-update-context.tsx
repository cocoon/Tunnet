import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

interface DesktopUpdateValue {
  currentVersion: string;
  availableVersion: string | null;
  phase: DesktopUpdatePhase;
  progress: number;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

const DesktopUpdateContext = createContext<DesktopUpdateValue | null>(null);

export function DesktopUpdateProvider({ children }: { children: ReactNode }) {
  const updateRef = useRef<Update | null>(null);
  const [currentVersion, setCurrentVersion] = useState("-");
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<DesktopUpdatePhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const releaseUpdate = useCallback(async () => {
    const previous = updateRef.current;
    updateRef.current = null;
    if (previous) await previous.close().catch(() => undefined);
  }, []);

  const checkForUpdate = useCallback(async () => {
    setPhase("checking");
    setError(null);
    setProgress(0);
    try {
      await releaseUpdate();
      const update = await check({ timeout: 15_000 });
      updateRef.current = update;
      setAvailableVersion(update?.version ?? null);
      setPhase(update ? "available" : "idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }, [releaseUpdate]);

  const download = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setPhase("downloading");
    setError(null);
    let downloaded = 0;
    let total = 0;
    try {
      await update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        setProgress(
          event.event === "Finished"
            ? 1
            : total > 0
              ? Math.min(downloaded / total, 1)
              : 0,
        );
      });
      setPhase("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setPhase("installing");
    setError(null);
    try {
      // Windows exits through the updater process. Tunnet's close-to-tray handler
      // must not participate in this lifecycle.
      await update.install({ restartAfterInstall: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    void getVersion().then(setCurrentVersion);
    const timer = window.setTimeout(() => void checkForUpdate(), 2_000);
    return () => {
      window.clearTimeout(timer);
      void releaseUpdate();
    };
  }, [checkForUpdate, releaseUpdate]);

  const value = useMemo(
    () => ({
      currentVersion,
      availableVersion,
      phase,
      progress,
      error,
      checkForUpdate,
      download,
      install,
    }),
    [
      currentVersion,
      availableVersion,
      phase,
      progress,
      error,
      checkForUpdate,
      download,
      install,
    ],
  );
  return (
    <DesktopUpdateContext.Provider value={value}>
      {children}
    </DesktopUpdateContext.Provider>
  );
}

export function useDesktopUpdate() {
  const value = useContext(DesktopUpdateContext);
  if (!value)
    throw new Error(
      "useDesktopUpdate must be used within DesktopUpdateProvider",
    );
  return value;
}
