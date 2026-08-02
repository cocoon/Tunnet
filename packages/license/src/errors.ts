export type LicenseFailureCode =
  | "not_configured"
  | "source_unavailable"
  | "too_large"
  | "malformed"
  | "unsupported_format"
  | "unknown_key"
  | "key_revoked"
  | "alg_mismatch"
  | "bad_signature"
  | "unsupported_claim"
  | "invalid_claims"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "not_yet_valid"
  | "expired"
  | "revoked"
  | "clock_rollback";

export class LicenseRequiredError extends Error {
  readonly code = "license_required" as const;
  readonly status = 402;
  constructor(
    readonly feature: string,
    readonly currentTier: string,
  ) {
    super(
      `Feature "${feature}" requires a paid license (current tier: ${currentTier})`,
    );
    this.name = "LicenseRequiredError";
  }
}

export class LicenseLimitError extends Error {
  readonly code = "license_limit_exceeded" as const;
  readonly status = 402;
  constructor(
    readonly limit: string,
    readonly allowed: number,
    readonly requested: number,
  ) {
    super(
      `Limit "${limit}" exceeded: ${requested} requested, ${allowed} allowed`,
    );
    this.name = "LicenseLimitError";
  }
}
