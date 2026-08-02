import { useQuery } from "@tanstack/react-query";
import { entitlementsSchema } from "@tunnet/api/management";
import {
  COMMUNITY_ENTITLEMENTS,
  type Entitlements,
  type Feature,
} from "@tunnet/license";

import { getManagementApiUrl } from "@/lib/env";

export async function fetchEntitlements(): Promise<Entitlements> {
  const response = await fetch(`${getManagementApiUrl()}/api/v1/entitlements`, {
    credentials: "include",
  });
  if (!response.ok) return COMMUNITY_ENTITLEMENTS;
  const data: unknown = await response.json();
  const parsed = entitlementsSchema.safeParse(data);
  return parsed.success
    ? (parsed.data as Entitlements)
    : COMMUNITY_ENTITLEMENTS;
}

export function useEntitlements() {
  return useQuery({
    queryKey: ["entitlements"],
    queryFn: fetchEntitlements,
    staleTime: 60_000,
  });
}

export function useFeature(feature: Feature): boolean {
  const { data } = useEntitlements();
  return data?.features[feature] === true;
}
