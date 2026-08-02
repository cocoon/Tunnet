import { randomBytes } from "node:crypto";
import { createRelayBody, patchRelayBody } from "@tunnet/api/management";
import { schema } from "@tunnet/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Elysia } from "elysia";
import { blake3 } from "hash-wasm";

import { writeAudit } from "../../lib/audit";
import { db } from "../../lib/db";
import { toIso } from "../../lib/serialize";
import {
  getSessionUser,
  requireCloudAccess,
  requireCloudInfrastructure,
  requireSessionAuth,
} from "./middleware/authz";
import { notFound, sessionUserPlugin } from "./middleware/session";

const DEPLOYMENT_AUDIT_ORG = "_deployment";

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

export const cloudRelaysRoutes = new Elysia({ prefix: "/cloud/relays" })
  .use(sessionUserPlugin)
  .use(requireSessionAuth)
  .use(requireCloudInfrastructure)
  .use(requireCloudAccess)
  .get("/", async () => {
    const rows = await db.query.relays.findMany({
      where: isNull(schema.relays.organizationId),
      orderBy: [desc(schema.relays.createdAt)],
    });
    return { relays: rows.map(serializeRelay) };
  })
  .get("/:relayId", async ({ params }) => {
    const row = await db.query.relays.findFirst({
      where: and(
        eq(schema.relays.id, params.relayId),
        isNull(schema.relays.organizationId),
      ),
    });
    if (!row) return notFound("Relay not found");
    return { relay: serializeRelay(row) };
  })
  .get("/:relayId/health", async ({ params, query }) => {
    const relay = await db.query.relays.findFirst({
      where: and(
        eq(schema.relays.id, params.relayId),
        isNull(schema.relays.organizationId),
      ),
    });
    if (!relay) return notFound("Relay not found");

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
  })
  .post("/", async ({ sessionUser, body }) => {
    const user = getSessionUser({ sessionUser });
    const parsed = createRelayBody.parse(body);

    const token = randomBytes(32).toString("base64url");
    const tokenHash = await blake3(Buffer.from(token));
    const expiresAt = new Date(Date.now() + 60 * 60_000);

    const result = await db.transaction(async (tx) => {
      const [relay] = await tx
        .insert(schema.relays)
        .values({
          organizationId: null,
          name: parsed.name,
          url: parsed.url,
          region: parsed.region,
          qadEnabled: parsed.qadEnabled,
          metricsUrl: parsed.metricsUrl ?? null,
          accessMode: parsed.accessMode,
          status: "pending",
        })
        .returning();

      await tx.insert(schema.relayRegistrationTokens).values({
        tokenHash,
        organizationId: null,
        relayId: relay!.id,
        createdBy: user.user.id,
        expiresAt,
      });

      await writeAudit(tx, {
        organizationId: DEPLOYMENT_AUDIT_ORG,
        actor: user.user.id,
        action: "relay.create",
        target: relay?.id,
        metadata: { name: parsed.name, scope: "deployment" },
      });

      return relay!;
    });

    return {
      relay: serializeRelay(result),
      registrationToken: token,
      expiresAt: toIso(expiresAt)!,
    };
  })
  .patch("/:relayId", async ({ sessionUser, params, body }) => {
    const user = getSessionUser({ sessionUser });
    const parsed = patchRelayBody.parse(body);

    const existing = await db.query.relays.findFirst({
      where: and(
        eq(schema.relays.id, params.relayId),
        isNull(schema.relays.organizationId),
      ),
    });
    if (!existing) return notFound("Relay not found");

    const [updated] = await db
      .update(schema.relays)
      .set(patchRelayValues(parsed))
      .where(
        and(
          eq(schema.relays.id, params.relayId),
          isNull(schema.relays.organizationId),
        ),
      )
      .returning();

    await writeAudit(db, {
      organizationId: DEPLOYMENT_AUDIT_ORG,
      actor: user.user.id,
      action: "relay.update",
      target: params.relayId,
      metadata: { ...parsed, scope: "deployment" },
    });

    return { relay: serializeRelay(updated!) };
  })
  .delete("/:relayId", async ({ sessionUser, params }) => {
    const user = getSessionUser({ sessionUser });
    const existing = await db.query.relays.findFirst({
      where: and(
        eq(schema.relays.id, params.relayId),
        isNull(schema.relays.organizationId),
      ),
    });
    if (!existing) return notFound("Relay not found");

    await db
      .delete(schema.relays)
      .where(
        and(
          eq(schema.relays.id, params.relayId),
          isNull(schema.relays.organizationId),
        ),
      );

    await writeAudit(db, {
      organizationId: DEPLOYMENT_AUDIT_ORG,
      actor: user.user.id,
      action: "relay.delete",
      target: params.relayId,
      metadata: { name: existing.name, scope: "deployment" },
    });

    return { ok: true };
  });
