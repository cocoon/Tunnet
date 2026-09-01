import type { DesktopUpdatePhase } from "./desktop-update-context";

export type DesktopUpdateEvent =
  | "check"
  | "none"
  | "found"
  | "download"
  | "downloaded"
  | "install"
  | "fail";

export function transitionDesktopUpdate(
  phase: DesktopUpdatePhase,
  event: DesktopUpdateEvent,
): DesktopUpdatePhase {
  if (event === "check") return "checking";
  if (event === "fail") return "error";
  if (phase === "checking" && event === "none") return "idle";
  if (phase === "checking" && event === "found") return "available";
  if ((phase === "available" || phase === "error") && event === "download")
    return "downloading";
  if (phase === "downloading" && event === "downloaded") return "ready";
  if (phase === "ready" && event === "install") return "installing";
  return phase;
}
