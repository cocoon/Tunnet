export const TOKEN_PREFIX = "tnlic1";
export const LICENSE_TYP = "tunnet-license+2";
export const REVOCATION_TYP = "tunnet-revocations+2";

export const MAX_TOKEN_CHARS = 8192;
const MAX_SEGMENT_CHARS = 4096;
const B64URL = /^[A-Za-z0-9_-]+$/;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(value: string): Uint8Array {
  if (!B64URL.test(value) || value.length % 4 === 1) {
    throw new SyntaxError("invalid base64url");
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (b64uEncode(out) !== value)
    throw new SyntaxError("non-canonical base64url");
  return out;
}

export type ProtectedHeader = {
  readonly alg: "Ed25519";
  readonly kid: string;
  readonly typ: string;
  readonly crit: readonly string[];
};

export type DecodedToken = {
  readonly header: ProtectedHeader;
  readonly payload: Record<string, unknown>;
  readonly signature: Uint8Array;
  readonly signingInput: Uint8Array;
};

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(dec.decode(bytes));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SyntaxError("expected JSON object");
  }
  return value as Record<string, unknown>;
}

function parseHeader(raw: Record<string, unknown>): ProtectedHeader {
  if (raw.alg !== "Ed25519") throw new SyntaxError("unsupported alg");
  if (
    typeof raw.kid !== "string" ||
    raw.kid.length === 0 ||
    raw.kid.length > 64
  ) {
    throw new SyntaxError("invalid kid");
  }
  if (typeof raw.typ !== "string") throw new SyntaxError("invalid typ");
  const crit = raw.crit === undefined ? [] : raw.crit;
  if (!Array.isArray(crit) || crit.some((c) => typeof c !== "string")) {
    throw new SyntaxError("invalid crit");
  }
  return Object.freeze({
    alg: "Ed25519",
    kid: raw.kid,
    typ: raw.typ,
    crit: Object.freeze([...crit] as string[]),
  });
}

export function decodeToken(token: string): DecodedToken {
  const trimmed = token.trim();
  if (trimmed.length > MAX_TOKEN_CHARS) throw new RangeError("token too large");

  const parts = trimmed.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) {
    throw new SyntaxError("unsupported token format");
  }
  const [, h, p, s] = parts as [string, string, string, string];
  if (
    h.length > MAX_SEGMENT_CHARS ||
    p.length > MAX_SEGMENT_CHARS ||
    s.length > 128
  ) {
    throw new RangeError("segment too large");
  }

  const signature = b64uDecode(s);
  if (signature.length !== 64)
    throw new SyntaxError("invalid signature length");

  return Object.freeze({
    header: parseHeader(parseJsonObject(b64uDecode(h))),
    payload: parseJsonObject(b64uDecode(p)),
    signature,
    signingInput: utf8(`${TOKEN_PREFIX}.${h}.${p}`),
  });
}

export function buildSigningInput(
  header: object,
  payload: object,
): { input: Uint8Array; h: string; p: string } {
  const h = b64uEncode(utf8(JSON.stringify(header)));
  const p = b64uEncode(utf8(JSON.stringify(payload)));
  return { input: utf8(`${TOKEN_PREFIX}.${h}.${p}`), h, p };
}

export function assembleToken(
  h: string,
  p: string,
  signature: Uint8Array,
): string {
  return `${TOKEN_PREFIX}.${h}.${p}.${b64uEncode(signature)}`;
}
