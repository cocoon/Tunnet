import { auditQuerySchema } from "@tunnet/api/management";
import { schema } from "@tunnet/db";
import { and, desc, eq, gte, ilike, lt, lte } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../lib/db";
import { auditRetentionCutoff } from "../../lib/org-billing";
import { toIso } from "../../lib/serialize";
import { getAuth, requireAuth } from "./middleware/authz";
import { sessionPlugin } from "./middleware/session";

export const auditRoutes = new Elysia()
  .use(sessionPlugin)
  .use(requireAuth)
  .get("/organizations/:orgId/audit-log", async ({ authContext, query }) => {
    const auth = getAuth({ authContext });
    const parsed = auditQuerySchema.parse(query);

    const conditions = [
      eq(schema.auditEvents.organizationId, auth.organizationId),
    ];

    const retentionCutoff = await auditRetentionCutoff(auth.organizationId);
    if (retentionCutoff) {
      conditions.push(gte(schema.auditEvents.time, retentionCutoff));
    }

    if (parsed.cursor !== undefined) {
      conditions.push(lt(schema.auditEvents.sequenceNumber, parsed.cursor));
    }
    if (parsed.from) {
      const from = new Date(parsed.from);
      const effectiveFrom =
        retentionCutoff && from < retentionCutoff ? retentionCutoff : from;
      conditions.push(gte(schema.auditEvents.time, effectiveFrom));
    }
    if (parsed.to) {
      conditions.push(lte(schema.auditEvents.time, new Date(parsed.to)));
    }
    if (parsed.classUid !== undefined) {
      conditions.push(eq(schema.auditEvents.classUid, parsed.classUid));
    }
    if (parsed.actorId) {
      conditions.push(eq(schema.auditEvents.actorId, parsed.actorId));
    }
    if (parsed.targetType) {
      conditions.push(eq(schema.auditEvents.targetType, parsed.targetType));
    }
    if (parsed.targetId) {
      conditions.push(eq(schema.auditEvents.targetId, parsed.targetId));
    }
    if (parsed.severityId !== undefined) {
      conditions.push(eq(schema.auditEvents.severityId, parsed.severityId));
    }
    if (parsed.search) {
      conditions.push(ilike(schema.auditEvents.message, `%${parsed.search}%`));
    }

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(and(...conditions))
      .orderBy(desc(schema.auditEvents.sequenceNumber))
      .limit(parsed.limit + 1);

    const hasMore = rows.length > parsed.limit;
    const entries = hasMore ? rows.slice(0, parsed.limit) : rows;
    const nextCursor = hasMore
      ? (entries[entries.length - 1]?.sequenceNumber ?? null)
      : null;

    return {
      entries: entries.map((row) => ({
        organizationId: row.organizationId,
        sequenceNumber: row.sequenceNumber,
        categoryUid: row.categoryUid,
        classUid: row.classUid,
        activityId: row.activityId,
        typeUid: row.typeUid,
        severityId: row.severityId,
        statusId: row.statusId,
        time: toIso(row.time)!,
        message: row.message,
        actor: {
          actorType: row.actorType,
          actorId: row.actorId,
          displayName: row.actorName,
          email: row.actorEmail,
          ipAddress: row.actorIp,
        },
        target: {
          targetType: row.targetType,
          targetId: row.targetId,
          displayName: row.targetName,
        },
        networkId: row.networkId,
        groupId: row.groupId,
        diff:
          row.diffBefore != null || row.diffAfter != null
            ? {
                before: (row.diffBefore as Record<string, unknown>) ?? {},
                after: (row.diffAfter as Record<string, unknown>) ?? {},
              }
            : null,
        metadata: row.metadata as Record<string, unknown>,
        traceId: row.traceId,
        entryHash: row.entryHash,
      })),
      nextCursor,
    };
  });
