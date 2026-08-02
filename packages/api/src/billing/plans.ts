export type PlanId = "free" | "personal" | "team" | "business" | "enterprise";

export type PlanFeature =
  | "invites"
  | "customDomains"
  | "apiAccess"
  | "kubernetes"
  | "basicPosture"
  | "oidcSso"
  | "customRoles"
  | "policyAsCode"
  | "advancedPolicies"
  | "samlSso"
  | "scim"
  | "advancedRbac"
  | "advancedPosture"
  | "sshRecording"
  | "logStreaming"
  | "complianceExport"
  | "domainClaiming"
  | "regionalRelays";

export type PlanFeatures = Record<PlanFeature, boolean>;

export type PlanLimits = {
  /** Minimum purchasable / included seats for this plan. */
  minSeats: number | null;
  /** Hard maximum seats (null = unlimited). */
  maxSeats: number | null;
  /** Fixed resource cap when perSeatResources is 0; else base of formula. */
  baseResources: number | null;
  /** Extra resources per seat above minSeats. */
  perSeatResources: number;
  networks: number | null;
  publicTunnels: number | null;
  trafficGB: number | null;
  auditRetentionHours: number | null;
};

export type Plan = {
  id: PlanId;
  name: string;
  /** Flat monthly price (Personal) or per-seat monthly price (Team/Business). Null = custom. */
  price: number | null;
  /** How price is charged. */
  pricing: "free" | "flat" | "per_seat" | "custom";
  cadence: string;
  limits: PlanLimits;
  features: PlanFeatures;
  pitch: string;
  cta: string;
  featureBullets: string[];
  highlight?: boolean;
  trialDays: number | null;
  support: string;
};

const NONE: PlanFeatures = {
  invites: false,
  customDomains: false,
  apiAccess: false,
  kubernetes: false,
  basicPosture: false,
  oidcSso: false,
  customRoles: false,
  policyAsCode: false,
  advancedPolicies: false,
  samlSso: false,
  scim: false,
  advancedRbac: false,
  advancedPosture: false,
  sshRecording: false,
  logStreaming: false,
  complianceExport: false,
  domainClaiming: false,
  regionalRelays: false,
};

function features(enabled: PlanFeature[]): PlanFeatures {
  const out = { ...NONE };
  for (const f of enabled) out[f] = true;
  return out;
}

export const OWNERSHIP_CAP_VERIFIED = 3;
export const OWNERSHIP_CAP_UNVERIFIED = 1;
export const OWNERSHIP_TOMBSTONE_WINDOW_DAYS = 30;

export const BILLABLE_PLAN_IDS = ["personal", "team", "business"] as const;
export type BillablePlanId = (typeof BILLABLE_PLAN_IDS)[number];

export const CREATABLE_PLAN_IDS = [
  "free",
  "personal",
  "team",
  "business",
] as const;
export type CreatablePlanId = (typeof CREATABLE_PLAN_IDS)[number];

