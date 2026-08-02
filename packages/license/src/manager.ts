import {
  type LicenseFailureCode,
  LicenseLimitError,
  LicenseRequiredError,
} from "./errors";
import {
  COMMUNITY_ENTITLEMENTS,
  communityWithReason,
  type Entitlements,
  type Feature,
  type Limit,
} from "./features";
import { Keyring } from "./keyring";
import { emptySource, type LicenseSource } from "./sources";
import { entitlementsFrom, verifyLicenseToken } from "./verify";

export type Logger = {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
};

const consoleLogger: Logger = {
  info: (m, f) => console.info(`[license] ${m}`, f ?? ""),
  warn: (m, f) => console.warn(`[license] ${m}`, f ?? ""),
  error: (m, f) => console.error(`[license] ${m}`, f ?? ""),
};

export type PersistedState = { token?: string; clockWatermark?: number };
export type StateStore = {
  read(): Promise<PersistedState | null>;
  write(state: PersistedState): Promise<void>;
};

export const memoryStateStore = (): StateStore => {
  let state: PersistedState | null = null;
  return {
    read: async () => state,
    write: async (s) => {
      state = s;
    },
  };
};

export type LicenseManagerOptions = {
  readonly source?: LicenseSource;
  readonly revocationSource?: LicenseSource | null;
  readonly keyring?: Keyring;
  readonly deploymentId?: string | null;
  readonly expectedIssuer?: string | null;
  readonly state?: StateStore;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly refreshIntervalSec?: number;
  readonly clockSkewSec?: number;
};

export class LicenseManager {
  #entitlements: Entitlements = COMMUNITY_ENTITLEMENTS;
  #listeners = new Set<(e: Entitlements) => void>();
  #inflight: Promise<Entitlements> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;
  #watermark = 0;
  #revoked: ReadonlySet<string> | null = null;

  readonly #o: Required<
    Pick<
      LicenseManagerOptions,
      "source" | "logger" | "now" | "refreshIntervalSec" | "clockSkewSec"
    >
  > &
    LicenseManagerOptions & { keyring: Keyring; state: StateStore };

