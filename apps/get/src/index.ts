import { Hono } from "hono";
import { detectPlatform, type Platform, parsePlatform } from "./platform";
import {
  type ReleaseChannel,
  type ResolvedRelease,
  resolveLatestRelease,
} from "./release-channels";

export type ReleaseResolver = (
  channel: ReleaseChannel,
) => Promise<ResolvedRelease | undefined>;

function resolvePlatform(
  request: Request,
  explicit?: string,
): Platform | undefined {
  const url = new URL(request.url);
  return (
    parsePlatform(explicit) ??
    parsePlatform(url.searchParams.get("os")) ??
    parsePlatform(url.searchParams.get("platform")) ??
    detectPlatform(request)
  );
}

function unavailable(product: string): Response {
  return new Response(
    `No published Tunnet ${product} release is available.\n`,
    {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
}

function installerName(platform: Platform): "install.ps1" | "install.sh" {
  return platform === "windows" ? "install.ps1" : "install.sh";
}

export function createApp(
  resolveRelease: ReleaseResolver = resolveLatestRelease,
) {
  const app = new Hono();

  async function coreAsset(name: string): Promise<Response> {
    const release = await resolveRelease("core");
    if (!release) return unavailable("Core");
    const url = release.assets[name];
    return url ? Response.redirect(url, 302) : unavailable("Core");
  }

  async function redirectInstaller(
    request: Request,
    explicitPlatform?: string,
  ): Promise<Response> {
    const platform = resolvePlatform(request, explicitPlatform);
    if (!platform) {
      return new Response(
        "Choose an installer explicitly:\nhttps://get.tunnet.io/install.sh\nhttps://get.tunnet.io/install.ps1\n",
        {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
    return coreAsset(installerName(platform));
  }

  async function redirectDesktop(
    request: Request,
    explicitPlatform?: string,
  ): Promise<Response> {
    const platform = resolvePlatform(request, explicitPlatform);
    if (!platform)
      return new Response(
        "Tunnet Desktop is currently available for Windows.\n",
        { status: 400 },
      );
    if (platform !== "windows") {
      return new Response(
        `Tunnet Desktop is not available for ${platform} yet.\n\nInstall Core instead:\nhttps://get.tunnet.io/${platform}\n`,
        {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
    const release = await resolveRelease("desktop");
    if (!release) return unavailable("Desktop");
    const setup = `Tunnet_Desktop_${release.version.join(".")}_x64-setup.exe`;
    return Response.redirect(release.assets[setup], 302);
  }

  app.get("/", async (c) => {
    const platform = resolvePlatform(c.req.raw);
    return platform
      ? coreAsset(installerName(platform))
      : coreAsset("install.sh");
  });
  app.get("/cli", (c) => redirectInstaller(c.req.raw));
  app.get("/install", (c) => redirectInstaller(c.req.raw));
  app.get("/install.sh", () => coreAsset("install.sh"));
  app.get("/install.ps1", () => coreAsset("install.ps1"));
  app.get("/core/latest.json", () => coreAsset("core-manifest.json"));
  app.get("/desktop", (c) => redirectDesktop(c.req.raw));
  app.get("/desktop/latest.json", async () => {
    const release = await resolveRelease("desktop");
    return release
      ? Response.redirect(release.assets["latest.json"], 302)
      : unavailable("Desktop");
  });
  app.get("/desktop/:platform", (c) =>
    redirectDesktop(c.req.raw, c.req.param("platform")),
  );
  app.get("/:platform{windows|win|linux|macos|mac|darwin}", (c) =>
    redirectInstaller(c.req.raw, c.req.param("platform")),
  );
  app.get("/cli/:platform", (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    return platform ? redirectInstaller(c.req.raw, platform) : c.notFound();
  });
  app.get("/install/:platform", (c) => {
    const platform = parsePlatform(c.req.param("platform"));
    return platform ? redirectInstaller(c.req.raw, platform) : c.notFound();
  });
  app.notFound((c) => c.text("Not found\n", 404));
  return app;
}

export default createApp();
