#!/usr/bin/env bun
import { createPrivateKey } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import {
  FEATURES,
  type Feature,
  LIMITS,
  type Limit,
  type PaidTier,
  TIER_PRESETS,
} from "@tunnet/license";
import { issueLicense, localSigner } from "@tunnet/license/issuer";
import { defineCommand, runMain } from "citty";

const DEFAULT_SEED_FILE = ".secrets/license-ed25519.pkcs8.b64";
const DEFAULT_KID = "tnk-2025-01";

/** Monorepo root (packages/ + Cargo.toml), regardless of process.cwd(). */
function repoRoot(): string {
  let dir = import.meta.dir;
  for (;;) {
    if (
      existsSync(join(dir, "Cargo.toml")) &&
      existsSync(join(dir, "packages"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function onCancel(): never {
  p.cancel("Cancelled.");
  process.exit(0);
}

function ensure<T>(value: T | symbol): T {
  if (p.isCancel(value)) onCancel();
  return value;
}

function resolveRepoPath(path: string): string {
  if (isAbsolute(path)) return path;
  return join(repoRoot(), path);
}

/** Accept raw 32-byte seed base64, or Ed25519 PKCS8 DER base64 (repo default). */
function seedFromBase64(b64: string, label: string): Uint8Array {
  const bytes = Buffer.from(b64.trim(), "base64");
  if (bytes.length === 32) return new Uint8Array(bytes);

  try {
    const key = createPrivateKey({
      key: bytes,
      format: "der",
      type: "pkcs8",
    });
    const jwk = key.export({ format: "jwk" }) as { d?: string };
    if (!jwk.d) throw new Error("missing private seed");
    const seed = Buffer.from(jwk.d, "base64url");
    if (seed.length !== 32) throw new Error("unexpected seed length");
    return new Uint8Array(seed);
  } catch (err) {
    throw new Error(
      `${label}: expected base64 of a 32-byte seed or Ed25519 PKCS8 DER (${err instanceof Error ? err.message : err})`,
    );
  }
}

function loadSeed(): Uint8Array {
  const envKey = process.env.TUNNET_LICENSE_PRIVATE_KEY?.trim();
  if (envKey) return seedFromBase64(envKey, "TUNNET_LICENSE_PRIVATE_KEY");

  const file =
    process.env.TUNNET_LICENSE_PRIVATE_KEY_FILE?.trim() || DEFAULT_SEED_FILE;
  const path = resolveRepoPath(file);
  if (!existsSync(path)) {
    throw new Error(
      `Missing private key at ${path}. Set TUNNET_LICENSE_PRIVATE_KEY or TUNNET_LICENSE_PRIVATE_KEY_FILE.`,
    );
  }
  return seedFromBase64(readFileSync(path, "utf8"), path);
}

async function promptLimits(): Promise<Partial<Record<Limit, number | null>>> {
  const customize = ensure(
    await p.confirm({
      message: "Set numeric limits? (empty = unlimited)",
      initialValue: false,
    }),
  );
  if (!customize) return {};

  const limits: Partial<Record<Limit, number | null>> = {};
  for (const limit of LIMITS) {
    const raw = ensure(
      await p.text({
        message: `Limit: ${limit} (empty = unlimited)`,
        placeholder: "unlimited",
        validate: (v) => {
          if (!v.trim()) return;
          if (!/^\d+$/.test(v.trim())) return "Enter a non-negative integer";
        },
      }),
    );
    const trimmed = raw.trim();
    limits[limit] = trimmed ? Number(trimmed) : null;
  }
  return limits;
}

async function runLicenseCreate(): Promise<void> {
  p.intro("tunnet cli — issue a development license");

  const preset = ensure(
    await p.select({
      message: "License preset",
      options: [
        {
          value: "community",
          label: "community",
          hint: "default without TUNNET_LICENSE",
        },
        { value: "cloud", label: "cloud" },
        { value: "enterprise", label: "enterprise" },
        { value: "custom", label: "custom", hint: "pick features & limits" },
      ],
    }),
  );

  if (preset === "community") {
    p.note(
      "Community is the default when TUNNET_LICENSE is unset. No certificate is required — paid features stay locked.",
      "No token issued",
    );
    p.outro("Nothing to do.");
    return;
  }

  let tier: PaidTier;
  let featureOverrides: Partial<Record<Feature, boolean>> | undefined;
  let limits: Partial<Record<Limit, number | null>> | undefined;

  if (preset === "custom") {
    tier = ensure(
      await p.select({
        message: "Base tier for custom license",
        options: [
          { value: "cloud", label: "cloud" },
          { value: "enterprise", label: "enterprise" },
        ],
      }),
    );

    const enabled = ensure(
      await p.multiselect({
        message: "Features to enable",
        options: FEATURES.map((f) => ({
          value: f,
          label: f,
          hint: TIER_PRESETS[tier][f] ? "on in base" : undefined,
        })),
        initialValues: FEATURES.filter((f) => TIER_PRESETS[tier][f]),
        required: false,
      }),
    );

    const enabledSet = new Set(enabled as Feature[]);
    featureOverrides = Object.fromEntries(
      FEATURES.map((f) => [f, enabledSet.has(f)]),
    ) as Record<Feature, boolean>;

    limits = await promptLimits();
  } else {
    tier = preset;
  }

  const subject = ensure(
    await p.text({
      message: "Subject (customer id)",
      placeholder: "cust_acme",
      validate: (v) => (!v.trim() ? "Required" : undefined),
    }),
  ).trim();

  const expiresRaw = ensure(
    await p.text({
      message: "Expires in days",
      initialValue: "365",
      validate: (v) => {
        if (!/^\d+$/.test(v.trim()) || Number(v.trim()) < 1) {
          return "Enter a positive integer";
        }
      },
    }),
  );
  const expiresInDays = Number(expiresRaw.trim());

  const graceRaw = ensure(
    await p.text({
      message: "Grace days after expiry",
      initialValue: "14",
      validate: (v) => {
        if (!/^\d+$/.test(v.trim())) return "Enter a non-negative integer";
      },
    }),
  );
  const graceDays = Number(graceRaw.trim());

  const outPath = ensure(
    await p.text({
      message: "Output path (empty = print to stdout)",
      placeholder: "license.tnlic",
      initialValue: "license.tnlic",
    }),
  ).trim();

  const kid = ensure(
    await p.text({
      message: "Key id (kid)",
      initialValue: DEFAULT_KID,
      validate: (v) => (!v.trim() ? "Required" : undefined),
    }),
  ).trim();

  const seed = loadSeed();
  const signer = await localSigner(kid, seed);
  const { token, jti, exp } = await issueLicense({
    signer,
    tier,
    subject,
    expiresInDays,
    graceDays,
    featureOverrides,
    limits,
  });

  if (outPath) {
    const dest = isAbsolute(outPath)
      ? outPath
      : resolve(process.cwd(), outPath);
    writeFileSync(dest, `${token}\n`, "utf8");
    p.log.success(`Wrote ${dest}`);
  } else {
    p.log.info(token);
  }

  p.outro(
    `Issued ${tier} license  jti=${jti}  exp=${new Date(exp * 1000).toISOString()}`,
  );
}

const licenseCreate = defineCommand({
  meta: {
    name: "create",
    description: "Interactively issue a development license token",
  },
  async run() {
    try {
      await runLicenseCreate();
    } catch (err) {
      p.cancel(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});

const license = defineCommand({
  meta: {
    name: "license",
    description: "License issuance and tooling",
  },
  subCommands: {
    create: licenseCreate,
  },
});

const main = defineCommand({
  meta: {
    name: "tunnet-cli",
    description: "Tunnet development CLI",
  },
  subCommands: {
    license,
  },
});

runMain(main);