  constructor(options: LicenseManagerOptions = {}) {
    this.#o = {
      ...options,
      source: options.source ?? emptySource,
      keyring: options.keyring ?? new Keyring(),
      state: options.state ?? memoryStateStore(),
      logger: options.logger ?? consoleLogger,
      now: options.now ?? (() => Math.floor(Date.now() / 1000)),
      refreshIntervalSec: options.refreshIntervalSec ?? 3600,
      clockSkewSec: options.clockSkewSec ?? 300,
    };
  }

  snapshot(): Entitlements {
    return this.#entitlements;
  }

  has(feature: Feature): boolean {
    return this.#entitlements.features[feature] === true;
  }

  require(feature: Feature): void {
    if (!this.has(feature))
      throw new LicenseRequiredError(feature, this.#entitlements.tier);
  }

  limit(name: Limit): number {
    const v = this.#entitlements.limits[name];
    return v === null ? Number.POSITIVE_INFINITY : v;
  }

  requireWithin(name: Limit, requested: number): void {
    const allowed = this.limit(name);
    if (requested > allowed)
      throw new LicenseLimitError(name, allowed, requested);
  }

  subscribe(fn: (e: Entitlements) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  async start(): Promise<Entitlements> {
    const persisted = await this.#o.state.read();
    this.#watermark = persisted?.clockWatermark ?? 0;
    const e = await this.refresh();
    this.#schedule();
    return e;
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#listeners.clear();
  }

  refresh(): Promise<Entitlements> {
    this.#inflight ??= this.#doRefresh().finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  async #doRefresh(): Promise<Entitlements> {
    const ctl = new AbortController();
    const result = await this.#o.source.load(ctl.signal);

    let token: string | null = null;
    let stale = false;

    if (result.ok) {
      token = result.token;
    } else if (result.reason === "not_configured") {
      return this.#publish(COMMUNITY_ENTITLEMENTS);
    } else {
      const persisted = await this.#o.state.read();
      token = persisted?.token ?? null;
      stale = true;
      this.#o.logger.warn("license source unavailable, using last known good", {
        source: this.#o.source.describe,
        error: result.message,
        haveCached: token !== null,
      });
      if (!token)
        return this.#publish(
          communityWithReason(result.reason as LicenseFailureCode, true),
        );
    }

    return this.#publish(await this.#evaluate(token, stale));
  }

  async #evaluate(token: string, stale: boolean): Promise<Entitlements> {
    const wall = this.#o.now();
    let now = wall;
    if (wall + this.#o.clockSkewSec < this.#watermark) {
      this.#o.logger.error(
        "system clock moved backwards; using persisted watermark",
        {
          wall,
          watermark: this.#watermark,
        },
      );
      now = this.#watermark;
    } else if (wall > this.#watermark) {
      this.#watermark = wall;
    }

    await this.#loadRevocations();

    const verified = verifyLicenseToken(token, {
      keyring: this.#o.keyring,
      now,
      clockSkewSec: this.#o.clockSkewSec,
      audience: this.#o.deploymentId
        ? deploymentFingerprintCached(this.#o.deploymentId)
        : null,
      expectedIssuer: this.#o.expectedIssuer ?? null,
      revokedIds: this.#revoked,
    });

    if (!verified.ok) {
      this.#o.logger.error("license rejected, falling back to community", {
        code: verified.code,
        message: verified.message,
      });
      if (verified.code === "expired") await this.#persist(token);
      return communityWithReason(verified.code, stale);
    }

    await this.#persist(token);

    if (verified.status === "grace") {
      this.#o.logger.warn("license expired, running in grace period", {
        licenseId: verified.license.jti,
        graceUntil: new Date(
          (verified.license.exp + verified.license.grace) * 1000,
        ).toISOString(),
      });
    } else {
      this.#o.logger.info("license active", {
        tier: verified.license.tier,
        licenseId: verified.license.jti,
        expires: new Date(verified.license.exp * 1000).toISOString(),
      });
    }
    return entitlementsFrom(verified.license, verified.status, stale);
  }

  async #loadRevocations(): Promise<void> {
    if (!this.#o.revocationSource) return;
    const ctl = new AbortController();
    const res = await this.#o.revocationSource.load(ctl.signal);
    if (!res.ok) {
      this.#o.logger.warn("revocation list unavailable, keeping previous", {
        error: res.message,
      });
      return;
    }
    const parsed = parseRevocationList(
      res.token,
      this.#o.keyring,
      this.#o.now(),
    );
    if (!parsed.ok) {
      this.#o.logger.error("revocation list rejected", {
        message: parsed.message,
      });
      return;
    }
    this.#revoked = parsed.revoked;
  }

  async #persist(token: string): Promise<void> {
    try {
      await this.#o.state.write({ token, clockWatermark: this.#watermark });
    } catch (err) {
      this.#o.logger.warn("failed to persist license state", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  #publish(e: Entitlements): Entitlements {
    this.#entitlements = e;
    for (const fn of this.#listeners) {
      try {
        fn(e);
      } catch {}
    }
    return e;
  }

  #schedule(): void {
    if (this.#stopped) return;
    const base = this.#o.refreshIntervalSec * 1000;
    const jitter = Math.floor(Math.random() * base * 0.2);
    this.#timer = setTimeout(() => {
      void this.refresh().finally(() => this.#schedule());
    }, base + jitter);
    (this.#timer as { unref?: () => void }).unref?.();
  }
}

const fpCache = new Map<string, string>();
function deploymentFingerprintCached(id: string): string {
  let v = fpCache.get(id);
  if (!v) {
    v = require_deploymentFingerprint(id);
    fpCache.set(id, v);
  }
  return v;
}

import { parseRevocationList } from "./revocation";
import { deploymentFingerprint as require_deploymentFingerprint } from "./verify";
