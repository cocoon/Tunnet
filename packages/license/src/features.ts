export const TIERS = ["community", "cloud", "enterprise"] as const;
export type LicenseTier = (typeof TIERS)[number];
export type PaidTier = Exclude<LicenseTier, "community">;

export const FEATURES = [
  "multiOrganization",
  "cloudLanding",
  "cloudInfrastructure",
  "openSignUp",
  "clickhouseAudit",
  "auditEnterpriseStreams",
  "complianceExport",
] as const;
export type Feature = (typeof FEATURES)[number];

export const LIMITS = ["organizations", "nodes", "seats", "relays"] as const;
export type Limit = (typeof LIMITS)[number];

export type LimitMap = Readonly<Record<Limit, number | null>>;
export type FeatureMap = Readonly<Record<Feature, boolean>>;

export type LicenseStatus = "community" | "active" | "grace" | "expired";

export type Entitlements = {
  readonly status: LicenseStatus;
  readonly tier: LicenseTier;
  readonly features: FeatureMap;
  readonly limits: LimitMap;
  readonly licenseId: string | null;
  readonly subject: string | null;
  readonly issuedAt: number | null;
  readonly notAfter: number | null;
  readonly graceUntil: number | null;
  readonly stale: boolean;
  readonly reason: import("./errors").LicenseFailureCode | null;
};

function featureMap(on: readonly Feature[]): FeatureMap {
  return Object.freeze(
    Object.fromEntries(FEATURES.map((f) => [f, on.includes(f)])) as Record<
      Feature,
      boolean
    >,
  );
}

const NO_LIMITS: LimitMap = Object.freeze(
  Object.fromEntries(LIMITS.map((l) => [l, null])) as Record<
    Limit,
    number | null
  >,
);

export const TIER_PRESETS: Readonly<Record<LicenseTier, FeatureMap>> =
  Object.freeze({
    community: featureMap([]),
    cloud: featureMap([...FEATURES]),
    enterprise: featureMap([
      "clickhouseAudit",
      "auditEnterpriseStreams",
      "complianceExport",
    ]),
  });

export const COMMUNITY_ENTITLEMENTS: Entitlements = Object.freeze({
  status: "community",
  tier: "community",
  features: TIER_PRESETS.community,
  limits: Object.freeze({
    organizations: 1,
    nodes: null,
    seats: null,
    relays: null,
  }),
  licenseId: null,
  subject: null,
  issuedAt: null,
  notAfter: null,
  graceUntil: null,
  stale: false,
  reason: null,
});

export function communityWithReason(
  reason: import("./errors").LicenseFailureCode | null,
  stale = false,
): Entitlements {
  return Object.freeze({ ...COMMUNITY_ENTITLEMENTS, reason, stale });
}

export function isFeature(v: unknown): v is Feature {
  return typeof v === "string" && (FEATURES as readonly string[]).includes(v);
}
export function isLimit(v: unknown): v is Limit {
  return typeof v === "string" && (LIMITS as readonly string[]).includes(v);
}
export function isTier(v: unknown): v is LicenseTier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}
export { NO_LIMITS };
