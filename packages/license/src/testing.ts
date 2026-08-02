import { ed25519 } from "@noble/curves/ed25519.js";
import type { Feature, Limit, PaidTier } from "./features";
import { type IssueInput, issueLicense, localSigner } from "./issuer";
import { Keyring, type TrustedKey } from "./keyring";
import {
  LicenseManager,
  type LicenseManagerOptions,
  memoryStateStore,
} from "./manager";
import { inlineSource } from "./sources";

export const TEST_SEED = new Uint8Array(32).fill(0x42);
export const TEST_KID = "test-kid-1";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function testPublicKeyHex(seed: Uint8Array = TEST_SEED): string {
  return hex(ed25519.getPublicKey(seed));
}

export function testTrustedKey(
  kid = TEST_KID,
  seed: Uint8Array = TEST_SEED,
): TrustedKey {
  return Object.freeze({
    kid,
    alg: "Ed25519" as const,
    publicKey: ed25519.getPublicKey(seed),
    validFrom: 0,
    validUntil: null,
    status: "active" as const,
  });
}

export function testKeyring(
  kid = TEST_KID,
  seed: Uint8Array = TEST_SEED,
): Keyring {
  return new Keyring([testTrustedKey(kid, seed)]);
}

export type IssueTestLicenseInput = {
  readonly tier?: PaidTier;
  readonly subject?: string;
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
  readonly kid?: string;
  readonly seed?: Uint8Array;
};

export async function issueTestLicense(
  input: IssueTestLicenseInput = {},
): Promise<{ token: string; jti: string; exp: number }> {
  const kid = input.kid ?? TEST_KID;
  const seed = input.seed ?? TEST_SEED;
  const signer = await localSigner(kid, seed);
  const issueInput: IssueInput = {
    signer,
    tier: input.tier ?? "cloud",
    subject: input.subject ?? "test@tunnet.io",
    issuer: input.issuer,
    licenseId: input.licenseId,
    expiresInDays: input.expiresInDays,
    issuedAt: input.issuedAt,
    notBefore: input.notBefore,
    graceDays: input.graceDays,
    audience: input.audience,
    featureOverrides: input.featureOverrides,
    limits: input.limits,
    meta: input.meta,
  };
  return issueLicense(issueInput);
}

export async function createTestManager(
  overrides: LicenseManagerOptions & { token?: string } = {},
): Promise<LicenseManager> {
  const { token, ...rest } = overrides;
  const manager = new LicenseManager({
    keyring: testKeyring(),
    state: memoryStateStore(),
    expectedIssuer: "https://licensing.tunnet.io",
    refreshIntervalSec: 60 * 60,
    ...(token !== undefined ? { source: inlineSource(token) } : {}),
    ...rest,
  });
  await manager.start();
  return manager;
}
