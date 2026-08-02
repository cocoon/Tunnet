export type PlanId = "free" | "team" | "business" | "enterprise";

export type PlanLimits = {
  seats: number | null;
  resources: number | null;
  trafficGB: number | null;
};

export type Plan = {
  id: PlanId;
  name: string;
  price: number | null;
  cadence: string;
  seats: number | null;
  extraSeat: number | null;
  resources: number | null;
  trafficGB: number | null;
  pitch: string;
  cta: string;
  features: string[];
  highlight?: boolean;
  /** Days of free trial for paid Stripe plans. */
  trialDays: number | null;
};

export const OWNERSHIP_CAP_VERIFIED = 3;
export const OWNERSHIP_CAP_UNVERIFIED = 1;
export const OWNERSHIP_TOMBSTONE_WINDOW_DAYS = 30;

export const BILLABLE_PLAN_IDS = ["team", "business"] as const;
export type BillablePlanId = (typeof BILLABLE_PLAN_IDS)[number];

export const CREATABLE_PLAN_IDS = ["free", "team", "business"] as const;
export type CreatablePlanId = (typeof CREATABLE_PLAN_IDS)[number];

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    cadence: "forever",
    seats: 3,
    extraSeat: null,
    resources: 20,
    trafficGB: 5,
    pitch: "You and a handful of machines.",
    cta: "Start free",
    features: [
      "3 seats",
      "20 resources",
      "5 GB managed traffic",
      "Mesh · Serve · Tunnel · Send · SSH",
    ],
    trialDays: null,
  },
  {
    id: "team",
    name: "Team",
    price: 29,
    cadence: "/month",
    seats: 5,
    extraSeat: 5,
    resources: 100,
    trafficGB: 50,
    pitch: "SSO, audit and managed tunnels.",
    cta: "Start trial",
    highlight: true,
    features: [
      "5 seats, then $5 each",
      "100 resources",
      "50 GB managed traffic",
      "SSO · roles · audit",
      "SSH session recording",
      "REST API",
    ],
    trialDays: 14,
  },
  {
    id: "business",
    name: "Business",
    price: 149,
    cadence: "/month",
    seats: 15,
    extraSeat: 8,
    resources: 500,
    trafficGB: 500,
    pitch: "For orgs running the mesh at scale.",
    cta: "Start trial",
    features: [
      "15 seats, then $8 each",
      "500 resources",
      "500 GB managed traffic",
      "Everything in Team",
      "Policy as Code",
      "Priority support",
    ],
    trialDays: 14,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null,
    cadence: "custom",
    seats: null,
    extraSeat: null,
    resources: null,
    trafficGB: null,
    pitch: "Self-hosted or dedicated cloud.",
    cta: "Talk to sales",
    features: [
      "Self-hosted control plane",
      "SCIM & custom OIDC",
      "Dedicated edges",
      "24/7 support & SLA",
      "Compliance reviews",
    ],
    trialDays: null,
  },
];

const PLAN_BY_ID = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<
  PlanId,
  Plan
>;

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

export function planLimits(id: PlanId | string): PlanLimits {
  const plan = getPlan(id) ?? PLAN_BY_ID.free;
  return {
    seats: plan.seats,
    resources: plan.resources,
    trafficGB: plan.trafficGB,
  };
}

/** Monthly cost for a plan at a given seat count, or null for custom plans. */
export function seatCost(plan: Plan, seats: number): number | null {
  if (plan.price === null) return null;
  const included = plan.seats ?? 0;
  const extra = plan.extraSeat ?? 0;
  return plan.price + Math.max(0, seats - included) * extra;
}

/** The smallest plan whose resource cap fits a given resource count. */
export function planForResources(resources: number): Plan {
  for (const p of PLANS) {
    if (p.resources !== null && resources <= p.resources) return p;
  }
  return PLAN_BY_ID.enterprise;
}

export function effectiveSeatLimit(
  planId: PlanId | string,
  subscriptionSeats: number | null | undefined,
): number | null {
  const included = planLimits(planId).seats;
  if (included === null) return null;
  if (subscriptionSeats == null) return included;
  return Math.max(included, subscriptionSeats);
}

/** Env var name for the per-seat Stripe price of a billable plan. */
export function seatPriceEnvKey(planId: BillablePlanId): string {
  return planId === "team"
    ? "STRIPE_SEAT_PRICE_TEAM"
    : "STRIPE_SEAT_PRICE_BUSINESS";
}
