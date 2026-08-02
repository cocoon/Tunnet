import type { PlanFeature, PlanId } from "@tunnet/api/billing";

export class PlanRequiredError extends Error {
  readonly code = "PLAN_FEATURE_REQUIRED" as const;
  readonly status = 402;
  constructor(
    readonly feature: PlanFeature,
    readonly requiredPlan: PlanId,
    readonly currentPlan: PlanId,
  ) {
    super(
      `Feature "${feature}" requires the ${requiredPlan} plan (current: ${currentPlan}). Upgrade to unlock it.`,
    );
    this.name = "PlanRequiredError";
  }
}

export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_EXCEEDED" as const;
  readonly status = 402;
  constructor(
    readonly limit: string,
    readonly allowed: number,
    readonly current: number,
    readonly requiredPlan?: PlanId,
    message?: string,
  ) {
    super(
      message ??
        `Organization ${limit} limit reached (${allowed}). Upgrade the plan or adjust usage.`,
    );
    this.name = "PlanLimitError";
  }
}
