import {
  type CreatablePlanId,
  effectiveSeatLimit,
  getPlan,
  isBillablePlanId,
  isCreatablePlanId,
  isPerSeatPlanId,
  OWNERSHIP_CAP_UNVERIFIED,
  OWNERSHIP_CAP_VERIFIED,
  OWNERSHIP_TOMBSTONE_WINDOW_DAYS,
  type PlanFeature,
  type PlanFeatures,
  type PlanId,
  type PlanLimits,
  planHasFeature,
  planLimits,
  priceEnvKey,
  requiredPlanForFeature,
  resourceLimit,
} from "@tunnet/api/billing";
import { getDb, schema } from "@tunnet/db";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { PlanLimitError, PlanRequiredError } from "./plan-errors";

const db = getDb();

const ACTIVE_SUB_STATUSES = ["active", "trialing"] as const;
/** Soft ceiling for per-seat plans so runaway invites cannot explode Stripe quantity. */
const SEAT_BILLING_MEMBERSHIP_CAP = 500;

/** Org subscription limits / metering only apply on cloud SaaS license. */
let cloudBillingEnabled = false;

export function setCloudBillingEnabled(enabled: boolean): void {
  cloudBillingEnabled = enabled;
}

export function isCloudBillingEnabled(): boolean {
  return cloudBillingEnabled;
}

export type EffectiveOrgPlan = {
  planId: PlanId;
  seats: number | null;
  resources: number | null;
  networks: number | null;
  publicTunnels: number | null;
  trafficGB: number | null;
  auditRetentionHours: number | null;
  features: PlanFeatures;
  limits: PlanLimits;
  subscriptionId: string | null;
  stripeSubscriptionId: string | null;
  status: string | null;
  seatsQuantity: number | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
};

export type OrgUsageSnapshot = {
  plan: EffectiveOrgPlan;
  members: number;
  pendingInvitations: number;
  seatsUsed: number;
  resourcesUsed: number;
  networksUsed: number;
  publicTunnelsUsed: number;
  trafficBytesUsed: number;
  trafficBytesLimit: number | null;
  trafficWarnLevel: "ok" | "warn" | "exceeded";
};

export function isPriceConfigured(planId: PlanId | string): boolean {
  if (!isBillablePlanId(planId)) return false;
  return Boolean(process.env[priceEnvKey(planId)]?.trim());
}

/** @deprecated Use isPriceConfigured */
export function isSeatPriceConfigured(planId: PlanId | string): boolean {
  return isPriceConfigured(planId);
}

export function isOwnerRole(role: string): boolean {
  return role
    .split(",")
    .map((part) => part.trim())
    .includes("owner");
}

export function isAdminOrOwnerRole(role: string): boolean {
  const parts = role.split(",").map((part) => part.trim());
  return parts.includes("owner") || parts.includes("admin");
}

export function ownershipCapForUser(emailVerified: boolean): number {
  return emailVerified ? OWNERSHIP_CAP_VERIFIED : OWNERSHIP_CAP_UNVERIFIED;
}