export const PER_SEAT_PLAN_IDS = ["team", "business"] as const;
export type PerSeatPlanId = (typeof PER_SEAT_PLAN_IDS)[number];

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    pricing: "free",
    cadence: "forever",
    limits: {
      minSeats: 1,
      maxSeats: 1,
      baseResources: 20,
      perSeatResources: 0,
      networks: 1,
      publicTunnels: 1,
      trafficGB: 5,
      auditRetentionHours: 24,
    },
    features: features([]),
    pitch: "Try Tunnet on a small homelab.",
    cta: "Start free",
    featureBullets: [
      "1 user",
      "20 resources",
      "1 network · 1 public tunnel",
      "5 GB managed traffic",
      "24-hour audit logs",
      "Mesh · DNS · Serve · Send · SSH",
    ],
    trialDays: null,
    support: "Community",
  },
  {
    id: "personal",
    name: "Personal",
    price: 5,
    pricing: "flat",
    cadence: "/month",
    limits: {
      minSeats: 1,
      maxSeats: 1,
      baseResources: 100,
      perSeatResources: 0,
      networks: 5,
      publicTunnels: 5,
      trafficGB: 50,
      auditRetentionHours: 24 * 30,
    },
    features: features([
      "customDomains",
      "apiAccess",
      "kubernetes",
      "basicPosture",
    ]),
    pitch: "Serious solo use - machines, tunnels, and automation.",
    cta: "Upgrade",
    highlight: true,
    featureBullets: [
      "1 user",
      "100 resources",
      "5 networks · 5 public tunnels",
      "50 GB managed traffic",
      "30-day audit logs",
      "Custom domains · API · Kubernetes",
    ],
    trialDays: 14,
    support: "Email",
  },
  {
    id: "team",
    name: "Team",
    price: 5,
    pricing: "per_seat",
    cadence: "/user/month",
    limits: {
      minSeats: 2,
      maxSeats: null,
      baseResources: 100,
      perSeatResources: 25,
      networks: 10,
      publicTunnels: 25,
      trafficGB: 250,
      auditRetentionHours: 24 * 90,
    },
    features: features([
      "invites",
      "customDomains",
      "apiAccess",
      "kubernetes",
      "basicPosture",
      "oidcSso",
      "customRoles",
      "policyAsCode",
      "advancedPolicies",
    ]),
    pitch: "Collaborate with shared org management and SSO.",
    cta: "Start trial",
    featureBullets: [
      "$5/user · 2-user minimum",
      "100 resources + 25 per extra seat",
      "10 networks · 25 public tunnels",
      "250 GB managed traffic",
      "90-day audit logs",
      "OIDC SSO · custom roles · Policy as Code",
    ],
    trialDays: 14,
    support: "Email",
  },
  {
    id: "business",
    name: "Business",
    price: 10,
    pricing: "per_seat",
    cadence: "/user/month",
    limits: {
      minSeats: 5,
      maxSeats: null,
      baseResources: 500,
      perSeatResources: 50,
      networks: 50,
      publicTunnels: 100,
      trafficGB: 1024,
      auditRetentionHours: 24 * 365,
    },
    features: features([
      "invites",
      "customDomains",
      "apiAccess",
      "kubernetes",
      "basicPosture",
      "oidcSso",
      "customRoles",
      "policyAsCode",
      "advancedPolicies",
      "samlSso",
      "scim",
      "advancedRbac",
      "advancedPosture",
      "sshRecording",
      "logStreaming",
      "complianceExport",
      "domainClaiming",
      "regionalRelays",
    ]),
    pitch: "Security, compliance, and advanced controls.",
    cta: "Start trial",
    featureBullets: [
      "$10/user · 5-user minimum",
      "500 resources + 50 per extra seat",
      "50 networks · 100 public tunnels",
      "1 TB managed traffic",
      "365-day audit logs",
      "SAML · SCIM · SSH recording · compliance",
    ],
    trialDays: 14,
    support: "Priority",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null,
    pricing: "custom",
    cadence: "custom",
    limits: {
      minSeats: null,
      maxSeats: null,
      baseResources: null,
      perSeatResources: 0,
      networks: null,
      publicTunnels: null,
      trafficGB: null,
      auditRetentionHours: null,
    },
    features: features([
      "invites",
      "customDomains",
      "apiAccess",
      "kubernetes",
      "basicPosture",
      "oidcSso",
      "customRoles",
      "policyAsCode",
      "advancedPolicies",
      "samlSso",
      "scim",
      "advancedRbac",
      "advancedPosture",
      "sshRecording",
      "logStreaming",
      "complianceExport",
      "domainClaiming",
      "regionalRelays",
    ]),
    pitch: "Custom contracts and dedicated deployments.",
    cta: "Talk to sales",
    featureBullets: [
      "Custom limits",
      "Dedicated relays & control plane",
      "Self-hosted commercial license",
      "Air-gapped & data residency",
      "Custom SLA · 24/7 support",
      "Security review · invoice contracts",
    ],
    trialDays: null,
    support: "24/7 · SLA",
  },
];

const PLAN_BY_ID = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<
  PlanId,
  Plan
>;

/** Lowest plan that unlocks a feature (for upgrade CTAs). */
const FEATURE_REQUIRED_PLAN: Record<PlanFeature, PlanId> = {
  invites: "team",
  customDomains: "personal",
  apiAccess: "personal",
  kubernetes: "personal",
  basicPosture: "personal",
  oidcSso: "team",
  customRoles: "team",
  policyAsCode: "team",
  advancedPolicies: "team",
  samlSso: "business",
  scim: "business",
  advancedRbac: "business",
  advancedPosture: "business",
  sshRecording: "business",
  logStreaming: "business",
  complianceExport: "business",
  domainClaiming: "business",
  regionalRelays: "business",
};

export function getPlan(id: string | null | undefined): Plan | undefined {
  if (!id) return undefined;
  return PLAN_BY_ID[id as PlanId];
}

