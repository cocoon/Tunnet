import { Elysia } from "elysia";

import {
  getOrgUsageSnapshot,
  isCloudBillingEnabled,
} from "../../lib/org-billing";
import { toIso } from "../../lib/serialize";
import { getAuth, requireAuth } from "./middleware/authz";

export const billingUsageRoutes = new Elysia()
  .use(requireAuth)
  .get("/organizations/:orgId/billing-usage", async ({ authContext }) => {
    const auth = getAuth({ authContext });
    const usage = await getOrgUsageSnapshot(auth.organizationId);
    const { plan } = usage;
    const billingEnabled = isCloudBillingEnabled();

    return {
      billingEnabled,
      planId: plan.planId,
      features: plan.features,
      seats: plan.seats,
      resources: plan.resources,
      networks: plan.networks,
      publicTunnels: plan.publicTunnels,
      trafficGB: plan.trafficGB,
      auditRetentionHours: plan.auditRetentionHours,
      members: usage.members,
      pendingInvitations: usage.pendingInvitations,
      seatsUsed: usage.seatsUsed,
      resourcesUsed: usage.resourcesUsed,
      networksUsed: usage.networksUsed,
      publicTunnelsUsed: usage.publicTunnelsUsed,
      trafficBytesUsed: usage.trafficBytesUsed,
      trafficBytesLimit: usage.trafficBytesLimit,
      trafficWarnLevel: usage.trafficWarnLevel,
      subscriptionId: plan.subscriptionId,
      status: plan.status,
      seatsQuantity: plan.seatsQuantity,
      periodEnd: toIso(plan.periodEnd),
      cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
    };
  });
