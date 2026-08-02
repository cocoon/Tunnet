import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { issueLicense, localSigner } from "../src/issuer";
import { TEST_KID, TEST_SEED, testPublicKeyHex } from "../src/testing";
import { b64uDecode, b64uEncode, TOKEN_PREFIX } from "../src/token";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "test", "vectors.json");

const FIXED_NOW = 1_700_000_000; // 2023-11-14T22:13:20Z

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function tamperSignature(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4) throw new Error("expected tnlic1 token");
  const sig = b64uDecode(parts[3]!);
  sig[0] = (sig[0]! ^ 0xff) & 0xff;
  parts[3] = b64uEncode(sig);
  return parts.join(".");
}

function withTyp(token: string, typ: string): string {
  const parts = token.split(".");
  if (parts.length !== 4) throw new Error("expected tnlic1 token");
  const header = JSON.parse(
    new TextDecoder().decode(b64uDecode(parts[1]!)),
  ) as Record<string, unknown>;
  header.typ = typ;
  const h = b64uEncode(new TextEncoder().encode(JSON.stringify(header)));
  return `${TOKEN_PREFIX}.${h}.${parts[2]}.${parts[3]}`;
}

async function main() {
  const pubHex = testPublicKeyHex(TEST_SEED);
  const signer = await localSigner(TEST_KID, TEST_SEED);

  const valid = await issueLicense({
    signer,
    tier: "cloud",
    subject: "vectors@tunnet.io",
    licenseId: "lic_vector_valid_cloud",
    issuedAt: FIXED_NOW - 86400,
    expiresInDays: 30,
    graceDays: 14,
  });

  const expired = await issueLicense({
    signer,
    tier: "cloud",
    subject: "vectors@tunnet.io",
    licenseId: "lic_vector_expired",
    issuedAt: FIXED_NOW - 40 * 86400,
    expiresInDays: 1,
    graceDays: 0,
  });

  const grace = await issueLicense({
    signer,
    tier: "cloud",
    subject: "vectors@tunnet.io",
    licenseId: "lic_vector_grace",
    issuedAt: FIXED_NOW - 20 * 86400,
    expiresInDays: 1,
    graceDays: 30,
  });

  const badSig = tamperSignature(valid.token);
  const wrongTyp = withTyp(valid.token, "not-a-license");
  const malformed = `${TOKEN_PREFIX}.not.base64url.!!!!`;

  const vectors = {
    generatedAt: new Date().toISOString(),
    now: FIXED_NOW,
    keys: [
      {
        kid: TEST_KID,
        alg: "Ed25519",
        publicKeyHex: pubHex,
        status: "active",
        validFrom: 0,
        validUntil: null,
      },
    ],
    cases: [
      {
        name: "valid_cloud_active",
        token: valid.token,
        expect: { ok: true, status: "active", tier: "cloud" },
      },
      {
        name: "expired",
        token: expired.token,
        expect: { ok: false, code: "expired" },
      },
      {
        name: "bad_signature",
        token: badSig,
        expect: { ok: false, code: "bad_signature" },
      },
      {
        name: "wrong_typ",
        token: wrongTyp,
        expect: { ok: false, code: "unsupported_format" },
      },
      {
        name: "malformed",
        token: malformed,
        expect: { ok: false, code: "malformed" },
      },
      {
        name: "grace_period",
        token: grace.token,
        expect: { ok: true, status: "grace", tier: "cloud" },
      },
    ],
    seedPublicKeyCheck: {
      seedHex: hex(TEST_SEED),
      publicKeyHex: pubHex,
    },
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(vectors, null, 2)}\n`, "utf8");
  console.log(`wrote ${outPath} (${vectors.cases.length} cases)`);
}

await main();
