import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { LicenseFailureCode } from "./errors";
import {
  type Entitlements,
  FEATURES,
  type Feature,
  type FeatureMap,
  isTier,
  LIMITS,
  type LicenseTier,
  type Limit,
  type LimitMap,
} from "./features";
import type { Keyring } from "./keyring";
import { b64uEncode, decodeToken, LICENSE_TYP, utf8 } from "./token";

export const DEFAULT_CLOCK_SKEW_SEC = 300;
const UNDERSTOOD_CRIT = new Set<string>(["aud", "limits"]);

export type License = {
  readonly jti: string;
  readonly iss: string;
  readonly sub: string;
  readonly aud: readonly string[];
  readonly tier: LicenseTier;
  readonly features: FeatureMap;
  readonly limits: LimitMap;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly grace: number;
  readonly meta: Readonly<Record<string, string>>;
  readonly kid: string;
};

export type VerifyOptions = {
  readonly keyring: Keyring;
  readonly now: number;
  readonly clockSkewSec?: number;
  readonly audience?: string | null;
  readonly expectedIssuer?: string | null;
  readonly revokedIds?: ReadonlySet<string> | null;
};

export type VerifyResult =
  | {
      readonly ok: true;
      readonly license: License;
      readonly status: "active" | "grace";
    }
  | {
      readonly ok: false;
      readonly code: LicenseFailureCode;
      readonly message: string;
    };

const fail = (code: LicenseFailureCode, message: string): VerifyResult => ({
  ok: false,
  code,
  message,
});

export function deploymentFingerprint(deploymentId: string): string {
  return b64uEncode(
    sha256(utf8(`tunnet-deployment-v1\u0000${deploymentId}`)),
  ).slice(0, 22);
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

function parseFeatures(v: unknown): FeatureMap | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out = {} as Record<Feature, boolean>;
  for (const f of FEATURES) {
    const raw = src[f];
    if (raw !== undefined && typeof raw !== "boolean") return null;
    out[f] = raw === true;
  }
  return Object.freeze(out);
}

function parseLimits(v: unknown): LimitMap | null {
  if (v === undefined)
    return Object.freeze(
      Object.fromEntries(LIMITS.map((l) => [l, null])) as Record<
        Limit,
        number | null
      >,
    );
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out = {} as Record<Limit, number | null>;
  for (const l of LIMITS) {
    const raw = src[l];
    if (raw === undefined || raw === null) out[l] = null;
    else {
      const n = int(raw);
      if (n === null || n < 0) return null;
      out[l] = n;
    }
  }
  return Object.freeze(out);
}

function parseMeta(v: unknown): Readonly<Record<string, string>> | null {
  if (v === undefined) return Object.freeze({});
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const keys = Object.keys(src);
  if (keys.length > 16) return null;
  for (const k of keys)
    if (typeof src[k] !== "string" || (src[k] as string).length > 256)
      return null;
  return Object.freeze({ ...src } as Record<string, string>);
}

export function verifyLicenseToken(
  token: string,
  options: VerifyOptions,
): VerifyResult {
  const skew = options.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
  const now = options.now;

  let decoded: ReturnType<typeof decodeToken>;
  try {
    decoded = decodeToken(token);
  } catch (err) {
    const code: LicenseFailureCode =
      err instanceof RangeError ? "too_large" : "malformed";
    return fail(code, err instanceof Error ? err.message : "malformed token");
  }

  const { header, payload, signature, signingInput } = decoded;
  if (header.typ !== LICENSE_TYP)
    return fail("unsupported_format", `unexpected typ: ${header.typ}`);
  for (const c of header.crit) {
    if (!UNDERSTOOD_CRIT.has(c))
      return fail("unsupported_claim", `unsupported critical claim: ${c}`);
  }

  const key = options.keyring.get(header.kid);
  if (!key) return fail("unknown_key", `unknown kid: ${header.kid}`);
  if (key.status === "compromised")
    return fail("key_revoked", `signing key ${header.kid} is revoked`);
  if (header.alg !== key.alg)
    return fail("alg_mismatch", "header alg does not match key alg");

  let signatureValid = false;
  try {
    signatureValid = ed25519.verify(signature, signingInput, key.publicKey, {
      zip215: false,
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid)
    return fail("bad_signature", "signature verification failed");

  const jti = str(payload.jti, 64);
  const iss = str(payload.iss, 256);
  const sub = str(payload.sub, 256);
  const iat = int(payload.iat);
  const nbf = payload.nbf === undefined ? iat : int(payload.nbf);
  const exp = int(payload.exp);
  const grace = payload.grace === undefined ? 0 : int(payload.grace);
  const features = parseFeatures(payload.features);
  const limits = parseLimits(payload.limits);
  const meta = parseMeta(payload.meta);
  const tier =
    isTier(payload.tier) && payload.tier !== "community" ? payload.tier : null;

  const audRaw = payload.aud === undefined ? [] : payload.aud;
  const aud =
    Array.isArray(audRaw) &&
    audRaw.length <= 32 &&
    audRaw.every((a) => typeof a === "string" && a.length <= 64)
      ? (audRaw as string[])
      : null;

  if (
    !jti ||
    !iss ||
    !sub ||
    !tier ||
    !features ||
    !limits ||
    !meta ||
    !aud ||
    iat === null ||
    nbf === null ||
    exp === null ||
    grace === null ||
    grace < 0 ||
    grace > 90 * 86400 ||
    exp <= iat
  ) {
    return fail("invalid_claims", "license payload failed schema validation");
  }

  if (key.validFrom > iat)
    return fail("key_revoked", "license issued before key validity window");
  if (key.validUntil !== null && iat > key.validUntil) {
    return fail("key_revoked", "license issued after key retirement");
  }

  if (options.expectedIssuer && iss !== options.expectedIssuer) {
    return fail("issuer_mismatch", `unexpected issuer: ${iss}`);
  }
  if (options.revokedIds?.has(jti))
    return fail("revoked", `license ${jti} has been revoked`);

  if (aud.length > 0) {
    if (!options.audience)
      return fail(
        "audience_mismatch",
        "license is deployment-bound but no deployment id is configured",
      );
    if (!aud.includes(options.audience))
      return fail(
        "audience_mismatch",
        "license is bound to a different deployment",
      );
  }

  if (now + skew < nbf)
    return fail("not_yet_valid", "license is not yet valid");

  const license: License = Object.freeze({
    jti,
    iss,
    sub,
    aud: Object.freeze([...aud]),
    tier,
    features,
    limits,
    iat,
    nbf,
    exp,
    grace,
    meta,
    kid: header.kid,
  });

  if (now - skew < exp) return { ok: true, license, status: "active" };
  if (now - skew < exp + grace) return { ok: true, license, status: "grace" };
  return fail(
    "expired",
    `license expired at ${new Date(exp * 1000).toISOString()}`,
  );
}

export function entitlementsFrom(
  license: License,
  status: "active" | "grace",
  stale: boolean,
): Entitlements {
  return Object.freeze({
    status,
    tier: license.tier,
    features: license.features,
    limits: license.limits,
    licenseId: license.jti,
    subject: license.sub,
    issuedAt: license.iat,
    notAfter: license.exp,
    graceUntil: license.grace > 0 ? license.exp + license.grace : null,
    stale,
    reason: null,
  });
}
