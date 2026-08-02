import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { cors } from "@elysiajs/cors";
import { getDashboardUrl, getManagementPort } from "@tunnet/env";
import {
  LicenseLimitError,
  LicenseRequiredError,
} from "@tunnet/license/server";
import { Elysia } from "elysia";

import { cliAuthRoutes } from "./api/cli-auth";
import { sshAuthBrowserRoutes } from "./api/ssh-auth-browser";
import { apiV1 } from "./api/v1";
import { auth, ensureTrustedOAuthClients, initAuth, license } from "./auth";
import { ensureBootstrapUser } from "./lib/bootstrap-user";
import { pruneAuditEventsBeyondRetention } from "./lib/org-billing";
import { PlanLimitError, PlanRequiredError } from "./lib/plan-errors";
import { repairStrippedMeshCidrs } from "./lib/repair-mesh-cidrs";

const port = getManagementPort();
const host = process.env.HOST?.trim() || "127.0.0.1";
const webOrigin = getDashboardUrl();

await initAuth();

await repairStrippedMeshCidrs().catch((err) => {
  console.error("mesh CIDR repair failed:", err);
});

await ensureTrustedOAuthClients().catch((err) => {
  console.warn("oauth client bootstrap failed:", err);
});

await ensureBootstrapUser().catch((err) => {
  console.error("bootstrap user failed:", err);
});

const AUDIT_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
async function runAuditPrune() {
  try {
    const deleted = await pruneAuditEventsBeyondRetention();
    if (deleted > 0) {
      console.info(`[audit] pruned ${deleted} event(s) beyond plan retention`);
    }
  } catch (err) {
    console.error("[audit] prune failed:", err);
  }
}
void runAuditPrune();
setInterval(() => {
  void runAuditPrune();
}, AUDIT_PRUNE_INTERVAL_MS);

const oauthAuthServerMetadata = oauthProviderAuthServerMetadata(auth);
const openIdConfigMetadata = oauthProviderOpenIdConfigMetadata(auth);

const app = new Elysia()
  .decorate("license", license)
  .onError(({ error, set }) => {
    if (
      error instanceof LicenseRequiredError ||
      error instanceof LicenseLimitError
    ) {
      set.status = 402;
      return { error: error.message, code: error.code };
    }
    if (error instanceof PlanRequiredError) {
      set.status = 402;
      return {
        error: error.message,
        code: error.code,
        feature: error.feature,
        requiredPlan: error.requiredPlan,
        currentPlan: error.currentPlan,
      };
    }
    if (error instanceof PlanLimitError) {
      set.status = 402;
      return {
        error: error.message,
        code: error.code,
        limit: error.limit,
        allowed: error.allowed,
        current: error.current,
        requiredPlan: error.requiredPlan,
      };
    }
  })
  .use(
    cors({
      origin: webOrigin,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Organization-Id",
        "Cache-Control",
      ],
    }),
  )
  .get("/.well-known/oauth-authorization-server", ({ request }) =>
    oauthAuthServerMetadata(request),
  )
  .get("/.well-known/oauth-authorization-server/api/auth", ({ request }) =>
    oauthAuthServerMetadata(request),
  )
  .get("/.well-known/openid-configuration", ({ request }) =>
    openIdConfigMetadata(request),
  )
  .get("/api/auth/.well-known/openid-configuration", ({ request }) =>
    openIdConfigMetadata(request),
  )
  .get("/", () => ({ service: "tunnet-management", status: "ok" }))
  .mount(auth.handler)
  .use(cliAuthRoutes)
  .use(sshAuthBrowserRoutes)
  .use(apiV1)
  .get("/health", () => ({ status: "ok" }))
  .listen({ hostname: host, port });

console.log(
  `Tunnet management server running at ${app.server?.hostname}:${app.server?.port}`,
);
