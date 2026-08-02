import { LicenseRequiredError } from "@tunnet/license/server";
import { Elysia } from "elysia";
import { auth, license } from "../../../auth";
import type { AuthContext, SessionUserContext } from "./session";
import { forbidden, requireAuth, unauthorized } from "./session";

export type PermissionCheck = Record<string, string[]>;

export { requireAuth };

export const requireSessionAuth = new Elysia({
  name: "require-session-auth",
}).onBeforeHandle({ as: "scoped" }, ({ sessionUser }) => {
  if (!sessionUser) {
    return unauthorized();
  }
});

export const requireCloudAccess = new Elysia({
  name: "require-cloud-access",
}).onBeforeHandle({ as: "scoped" }, async ({ sessionUser }) => {
  if (!sessionUser) {
    return unauthorized();
  }

  const result = await auth.api.userHasPermission({
    body: {
      userId: sessionUser.user.id,
      permissions: { cloud: ["access"] },
    },
  });

  if (!result?.success) {
    return forbidden();
  }
});

export const requireCloudInfrastructure = new Elysia({
  name: "require-cloud-infrastructure",
}).onBeforeHandle({ as: "scoped" }, () => {
  try {
    license.require("cloudInfrastructure");
  } catch (err) {
    if (err instanceof LicenseRequiredError) {
      return new Response(
        JSON.stringify({ error: err.message, code: err.code }),
        {
          status: 402,
          headers: { "content-type": "application/json" },
        },
      );
    }
    throw err;
  }
});

export function requirePermission(permissions: PermissionCheck) {
  const name = `require-permission-${Object.entries(permissions)
    .map(([k, v]) => `${k}:${v.join("+")}`)
    .join("|")}`;

  return new Elysia({ name }).onBeforeHandle(
    { as: "scoped" },
    async ({ authContext, request }) => {
      if (!authContext) {
        return unauthorized();
      }

      const result = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: authContext.organizationId,
          permissions,
        },
      });

      if (!result?.success) {
        return forbidden();
      }
    },
  );
}

export function getAuth(ctx: { authContext: AuthContext | null }): AuthContext {
  if (!ctx.authContext) {
    throw new Error("Auth context missing");
  }
  return ctx.authContext;
}

export function getSessionUser(ctx: {
  sessionUser: SessionUserContext | null;
}): SessionUserContext {
  if (!ctx.sessionUser) {
    throw new Error("Session user missing");
  }
  return ctx.sessionUser;
}