export function isCreatablePlanId(id: string): id is CreatablePlanId {
  return (CREATABLE_PLAN_IDS as readonly string[]).includes(id);
}

export function isBillablePlanId(id: string): id is BillablePlanId {
  return (BILLABLE_PLAN_IDS as readonly string[]).includes(id);
}

export function isPerSeatPlanId(id: string): id is PerSeatPlanId {
  return (PER_SEAT_PLAN_IDS as readonly string[]).includes(id);
}

export function planLimits(id: PlanId | string): PlanLimits {
  const plan = getPlan(id) ?? PLAN_BY_ID.free;
  return plan.limits;
}

export function planHasFeature(
  planId: PlanId | string,
  feature: PlanFeature,
): boolean {
  const plan = getPlan(planId) ?? PLAN_BY_ID.free;
  return plan.features[feature];
}

export function requiredPlanForFeature(feature: PlanFeature): PlanId {
  return FEATURE_REQUIRED_PLAN[feature];
}

export function minimumSeats(planId: PlanId | string): number {
  const limits = planLimits(planId);
  return limits.minSeats ?? 1;
}

/**
 * Resource cap for a plan at a given seat count.
 * Team/Business: baseResources + perSeatResources * max(0, seats - minSeats).
 */
export function resourceLimit(
  planId: PlanId | string,
  seats: number | null | undefined,
): number | null {
  const limits = planLimits(planId);
  if (limits.baseResources === null) return null;
  const min = limits.minSeats ?? 1;
  const seatCount = Math.max(seats ?? min, min);
  const extra = Math.max(0, seatCount - min);
  return limits.baseResources + limits.perSeatResources * extra;
}

/** @deprecated Prefer resourceLimit - kept as seats/resources snapshot for callers. */
export function planLimitsSnapshot(
  planId: PlanId | string,
  seats?: number | null,
): {
  seats: number | null;
  resources: number | null;
  trafficGB: number | null;
  networks: number | null;
  publicTunnels: number | null;
  auditRetentionHours: number | null;
} {
  const limits = planLimits(planId);
  const seatCap = limits.maxSeats;
  return {
    seats: seatCap,
    resources: resourceLimit(planId, seats ?? limits.minSeats),
    trafficGB: limits.trafficGB,
    networks: limits.networks,
    publicTunnels: limits.publicTunnels,
    auditRetentionHours: limits.auditRetentionHours,
  };
}

/** Monthly cost for a plan at a given seat count, or null for custom plans. */
export function seatCost(plan: Plan, seats: number): number | null {
  if (plan.price === null) return null;
  if (plan.pricing === "free") return 0;
  if (plan.pricing === "flat") return plan.price;
  if (plan.pricing === "per_seat") {
    const min = plan.limits.minSeats ?? 1;
    return plan.price * Math.max(seats, min);
  }
  return null;
}

/** The smallest plan whose resource cap at minimum seats fits a given resource count. */
export function planForResources(resources: number): Plan {
  for (const p of PLANS) {
    const cap = resourceLimit(p.id, p.limits.minSeats);
    if (cap !== null && resources <= cap) return p;
  }
  return PLAN_BY_ID.enterprise;
}

/**
 * Effective seat limit for capacity checks.
 * Free/Personal: maxSeats. Per-seat plans: max(minSeats, subscription quantity).
 * Enterprise: null (unlimited).
 */
export function effectiveSeatLimit(
  planId: PlanId | string,
  subscriptionSeats: number | null | undefined,
): number | null {
  const limits = planLimits(planId);
  if (limits.maxSeats === null && limits.minSeats === null) return null;
  if (limits.maxSeats != null && !isPerSeatPlanId(planId)) {
    return limits.maxSeats;
  }
  const min = limits.minSeats ?? 1;
  if (subscriptionSeats == null) return min;
  return Math.max(min, subscriptionSeats);
}

/** Env var name for the Stripe price of a billable plan. */
export function priceEnvKey(planId: BillablePlanId): string {
  switch (planId) {
    case "personal":
      return "STRIPE_PRICE_PERSONAL";
    case "team":
      return "STRIPE_PRICE_TEAM";
    case "business":
      return "STRIPE_PRICE_BUSINESS";
  }
}

/** @deprecated Use priceEnvKey - seat add-ons are no longer used. */
export function seatPriceEnvKey(planId: BillablePlanId): string {
  return priceEnvKey(planId);
}
