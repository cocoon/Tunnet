export type PlanId = "free" | "team" | "business" | "enterprise";

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
};

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
      "Dedicated relays",
      "24/7 support & SLA",
      "Compliance reviews",
    ],
  },
];

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
  return PLANS[3] as Plan;
}
