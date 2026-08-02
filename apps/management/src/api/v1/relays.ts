import { randomBytes } from "node:crypto";
import { createRelayBody, patchRelayBody } from "@tunnet/api/management";
import { schema } from "@tunnet/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Elysia } from "elysia";
import { blake3 } from "hash-wasm";

import { writeAudit } from "../../lib/audit";
import { db } from "../../lib/db";
import { notifyEntityChanged } from "../../lib/notify";
import { toIso } from "../../lib/serialize";
import { getAuth, requireAuth, requirePermission } from "./middleware/authz";
import { forbidden, notFound } from "./middleware/session";

type DbLike = {
  query: typeof db.query;
  insert: typeof db.insert;
};

function serializeRelay(row: typeof schema.relays.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    url: row.url,
    region: row.region,
    status: row.status as
      | "pending"
      | "healthy"
      | "degraded"
      | "offline"
      | "suspended",
    qadEnabled: row.qadEnabled,
    metricsUrl: row.metricsUrl,
    accessMode: row.accessMode as "open" | "shared_token" | "http",
    lastHeartbeatAt: toIso(row.lastHeartbeatAt),
    identity:
      row.identity &&
      typeof row.identity === "object" &&
      !Array.isArray(row.identity)
        ? (row.identity as Record<string, unknown>)
        : {},
    suspendedAt: toIso(row.suspendedAt),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

function patchRelayValues(parsed: ReturnType<typeof patchRelayBody.parse>) {
  const values: Partial<typeof schema.relays.$inferInsert> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (parsed.name !== undefined) values.name = parsed.name;
  if (parsed.region !== undefined) values.region = parsed.region;
  if (parsed.url !== undefined) values.url = parsed.url;
  if (parsed.qadEnabled !== undefined) values.qadEnabled = parsed.qadEnabled;
  if (parsed.metricsUrl !== undefined) values.metricsUrl = parsed.metricsUrl;
  if (parsed.accessMode !== undefined) values.accessMode = parsed.accessMode;

  if (parsed.status !== undefined) {
    values.status = parsed.status;
    if (parsed.status === "suspended") {
      values.suspendedAt = new Date();
    } else if (parsed.status === "healthy") {
      values.suspendedAt = null;
    }
  }

  return values;
}

async function listAvailableRelayRegions(): Promise<string[]> {
  const rows = await db.query.relays.findMany({
    where: and(
      isNull(schema.relays.organizationId),
      eq(schema.relays.status, "healthy"),
    ),
    columns: { region: true },
  });
  const regions = new Set<string>();
  for (const row of rows) {
    if (row.region) regions.add(row.region);
  }
  return [...regions].sort();
}

async function ensureOrgRelayPolicyAugment(
  tx: DbLike,
  organizationId: string,
): Promise<void> {
  const existing = await tx.query.organizationRelaySettings.findFirst({
    where: eq(schema.organizationRelaySettings.organizationId, organizationId),
  });
  if (existing && existing.policy !== "inherit") return;

  await tx
    .insert(schema.organizationRelaySettings)
    .values({
      organizationId,
      policy: "augment",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.organizationRelaySettings.organizationId,
      set: {
        policy: "augment",
        updatedAt: new Date(),
      },
    });
}

export const relaysRoutes = new Elysia()
  .use(requireAuth)
  .get("/organizations/:orgId/relays", async ({ authContext }) => {
    const auth = getAuth({ authContext });
    const [rows, availableRelayRegions] = await Promise.all([
      db.query.relays.findMany({
        where: and(
          eq(schema.relays.organizationId, auth.organizationId),
          isNotNull(schema.relays.organizationId),
        ),
        orderBy: [desc(schema.relays.createdAt)],
      }),
      listAvailableRelayRegions(),
    ]);
    return {
      relays: rows.map(serializeRelay),
      availableRelayRegions,
    };
  })
  .get("/organizations/:orgId/available-relay-regions", async () => {
    const regions = await listAvailableRelayRegions();
    return { regions };
  })
  .get(
    "/organizations/:orgId/relays/:relayId",
    async ({ authContext, params }) => {
      const auth = getAuth({ authContext });
      const row = await db.query.relays.findFirst({
        where: and(
          eq(schema.relays.id, params.relayId),
          eq(schema.relays.organizationId, auth.organizationId),
        ),
      });
      if (!row || row.organizationId == null)
        return notFound("Relay not found");
      return { relay: serializeRelay(row) };
    },
  )
  .get(
    "/organizations/:orgId/relays/:relayId/health",
    async ({ authContext, params, query }) => {
      const auth = getAuth({ authContext });
      const relay = await db.query.relays.findFirst({
        where: and(
          eq(schema.relays.id, params.relayId),
          eq(schema.relays.organizationId, auth.organizationId),
        ),
      });
      if (!relay || relay.organizationId == null) {
        return notFound("Relay not found");
      }

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

      const heartbeats = await db.query.relayHeartbeats.findMany({
        where: eq(schema.relayHeartbeats.relayId, params.relayId),
        orderBy: [desc(schema.relayHeartbeats.recordedAt)],
        limit,
      });

      return {
        heartbeats: heartbeats.map((h) => ({
          id: h.id,
          relayId: h.relayId,
          recordedAt: toIso(h.recordedAt)!,
          metrics:
            h.metrics &&
            typeof h.metrics === "object" &&
            !Array.isArray(h.metrics)
              ? (h.metrics as Record<string, unknown>)
              : null,
        })),
        lastHeartbeatAt: toIso(relay.lastHeartbeatAt),
        status: relay.status,
        suspendedAt: toIso(relay.suspendedAt),
      };
    },
  )
  .group("", (app) =>
    app
      .use(requirePermission({ relay: ["create", "update", "delete"] }))
      .post("/organizations/:orgId/relays", async ({ authContext, body }) => {
        const auth = getAuth({ authContext });
        const parsed = createRelayBody.parse(body);

        const token = randomBytes(32).toString("base64url");
        const tokenHash = await blake3(Buffer.from(token));
        const expiresAt = new Date(Date.now() + 60 * 60_000);

        const result = await db.transaction(async (tx) => {
          const prior = await tx.query.relays.findFirst({
            where: and(
              eq(schema.relays.organizationId, auth.organizationId),
              isNotNull(schema.relays.organizationId),
            ),
            columns: { id: true },
          });
          const isFirstOrgRelay = !prior;

          const [relay] = await tx
            .insert(schema.relays)
            .values({
              organizationId: auth.organizationId,
              name: parsed.name,
              url: parsed.url,
              region: parsed.region,
              qadEnabled: parsed.qadEnabled,
              metricsUrl: parsed.metricsUrl ?? null,
              accessMode: parsed.accessMode,
              status: "pending",
            })
            .returning();

          if (!relay?.organizationId) {
            throw new Error("Organization relay must have organizationId");
          }

          if (isFirstOrgRelay) {
            await ensureOrgRelayPolicyAugment(tx, auth.organizationId);
          }

          await tx.insert(schema.relayRegistrationTokens).values({
            tokenHash,
            organizationId: auth.organizationId,
            relayId: relay.id,
            createdBy: auth.user.id,
            expiresAt,
          });

          await writeAudit(tx, {
            organizationId: auth.organizationId,
            actor: auth.user.id,
            action: "relay.create",
            target: relay.id,
            metadata: { name: parsed.name },
          });

          await notifyEntityChanged(tx, {
            organizationId: auth.organizationId,
            kind: "relay",
            entityId: relay.id,
          });

          return relay;
        });

        return {
          relay: serializeRelay(result),
          registrationToken: token,
          expiresAt: toIso(expiresAt)!,
        };
      })
      .patch(
        "/organizations/:orgId/relays/:relayId",
        async ({ authContext, params, body }) => {
          const auth = getAuth({ authContext });
          const parsed = patchRelayBody.parse(body);

          const existing = await db.query.relays.findFirst({
            where: and(
              eq(schema.relays.id, params.relayId),
              eq(schema.relays.organizationId, auth.organizationId),
            ),
          });
          if (!existing || existing.organizationId == null) {
            return notFound("Relay not found");
          }
          if (existing.organizationId !== auth.organizationId) {
            return forbidden();
          }

          const [updated] = await db
            .update(schema.relays)
            .set(patchRelayValues(parsed))
            .where(
              and(
                eq(schema.relays.id, params.relayId),
                eq(schema.relays.organizationId, auth.organizationId),
              ),
            )
            .returning();

          if (!updated?.organizationId) {
            return forbidden();
          }

          await writeAudit(db, {
            organizationId: auth.organizationId,
            actor: auth.user.id,
            action: "relay.update",
            target: params.relayId,
            metadata: parsed,
          });

          await notifyEntityChanged(db, {
            organizationId: auth.organizationId,
            kind: "relay",
            entityId: params.relayId,
          });

          return { relay: serializeRelay(updated) };
        },
      )
      .delete(
        "/organizations/:orgId/relays/:relayId",
        async ({ authContext, params }) => {
          const auth = getAuth({ authContext });
          const existing = await db.query.relays.findFirst({
            where: and(
              eq(schema.relays.id, params.relayId),
              eq(schema.relays.organizationId, auth.organizationId),
            ),
          });
          if (!existing || existing.organizationId == null) {
            return notFound("Relay not found");
          }

          await db
            .delete(schema.relays)
            .where(
              and(
                eq(schema.relays.id, params.relayId),
                eq(schema.relays.organizationId, auth.organizationId),
              ),
            );

          await writeAudit(db, {
            organizationId: auth.organizationId,
            actor: auth.user.id,
            action: "relay.delete",
            target: params.relayId,
            metadata: { name: existing.name },
          });

          await notifyEntityChanged(db, {
            organizationId: auth.organizationId,
            kind: "relay",
            entityId: params.relayId,
          });

          return { ok: true };
        },
      ),
  );
