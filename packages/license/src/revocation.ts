import { ed25519 } from "@noble/curves/ed25519.js";
import type { Keyring } from "./keyring";
import { decodeToken, REVOCATION_TYP } from "./token";

export type RevocationParse =
  | { ok: true; revoked: ReadonlySet<string>; issuedAt: number }
  | { ok: false; message: string };

export const MAX_REVOCATION_AGE_SEC = 30 * 86400;

export function parseRevocationList(
  token: string,
  keyring: Keyring,
  now: number,
): RevocationParse {
  let decoded: ReturnType<typeof decodeToken>;
  try {
    decoded = decodeToken(token);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "malformed",
    };
  }
  if (decoded.header.typ !== REVOCATION_TYP)
    return { ok: false, message: "unexpected typ" };

  const key = keyring.get(decoded.header.kid);
  if (!key || key.status === "compromised")
    return { ok: false, message: "unknown or revoked kid" };
  if (decoded.header.alg !== key.alg)
    return { ok: false, message: "alg mismatch" };

  let valid = false;
  try {
    valid = ed25519.verify(
      decoded.signature,
      decoded.signingInput,
      key.publicKey,
      { zip215: false },
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, message: "bad signature" };

  const iat = decoded.payload.iat;
  const list = decoded.payload.revoked;
  if (typeof iat !== "number" || !Number.isSafeInteger(iat))
    return { ok: false, message: "invalid iat" };
  if (!Array.isArray(list) || list.length > 100_000)
    return { ok: false, message: "invalid list" };
  if (now - iat > MAX_REVOCATION_AGE_SEC)
    return { ok: false, message: "revocation list is stale" };

  const set = new Set<string>();
  for (const entry of list) {
    if (typeof entry === "string") set.add(entry);
    else if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { jti?: unknown }).jti === "string"
    ) {
      set.add((entry as { jti: string }).jti);
    } else return { ok: false, message: "invalid revocation entry" };
  }
  return { ok: true, revoked: set, issuedAt: iat };
}