export function ownershipWindowStart(now = new Date()): Date {
  return new Date(
    now.getTime() - OWNERSHIP_TOMBSTONE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}

/** Whether a (possibly soft-deleted) org still counts toward ownership quota. */
export function orgCountsTowardOwnershipQuota(
  org: {
    deletedAt: Date | null;
    createdAt: Date;
  },
  now = new Date(),
): boolean {
  if (!org.deletedAt) return true;
  return org.createdAt >= ownershipWindowStart(now);
}

export async function countOwnedOrganizationsTowardQuota(
  userId: string,
  now = new Date(),
): Promise<number> {
  const memberships = await db.query.member.findMany({
    where: eq(schema.member.userId, userId),
    with: { organization: true },
  });

  let total = 0;
  for (const membership of memberships) {
    if (!isOwnerRole(membership.role)) continue;
    const org = membership.organization;
    if (!org) continue;
    if (orgCountsTowardOwnershipQuota(org, now)) total += 1;
  }
  return total;
}

export async function getActiveSubscription(orgId: string) {
  const rows = await db.query.subscription.findMany({
    where: and(
      eq(schema.subscription.referenceId, orgId),
      inArray(schema.subscription.status, [...ACTIVE_SUB_STATUSES]),
    ),
  });
  return rows[0] ?? null;
}

function buildEffective(
  planId: PlanId,
  seatsQuantity: number | null,
  sub: {
    id: string;
    stripeSubscriptionId: string | null;
    status: string;
    periodEnd: Date | null;
    cancelAtPeriodEnd: boolean | null;
  } | null,
): EffectiveOrgPlan {
  const plan = getPlan(planId) ?? getPlan("free")!;
  const seats = effectiveSeatLimit(planId, seatsQuantity);
  return {
    planId,
    seats,
    resources: resourceLimit(planId, seats),
    networks: plan.limits.networks,
    publicTunnels: plan.limits.publicTunnels,
    trafficGB: plan.limits.trafficGB,
    auditRetentionHours: plan.limits.auditRetentionHours,
    features: plan.features,
    limits: plan.limits,
    subscriptionId: sub?.id ?? null,
    stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
    status: sub?.status ?? null,
    seatsQuantity,
    periodEnd: sub?.periodEnd ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? null,
  };
}

function unlimitedOrgPlan(): EffectiveOrgPlan {
  return buildEffective("enterprise", null, null);
}

export async function getEffectiveOrgPlan(
  orgId: string,
): Promise<EffectiveOrgPlan> {
  if (!isCloudBillingEnabled()) return unlimitedOrgPlan();

  const sub = await getActiveSubscription(orgId);
  if (sub) {
    const planId = (getPlan(sub.plan)?.id ?? "free") as PlanId;
    return buildEffective(planId, sub.seats, {
      id: sub.id,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      status: sub.status,
      periodEnd: sub.periodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    });
  }

  const org = await db.query.organization.findFirst({
    where: eq(schema.organization.id, orgId),
  });
  const metadata = (org?.metadata ?? {}) as { plan?: string };
  const metaPlan = metadata.plan;
  const planId: PlanId =
    metaPlan && getPlan(metaPlan) && metaPlan !== "enterprise"
      ? (metaPlan as PlanId)
      : "free";
  // Paid metadata without an active subscription still runs as free limits.
  const effectiveId: PlanId = isBillablePlanId(planId) ? "free" : planId;
  return buildEffective(effectiveId, null, null);
}

export async function countOrgMembers(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, orgId));
  return row?.value ?? 0;
}

export async function countPendingInvitations(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, orgId),
        eq(schema.invitation.status, "pending"),
      ),
    );
  return row?.value ?? 0;
}

export async function countOrgDevices(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.devices)
    .where(eq(schema.devices.organizationId, orgId));
  return row?.value ?? 0;
}

export async function countOrgNetworks(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.networks)
    .where(eq(schema.networks.organizationId, orgId));
  return row?.value ?? 0;
}

const ACTIVE_TUNNEL_STATUSES = ["connecting", "active"] as const;

export async function countOrgPublicTunnels(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.tunnels)
    .where(
      and(
        eq(schema.tunnels.organizationId, orgId),
        inArray(schema.tunnels.status, [...ACTIVE_TUNNEL_STATUSES]),
      ),
    );
  return row?.value ?? 0;
}

export function currentUsageMonth(now = new Date()): number {
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
}

export async function getOrgTrafficBytes(
  orgId: string,
  month = currentUsageMonth(),
): Promise<number> {
  const [row] = await db
    .select()
    .from(schema.orgUsageMonthly)
    .where(
      and(
        eq(schema.orgUsageMonthly.organizationId, orgId),
        eq(schema.orgUsageMonthly.month, month),
      ),
    )
    .limit(1);
  if (!row) return 0;
  return row.relayBytes + row.publicTunnelBytes;
}

