import { b64uDecode } from "./token";

export type KeyStatus = "active" | "retired" | "compromised";

export type TrustedKey = {
  readonly kid: string;
  readonly alg: "Ed25519";
  readonly publicKey: Uint8Array;
  readonly validFrom: number;
  readonly validUntil: number | null;
  readonly status: KeyStatus;
};

function key(
  kid: string,
  hex: string,
  validFrom: number,
  validUntil: number | null,
  status: KeyStatus,
): TrustedKey {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return Object.freeze({
    kid,
    alg: "Ed25519",
    publicKey: bytes,
    validFrom,
    validUntil,
    status,
  });
}

export const TUNNET_TRUSTED_KEYS: readonly TrustedKey[] = Object.freeze([
  key(
    "tnk-2025-01",
    "54544bc6251b8076e7cdceff6b741d258b37a6a93020a03a251fe209b325ebbd",
    0,
    null,
    "active",
  ),
]);

export class Keyring {
  readonly #byKid: ReadonlyMap<string, TrustedKey>;

  constructor(keys: readonly TrustedKey[] = TUNNET_TRUSTED_KEYS) {
    if (keys.length === 0)
      throw new Error("keyring must contain at least one key");
    const map = new Map<string, TrustedKey>();
    for (const k of keys) {
      if (k.publicKey.length !== 32)
        throw new Error(`key ${k.kid}: public key must be 32 bytes`);
      if (map.has(k.kid)) throw new Error(`duplicate kid: ${k.kid}`);
      map.set(k.kid, k);
    }
    this.#byKid = map;
  }

  static fromSpkiBase64(kid: string, spki: string): TrustedKey {
    const der = b64uDecode(
      spki.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    );
    if (der.length !== 44) throw new Error("unexpected Ed25519 SPKI length");
    return Object.freeze({
      kid,
      alg: "Ed25519" as const,
      publicKey: der.slice(12),
      validFrom: 0,
      validUntil: null,
      status: "active" as const,
    });
  }

  get(kid: string): TrustedKey | undefined {
    return this.#byKid.get(kid);
  }
}
