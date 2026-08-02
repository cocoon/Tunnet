import {
  FEATURES,
  type Feature,
  LIMITS,
  type LicenseTier,
  type Limit,
  type PaidTier,
  TIER_PRESETS,
} from "./features";
import {
  assembleToken,
  buildSigningInput,
  LICENSE_TYP,
  REVOCATION_TYP,
} from "./token";

export type LicenseSigner = {
  readonly kid: string;
  readonly alg: "Ed25519";
  sign(message: Uint8Array): Promise<Uint8Array>;
};

export async function localSigner(
  kid: string,
  privateKeyRaw: Uint8Array,
): Promise<LicenseSigner> {
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  if (privateKeyRaw.length !== 32)
    throw new Error("Ed25519 seed must be 32 bytes");
  return {
    kid,
    alg: "Ed25519",
    sign: async (msg) => ed25519.sign(msg, privateKeyRaw),
  };
}

export type IssueInput = {
  readonly signer: LicenseSigner;
  readonly tier: PaidTier;
  readonly subject: string;
  readonly issuer?: string;
  readonly licenseId?: string;
  readonly expiresInDays?: number;
  readonly issuedAt?: number;
  readonly notBefore?: number;
  readonly graceDays?: number;
  readonly audience?: readonly string[];
  readonly featureOverrides?: Partial<Record<Feature, boolean>>;
  readonly limits?: Partial<Record<Limit, number | null>>;
  readonly meta?: Readonly<Record<string, string>>;
};

export async function issueLicense(
  input: IssueInput,
): Promise<{ token: string; jti: string; exp: number }> {
  const iat = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const exp = iat + Math.floor((input.expiresInDays ?? 365) * 86400);
  if (exp <= iat) throw new Error("exp must be after iat");

  const jti =
    input.licenseId ?? `lic_${crypto.randomUUID().replaceAll("-", "")}`;
  const features = { ...TIER_PRESETS[input.tier], ...input.featureOverrides };
  const limits = Object.fromEntries(
    LIMITS.map((l) => [l, input.limits?.[l] ?? null]),
  );

  const crit: string[] = [];
  if (input.audience?.length) crit.push("aud");
  if (Object.values(limits).some((v) => v !== null)) crit.push("limits");

  const header = {
    alg: input.signer.alg,
    kid: input.signer.kid,
    typ: LICENSE_TYP,
    crit,
  };
  const payload = {
    jti,
    iss: input.issuer ?? "https://licensing.tunnet.io",
    sub: input.subject,
    aud: input.audience ?? [],
    tier: input.tier satisfies LicenseTier,
    features: Object.fromEntries(
      FEATURES.map((f) => [f, features[f] === true]),
    ),
    limits,
    iat,
    nbf: input.notBefore ?? iat,
    exp,
    grace: Math.floor((input.graceDays ?? 14) * 86400),
    meta: input.meta ?? {},
  };

  const { input: signingInput, h, p } = buildSigningInput(header, payload);
  return {
    token: assembleToken(h, p, await input.signer.sign(signingInput)),
    jti,
    exp,
  };
}

export async function issueRevocationList(
  signer: LicenseSigner,
  revoked: readonly string[],
  issuedAt = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = {
    alg: signer.alg,
    kid: signer.kid,
    typ: REVOCATION_TYP,
    crit: [],
  };
  const { input, h, p } = buildSigningInput(header, { iat: issuedAt, revoked });
  return assembleToken(h, p, await signer.sign(input));
}