export async function incrementOrgTraffic(
  orgId: string,
  kind: "relay" | "public_tunnel",
  bytes: number,
  month = currentUsageMonth(),
): Promise<void> {
  if (!isCloudBillingEnabled()) return;
  if (bytes <= 0) return;
  const relayInc = kind === "relay" ? bytes : 0;
  const tunnelInc = kind === "public_tunnel" ? bytes : 0;

  await db
    .insert(schema.orgUsageMonthly)
    .values({
      organizationId: orgId,
      month,
      relayBytes: relayInc,
      publicTunnelBytes: tunnelInc,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.orgUsageMonthly.organizationId,
        schema.orgUsageMonthly.month,
      ],
      set: {
        relayBytes: sql`${schema.orgUsageMonthly.relayBytes} + ${relayInc}`,
        publicTunnelBytes: sql`${schema.orgUsageMonthly.publicTunnelBytes} + ${tunnelInc}`,
        updatedAt: new Date(),
      },
    });
}

function trafficWarnLevel(
  used: number,
  limitBytes: number | null,
): "ok" | "warn" | "exceeded" {
  if (limitBytes == null || limitBytes <= 0) return "ok";
  if (used >= limitBytes) return "exceeded";
  if (used >= limitBytes * 0.8) return "warn";
  return "ok";
}

export async function getOrgUsageSnapshot(
  orgId: string,
): Promise<OrgUsageSnapshot> {
  const plan = await getEffectiveOrgPlan(orgId);
  const [
    members,
    pendingInvitations,
    resourcesUsed,
    networksUsed,
    publicTunnelsUsed,
    trafficBytesUsed,
  ] = await Promise.all([
    countOrgMembers(orgId),
    countPendingInvitations(orgId),
    countOrgDevices(orgId),
    countOrgNetworks(orgId),
    countOrgPublicTunnels(orgId),
    getOrgTrafficBytes(orgId),
  ]);

  const trafficBytesLimit =
    plan.trafficGB == null ? null : plan.trafficGB * 1024 * 1024 * 1024;

  return {
    plan,
    members,
    pendingInvitations,
    seatsUsed: members + pendingInvitations,
    resourcesUsed,
    networksUsed,
    publicTunnelsUsed,
    trafficBytesUsed,
    trafficBytesLimit,
    trafficWarnLevel: isCloudBillingEnabled()
      ? trafficWarnLevel(trafficBytesUsed, trafficBytesLimit)
      : "ok",
  };
}

export async function requirePlanFeature(
  orgId: string,
  feature: PlanFeature,
): Promise<EffectiveOrgPlan> {
  if (!isCloudBillingEnabled()) return unlimitedOrgPlan();

  const plan = await getEffectiveOrgPlan(orgId);
  if (!planHasFeature(plan.planId, feature)) {
    throw new PlanRequiredError(
      feature,
      requiredPlanForFeature(feature),
      plan.planId,
    );
  }
  return plan;
}

export async function assertSeatCapacity(
  orgId: string,
  additionalSeats = 1,
): Promise<void> {
  if (!isCloudBillingEnabled()) return;

  const plan = await getEffectiveOrgPlan(orgId);

  if (!plan.features.invites && additionalSeats > 0) {
    const members = await countOrgMembers(orgId);
    if (members + additionalSeats > 1) {
      throw new PlanLimitError(
        "seats",
        1,
        members,
        "team",
        "This plan allows only 1 user. Upgrade to Team to invite members.",
      );
    }
  }

  if (plan.seats === null) return;

  const limit = isPerSeatPlanId(plan.planId)
    ? Math.min(
        Math.max(plan.seats, plan.limits.minSeats ?? 1),
        SEAT_BILLING_MEMBERSHIP_CAP,
      )
    : plan.seats;

  const members = await countOrgMembers(orgId);
  const pending = await countPendingInvitations(orgId);
  if (members + pending + additionalSeats > limit) {
    throw new PlanLimitError(
      "seats",
      limit,
      members + pending,
      isPerSeatPlanId(plan.planId) ? undefined : "team",
      `Organization seat limit reached (${limit}). ${
        isPerSeatPlanId(plan.planId)
          ? "Add seats in billing."
          : "Upgrade the plan to invite members."
      }`,
    );
  }
}

