import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LicenseManager,
  type LicenseManagerOptions,
  memoryStateStore,
  type StateStore,
} from "./manager";
import {
  emptySource,
  fileSource,
  httpSource,
  inlineSource,
  type LicenseSource,
} from "./sources";

export * from "./index";
export {
  LicenseManager,
  type LicenseManagerOptions,
  memoryStateStore,
} from "./manager";
export { deploymentFingerprint } from "./verify";

export function fileStateStore(path: string): StateStore {
  return {
    read: async () => {
      try {
        return JSON.parse(await readFile(path, "utf8")) as {
          token?: string;
          clockWatermark?: number;
        };
      } catch {
        return null;
      }
    },
    write: async (state) => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
      await rename(tmp, path);
    },
  };
}

export function sourceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LicenseSource {
  const ref = env.TUNNET_LICENSE?.trim();
  if (!ref) return emptySource;
  if (ref.startsWith("tnlic1.")) return inlineSource(ref);
  if (/^https?:\/\//i.test(ref)) {
    return httpSource(ref, {
      allowInsecure: env.TUNNET_LICENSE_ALLOW_INSECURE === "1",
    });
  }
  return fileSource(ref, (p) => readFile(p, "utf8"));
}

export async function createLicenseManager(
  overrides: LicenseManagerOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<LicenseManager> {
  const stateDir = env.TUNNET_STATE_DIR ?? "/var/lib/tunnet";
  const manager = new LicenseManager({
    source: sourceFromEnv(env),
    revocationSource: env.TUNNET_LICENSE_CRL
      ? httpSource(env.TUNNET_LICENSE_CRL)
      : null,
    deploymentId: env.TUNNET_DEPLOYMENT_ID ?? null,
    expectedIssuer: env.TUNNET_LICENSE_ISSUER ?? "https://licensing.tunnet.io",
    state: fileStateStore(join(stateDir, "license-state.json")),
    ...overrides,
  });
  await manager.start();
  return manager;
}
