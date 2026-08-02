import { useQuery } from "@tanstack/react-query";
import type { PlanFeatures, PlanId } from "@tunnet/api/billing";
import { useFeature } from "@/hooks/use-entitlements";
import { useActiveOrganization } from "@/lib/auth-client";
import { getManagementApiUrl } from "@/lib/env";
import { queryKeys } from "@/lib/query-keys";

export type OrgBillingUsage = {
  billingEnabled?: boolean;
  planId: string;
  features: Record<string, boolean>;
  seats: number | null;
  resources: number | null;
  networks: number | null;
  publicTunnels: number | null;
  trafficGB: number | null;
  auditRetentionHours: number | null;
  members: number;
  pendingInvitations: number;
  seatsUsed: number;
  resourcesUsed: number;
  networksUsed: number;
  publicTunnelsUsed: number;
  trafficBytesUsed: number;
  trafficBytesLimit: number | null;
  trafficWarnLevel: "ok" | "warn" | "exceeded";
  subscriptionId: string | null;
  status: string | null;
  seatsQuantity: number | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
};

export async function fetchOrgBillingUsage(
  orgId: string,
): Promise<OrgBillingUsage> {
  const response = await fetch(
    `${getManagementApiUrl()}/api/v1/organizations/${orgId}/billing-usage`,
    {
      credentials: "include",
      headers: { "X-Organization-Id": orgId },
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? response.statusText);
  }
  return (await response.json()) as OrgBillingUsage;
}

export function useOrgPlan() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const openSignUp = useFeature("openSignUp");

  return useQuery({
    queryKey: orgId ? queryKeys.billingUsage(orgId) : ["billing-usage"],
    enabled: Boolean(orgId) && openSignUp,
    queryFn: () => fetchOrgBillingUsage(orgId!),
    staleTime: 30_000,
  });
}

export function usePlanFeature(feature: keyof PlanFeatures): boolean {
  const openSignUp = useFeature("openSignUp");
  const { data } = useOrgPlan();
  if (!openSignUp) return true;
  return data?.features?.[feature] === true;
}

export function useOrgPlanId(): PlanId {
  const { data } = useOrgPlan();
  return (data?.planId as PlanId) || "free";
}

/** True when invites are blocked by plan feature or seat capacity. */
export function inviteBlockedReason(
  usage: OrgBillingUsage | undefined,
): "no_invites" | "seat_limit" | null {
  // Non-cloud (openSignUp off): query disabled → usage undefined; also honor billingEnabled.
  if (!usage || usage.billingEnabled === false) return null;
  if (!usage.features?.invites) return "no_invites";
  if (usage.seats != null && usage.seatsUsed >= usage.seats) {
    return "seat_limit";
  }
  return null;
}