export async function assertResourceCapacity(
  orgId: string,
  endpointId?: string,
): Promise<void> {
  if (!isCloudBillingEnabled()) return;

  const plan = await getEffectiveOrgPlan(orgId);
  if (plan.resources === null) return;

  if (endpointId) {
    const existing = await db.query.devices.findFirst({
      where: and(
        eq(schema.devices.organizationId, orgId),
        eq(schema.devices.endpointId, endpointId),
      ),
    });
    if (existing) return;
  }

  const devices = await countOrgDevices(orgId);
  if (devices >= plan.resources) {
    throw new PlanLimitError(
      "resources",
      plan.resources,
      devices,
      undefined,
      `Organization resource limit reached (${plan.resources}). Upgrade the plan to enroll more machines.`,
    );
  }
}

export async function assertNetworkCapacity(orgId: string): Promise<void> {
  if (!isCloudBillingEnabled()) return;

  const plan = await getEffectiveOrgPlan(orgId);
  if (plan.networks === null) return;
  const used = await countOrgNetworks(orgId);
  if (used >= plan.networks) {
    throw new PlanLimitError(
      "networks",
      plan.networks,
      used,
      undefined,
      `Organization network limit reached (${plan.networks}). Upgrade the plan to create more networks.`,
    );
  }
}

export async function assertPublicTunnelCapacity(orgId: string): Promise<void> {
  if (!isCloudBillingEnabled()) return;

  const plan = await getEffectiveOrgPlan(orgId);
  if (plan.publicTunnels === null) return;
  const used = await countOrgPublicTunnels(orgId);
  if (used >= plan.publicTunnels) {
    throw new PlanLimitError(
      "publicTunnels",
      plan.publicTunnels,
      used,
      undefined,
      `Organization public tunnel limit reached (${plan.publicTunnels}). Upgrade the plan to create more tunnels.`,
    );
  }
}

export function parseCreatablePlan(metadata: unknown): CreatablePlanId | null {
  if (!metadata || typeof metadata !== "object") return null;
  const plan = (metadata as { plan?: unknown }).plan;
  if (typeof plan !== "string" || !isCreatablePlanId(plan)) return null;
  return plan;
}

export async function softDeleteOrganization(orgId: string): Promise<void> {
  const org = await db.query.organization.findFirst({
    where: eq(schema.organization.id, orgId),
  });
  if (!org) {
    throw new Error("Organization not found");
  }
  if (org.deletedAt) {
    throw new Error("Organization already deleted");
  }

  const activeSub = await getActiveSubscription(orgId);
  if (activeSub) {
    throw new Error(
      "Cancel the active subscription before deleting this organization",
    );
  }

  const deletedSlug = `${org.slug}-deleted-${Date.now()}`;
  await db
    .update(schema.organization)
    .set({
      deletedAt: new Date(),
      slug: deletedSlug,
    })
    .where(eq(schema.organization.id, orgId));

  await db
    .update(schema.session)
    .set({ activeOrganizationId: null })
    .where(eq(schema.session.activeOrganizationId, orgId));
}

export async function requireActiveOrganization(orgId: string) {
  const org = await db.query.organization.findFirst({
    where: and(
      eq(schema.organization.id, orgId),
      isNull(schema.organization.deletedAt),
    ),
  });
  if (!org) {
    throw new Error("Organization not found");
  }
  return org;
}

export async function memberRoleInOrg(
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(schema.member.userId, userId),
      eq(schema.member.organizationId, organizationId),
    ),
  });
  return membership?.role ?? null;
}

export async function auditRetentionCutoff(
  orgId: string,
  now = new Date(),
): Promise<Date | null> {
  const plan = await getEffectiveOrgPlan(orgId);
  if (plan.auditRetentionHours == null) return null;
  return new Date(now.getTime() - plan.auditRetentionHours * 60 * 60 * 1000);
}

/** Delete audit events older than each org's plan retention (cloud SaaS TTL). */
export async function pruneAuditEventsBeyondRetention(
  now = new Date(),
): Promise<number> {
  if (!isCloudBillingEnabled()) return 0;

  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(isNull(schema.organization.deletedAt));

  let deleted = 0;
  for (const org of orgs) {
    const cutoff = await auditRetentionCutoff(org.id, now);
    if (!cutoff) continue;
    const result = await db.execute(
      sql`DELETE FROM audit_events WHERE organization_id = ${org.id} AND time < ${cutoff}`,
    );
    deleted += Number(result.rowCount ?? 0);
  }
  return deleted;
}

export { PlanLimitError, PlanRequiredError };
