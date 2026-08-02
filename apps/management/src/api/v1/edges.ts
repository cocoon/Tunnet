import { randomBytes } from "node:crypto";
import { createEdgeBody, patchEdgeBody } from "@tunnet/api/management";
import { schema } from "@tunnet/db";
import { and, desc, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { blake3 } from "hash-wasm";

import { writeAudit } from "../../lib/audit";
import { db } from "../../lib/db";
import { notifyEntityChanged } from "../../lib/notify";
import { toIso } from "../../lib/serialize";
import { getAuth, requireAuth, requirePermission } from "./middleware/authz";
import { notFound, sessionPlugin } from "./middleware/session";

function serializeEdge(row: typeof schema.edges.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    kind: row.kind as "hosted" | "self_hosted",
    region: row.region,
    publicIp: row.publicIp,
    domain: row.domain,
    capacityLimit: row.capacityLimit,
    activeTunnels: row.activeTunnels,
    status: row.status as
      | "pending"
      | "healthy"
      | "degraded"
      | "offline"
      | "disabled",
    lastHeartbeatAt: toIso(row.lastHeartbeatAt),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

export const edgesRoutes = new Elysia()
  .use(sessionPlugin)
  .use(requireAuth)
  .get("/organizations/:orgId/edges", async ({ authContext }) => {
    const auth = getAuth({ authContext });
    const rows = await db.query.edges.findMany({
      where: eq(schema.edges.organizationId, auth.organizationId),
      orderBy: [desc(schema.edges.createdAt)],
    });
    return { edges: rows.map(serializeEdge) };
  })
  .get(
    "/organizations/:orgId/edges/:edgeId",
    async ({ authContext, params }) => {
      const auth = getAuth({ authContext });
      const row = await db.query.edges.findFirst({
        where: and(
          eq(schema.edges.id, params.edgeId),
          eq(schema.edges.organizationId, auth.organizationId),
        ),
      });
      if (!row) return notFound("Edge not found");
      return { edge: serializeEdge(row) };
    },
  )
  .get(
    "/organizations/:orgId/edges/:edgeId/health",
    async ({ authContext, params, query }) => {
      const auth = getAuth({ authContext });
      const edge = await db.query.edges.findFirst({
        where: and(
          eq(schema.edges.id, params.edgeId),
          eq(schema.edges.organizationId, auth.organizationId),
        ),
      });
      if (!edge) return notFound("Edge not found");

      const rawLimit =
        typeof query === "object" &&
        query !== null &&
        "limit" in query &&
        typeof query.limit === "string"
          ? Number.parseInt(query.limit, 10)
          : 100;
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 500)
        : 100;

      const heartbeats = await db.query.edgeHeartbeats.findMany({
        where: eq(schema.edgeHeartbeats.edgeId, params.edgeId),
        orderBy: [desc(schema.edgeHeartbeats.recordedAt)],
        limit,
      });

      const meta =
        edge.metadata && typeof edge.metadata === "object"
          ? (edge.metadata as { certValidUntil?: string })
          : {};
      const validUntil =
        typeof meta.certValidUntil === "string" ? meta.certValidUntil : null;

      return {
        heartbeats: heartbeats.map((h) => ({
          id: h.id,
          edgeId: h.edgeId,
          activeTunnels: h.activeTunnels,
          recordedAt: toIso(h.recordedAt)!,
        })),
        cert: { validUntil },
        lastHeartbeatAt: toIso(edge.lastHeartbeatAt),
        status: edge.status,
        activeTunnels: edge.activeTunnels,
      };
    },
  )
  .group("", (app) =>
    app
      .use(requirePermission({ edge: ["create", "update", "delete"] }))
      .post("/organizations/:orgId/edges", async ({ authContext, body }) => {
        const auth = getAuth({ authContext });
        const parsed = createEdgeBody.parse(body);

        const token = randomBytes(32).toString("base64url");
        const tokenHash = await blake3(Buffer.from(token));
        const expiresAt = new Date(Date.now() + 60 * 60_000);

        const result = await db.transaction(async (tx) => {
          const [edge] = await tx
            .insert(schema.edges)
            .values({
              organizationId: auth.organizationId,
              name: parsed.name,
              kind: parsed.kind,
              region: parsed.region,
              domain: parsed.domain,
              publicIp: parsed.publicIp ?? null,
              capacityLimit: parsed.capacityLimit,
              status: "pending",
            })
            .returning();

          await tx.insert(schema.edgeRegistrationTokens).values({
            tokenHash,
            organizationId: auth.organizationId,
            edgeId: edge?.id,
            createdBy: auth.user.id,
            expiresAt,
          });

          await writeAudit(tx, {
            organizationId: auth.organizationId,
            actor: auth.user.id,
            action: "edge.create",
            target: edge?.id,
            metadata: { name: parsed.name, domain: parsed.domain },
          });

          await notifyEntityChanged(tx, {
            organizationId: auth.organizationId,
            kind: "edge",
            entityId: edge?.id,
          });

          return edge!;
        });

        return {
          edge: serializeEdge(result),
          registrationToken: token,
          expiresAt: toIso(expiresAt)!,
        };
      })
      .patch(
        "/organizations/:orgId/edges/:edgeId",
        async ({ authContext, params, body }) => {
          const auth = getAuth({ authContext });
          const parsed = patchEdgeBody.parse(body);

          const existing = await db.query.edges.findFirst({
            where: and(
              eq(schema.edges.id, params.edgeId),
              eq(schema.edges.organizationId, auth.organizationId),
            ),
          });
          if (!existing) return notFound("Edge not found");

          const [updated] = await db
            .update(schema.edges)
            .set({
              ...parsed,
              updatedAt: new Date(),
            })
            .where(eq(schema.edges.id, params.edgeId))
            .returning();

          await writeAudit(db, {
            organizationId: auth.organizationId,
            actor: auth.user.id,
            action: "edge.update",
            target: params.edgeId,
            metadata: parsed,
          });

          await notifyEntityChanged(db, {
            organizationId: auth.organizationId,
            kind: "edge",
            entityId: params.edgeId,
          });

          return { edge: serializeEdge(updated!) };
        },
      )
      .delete(
        "/organizations/:orgId/edges/:edgeId",
        async ({ authContext, params }) => {
          const auth = getAuth({ authContext });
          const existing = await db.query.edges.findFirst({
            where: and(
              eq(schema.edges.id, params.edgeId),
              eq(schema.edges.organizationId, auth.organizationId),
            ),
          });
          if (!existing) return notFound("Edge not found");

          await db
            .delete(schema.edges)
            .where(eq(schema.edges.id, params.edgeId));

          await writeAudit(db, {
            organizationId: auth.organizationId,
            actor: auth.user.id,
            action: "edge.delete",
            target: params.edgeId,
            metadata: { name: existing.name },
          });

          await notifyEntityChanged(db, {
            organizationId: auth.organizationId,
            kind: "edge",
            entityId: params.edgeId,
          });

          return { ok: true };
        },
      ),
  );
