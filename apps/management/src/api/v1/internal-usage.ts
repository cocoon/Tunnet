import { Elysia, t } from "elysia";

import { incrementOrgTraffic } from "../../lib/org-billing";

function getServiceSecret(): string {
  const secret = process.env.TUNNET_SERVICE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("TUNNET_SERVICE_SECRET must be at least 32 characters");
  }
  return secret;
}

/**
 * Internal traffic accounting for control/edge.
 * Auth: Bearer TUNNET_SERVICE_SECRET (same shared secret as control admin HMAC).
 */
export const internalUsageRoutes = new Elysia({ prefix: "/internal" })
  .onBeforeHandle({ as: "scoped" }, ({ request, set }) => {
    const header = request.headers.get("authorization");
    const expected = `Bearer ${getServiceSecret()}`;
    if (header !== expected) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
  })
  .post(
    "/usage/traffic",
    async ({ body }) => {
      await incrementOrgTraffic(body.organizationId, body.kind, body.bytes);
      return { ok: true };
    },
    {
      body: t.Object({
        organizationId: t.String(),
        kind: t.Union([t.Literal("relay"), t.Literal("public_tunnel")]),
        bytes: t.Number({ minimum: 1 }),
      }),
    },
  );
