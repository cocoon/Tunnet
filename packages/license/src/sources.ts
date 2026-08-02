import { MAX_TOKEN_CHARS } from "./token";

export type SourceResult =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      readonly reason: "not_configured" | "unavailable" | "too_large";
      readonly message: string;
    };

export type LicenseSource = {
  readonly describe: string;
  load(signal: AbortSignal): Promise<SourceResult>;
};

export const emptySource: LicenseSource = {
  describe: "none",
  load: async () => ({
    ok: false,
    reason: "not_configured",
    message: "no license configured",
  }),
};

export function inlineSource(token: string): LicenseSource {
  return {
    describe: "inline",
    load: async () => ({ ok: true, token: token.trim() }),
  };
}

export function fileSource(
  path: string,
  readFile: (p: string) => Promise<string>,
): LicenseSource {
  return {
    describe: `file:${path}`,
    load: async () => {
      try {
        const text = await readFile(path);
        if (text.length > MAX_TOKEN_CHARS)
          return {
            ok: false,
            reason: "too_large",
            message: "license file too large",
          };
        return { ok: true, token: text.trim() };
      } catch (err) {
        return {
          ok: false,
          reason: "unavailable",
          message: err instanceof Error ? err.message : "read failed",
        };
      }
    },
  };
}

export type HttpSourceOptions = {
  readonly timeoutMs?: number;
  readonly allowInsecure?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
};

export function httpSource(
  url: string,
  options: HttpSourceOptions = {},
): LicenseSource {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !options.allowInsecure) {
    throw new Error(
      "license URL must use https (set allowInsecure to override)",
    );
  }
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    describe: `http:${parsed.origin}${parsed.pathname}`,
    load: async (outer) => {
      const ctl = new AbortController();
      const timer = setTimeout(
        () => ctl.abort(new Error("timeout")),
        timeoutMs,
      );
      const onAbort = () => ctl.abort(outer.reason);
      outer.addEventListener("abort", onAbort, { once: true });
      try {
        const res = await fetch(parsed, {
          signal: ctl.signal,
          redirect: "error",
          headers: { accept: "text/plain", ...options.headers },
        });
        if (!res.ok)
          return {
            ok: false,
            reason: "unavailable",
            message: `HTTP ${res.status}`,
          };

        const reader = res.body?.getReader();
        if (!reader)
          return { ok: false, reason: "unavailable", message: "empty body" };
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_TOKEN_CHARS) {
            await reader.cancel();
            return {
              ok: false,
              reason: "too_large",
              message: "license response too large",
            };
          }
          chunks.push(value);
        }
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          buf.set(c, off);
          off += c.byteLength;
        }
        return { ok: true, token: new TextDecoder().decode(buf).trim() };
      } catch (err) {
        return {
          ok: false,
          reason: "unavailable",
          message: err instanceof Error ? err.message : "fetch failed",
        };
      } finally {
        clearTimeout(timer);
        outer.removeEventListener("abort", onAbort);
      }
    },
  };
}
