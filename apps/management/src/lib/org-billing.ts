import {
  type CreatablePlanId,
  effectiveSeatLimit,
  getPlan,
  isBillablePlanId,
  isCreatablePlanId,
  OWNERSHIP_CAP_UNVERIFIED,
  OWNERSHIP_CAP_VERIFIED,
  OWNERSHIP_TOMBSTONE_WINDOW_DAYS,
  type PlanId,
  planLimits,
  seatPriceEnvKey,
} from "@tunnet/api/billing";
import { getDb, schema } from "@tunnet/db";
import { and, count, eq, inArray, isNull } from "drizzle-orm";

const db = getDb();

const ACTIVE_SUB_STATUSES = ["active", "trialing"] as const;
/** Soft ceiling when extra seats are billed via Stripe seat prices. */
const SEAT_BILLING_MEMBERSHIP_CAP = 500;

export type EffectiveOrgPlan = {
  planId: PlanId;
  seats: number | null;
  resources: number | null;
  subscriptionId: string | null;
  stripeSubscriptionId: string | null;
  status: string | null;
  seatsQuantity: number | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
};

export function isSeatPriceConfigured(planId: PlanId | string): boolean {
  if (!isBillablePlanId(planId)) return false;
  return Boolean(process.env[seatPriceEnvKey(planId)]?.trim());
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

export async function getEffectiveOrgPlan(
  orgId: string,
): Promise<EffectiveOrgPlan> {
  const sub = await getActiveSubscription(orgId);
  if (sub) {
    const planId = (getPlan(sub.plan)?.id ?? "free") as PlanId;
    const included = planLimits(planId);
    return {
      planId,
      seats: effectiveSeatLimit(planId, sub.seats),
      resources: included.resources,
      subscriptionId: sub.id,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      status: sub.status,
      seatsQuantity: sub.seats,
      periodEnd: sub.periodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
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
  const effectiveId: PlanId =
    planId === "team" || planId === "business" ? "free" : planId;
  const limits = planLimits(effectiveId);
  return {
    planId: effectiveId,
    seats: limits.seats,
    resources: limits.resources,
    subscriptionId: null,
    stripeSubscriptionId: null,
    status: null,
    seatsQuantity: null,
    periodEnd: null,
    cancelAtPeriodEnd: null,
  };
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

export async function assertSeatCapacity(
  orgId: string,
  additionalSeats = 1,
): Promise<void> {
  const plan = await getEffectiveOrgPlan(orgId);
  if (plan.seats === null) return;
  // With a graduated seat price, Stripe bills extras; allow growth up to soft cap.
  const limit = isSeatPriceConfigured(plan.planId)
    ? Math.max(plan.seats, SEAT_BILLING_MEMBERSHIP_CAP)
    : plan.seats;
  const members = await countOrgMembers(orgId);
  const pending = await countPendingInvitations(orgId);
  if (members + pending + additionalSeats > limit) {
    throw new Error(
      `Organization seat limit reached (${limit}). Upgrade the plan or add seats.`,
    );
  }
}

export async function assertResourceCapacity(
  orgId: string,
  endpointId?: string,
): Promise<void> {
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
    throw new Error(
      `Organization resource limit reached (${plan.resources}). Upgrade the plan to enroll more machines.`,
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
