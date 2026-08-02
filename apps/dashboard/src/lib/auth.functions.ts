import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { getManagementApiUrl, getManagementHostHeader } from "@/lib/env";

function authFetchOptions() {
  const headers = new Headers(getRequestHeaders());
  headers.delete("host");
  headers.delete("content-length");

  const managementHost = getManagementHostHeader();
  if (managementHost) headers.set("host", managementHost);

  return {
    headers,
    credentials: "include" as const,
  };
}

async function fetchSession() {
  try {
    const response = await fetch(
      `${getManagementApiUrl()}/api/auth/get-session`,
      { headers: authFetchOptions().headers },
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    // An unavailable management service should leave the user signed out,
    // not prevent the dashboard login route from rendering.
    return null;
  }
}

export const getSession = createServerFn({ method: "GET" }).handler(async () =>
  fetchSession(),
);

export const getEntitlements = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const response = await fetch(
        `${getManagementApiUrl()}/api/v1/entitlements`,
        { headers: authFetchOptions().headers },
      );
      if (!response.ok) return null;
      return response.json() as Promise<{
        tier: string;
        cloudInfrastructure: boolean;
      }>;
    } catch {
      return null;
    }
  },
);
