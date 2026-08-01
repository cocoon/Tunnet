import {
  getControlPlaneUrl as getControlPlaneUrlFromEnv,
  getManagementUrl as getManagementUrlFromEnv,
} from "@tunnet/env";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function readBinding(
  key: "MANAGEMENT_URL" | "CONTROL_PLANE_URL" | "DASHBOARD_URL",
  fallback: string,
): string {
  const fromClient = import.meta.env[key];
  if (typeof fromClient === "string" && fromClient.trim()) {
    return stripTrailingSlash(fromClient.trim());
  }

  if (typeof process !== "undefined") {
    const fromProcess = process.env[key]?.trim();
    if (fromProcess) {
      return stripTrailingSlash(fromProcess);
    }
  }

  return fallback;
}

function isPortlessHostname(hostname: string): boolean {
  return hostname.endsWith(".localhost");
}

function getServerManagementUrl(url: string): string {
  if (import.meta.env.SSR === false) return url;

  const parsed = new URL(url);
  if (!isPortlessHostname(parsed.hostname)) return url;

  // Portless exposes the named HTTPS route on loopback. Browsers resolve
  // *.localhost automatically, but the server runtime does not on Windows.
  parsed.hostname = "127.0.0.1";
  return parsed.toString().replace(/\/$/, "");
}

export function getManagementApiUrl(): string {
  const configured = readBinding("MANAGEMENT_URL", "");
  if (configured) {
    return getServerManagementUrl(configured);
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return getServerManagementUrl(getManagementUrlFromEnv());
}

export function getManagementHostHeader(): string | undefined {
  if (import.meta.env.SSR === false) return undefined;

  const configured = readBinding("MANAGEMENT_URL", "");
  if (!configured) return undefined;

  const parsed = new URL(configured);
  return isPortlessHostname(parsed.hostname) ? parsed.host : undefined;
}

export function getControlPlaneUrl(): string {
  const configured = readBinding("CONTROL_PLANE_URL", "");
  if (configured) {
    return configured;
  }

  return getControlPlaneUrlFromEnv();
}

export function getDashboardUrl(): string {
  return readBinding("DASHBOARD_URL", "http://localhost:5173");
}
