import { Hono } from "hono";

import {
  type DesktopRelease,
  resolveLatestDesktopRelease,
} from "./desktop-releases";
import { detectPlatform, type Platform, parsePlatform } from "./platform";
import { releases } from "./releases";

type DesktopReleaseResolver = () => Promise<DesktopRelease | undefined>;

function resolvePlatform(
  request: Request,
  explicit?: string | null,
): Platform | undefined {
  const url = new URL(request.url);

  return (
    parsePlatform(explicit) ??
    parsePlatform(url.searchParams.get("os")) ??
    parsePlatform(url.searchParams.get("platform")) ??
    detectPlatform(request)
  );
}

function cliUrl(platform: Platform): string {
  return releases.cli[platform];
}

function redirectCli(request: Request, explicitPlatform?: string): Response {
  const platform = resolvePlatform(request, explicitPlatform);

  if (!platform) {
    return Response.redirect(releases.latest, 302);
  }

  return Response.redirect(cliUrl(platform), 302);
}

function desktopUnavailable(platform: Platform): Response {
  return new Response(
    [
      `Tunnet Desktop is not available for ${platform} yet.`,
      "",
      "Install Tunnet CLI + daemon instead:",
      `https://get.tunnet.io/${platform}`,
      "",
    ].join("\n"),
    {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

export function createApp(
  resolveDesktopRelease: DesktopReleaseResolver = resolveLatestDesktopRelease,
) {
  const app = new Hono();

  async function redirectDesktop(
    request: Request,
    explicitPlatform?: string,
  ): Promise<Response> {
    const platform = resolvePlatform(request, explicitPlatform);

    if (!platform) {
      return Response.redirect(releases.latest, 302);
    }

    if (platform !== "windows") {
      return desktopUnavailable(platform);
    }

    const release = await resolveDesktopRelease();

    if (!release) {
      return new Response(
        "No published Tunnet Desktop release is available.\n",
        {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }

    return Response.redirect(release.setupUrl, 302);
  }

  app.get("/", (c) => {
    return redirectCli(c.req.raw);
  });

  app.get("/cli", (c) => {
    return redirectCli(c.req.raw);
  });

  app.get("/install", (c) => {
    return redirectCli(c.req.raw);
  });

  app.get("/desktop", (c) => {
    return redirectDesktop(c.req.raw);
  });

  app.get("/desktop/latest.json", async () => {
    const release = await resolveDesktopRelease();

    if (!release) {
      return new Response(
        "No published Tunnet Desktop release is available.\n",
        {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }

    return Response.redirect(release.latestJsonUrl, 302);
  });

  app.get("/desktop/:platform", (c) => {
    const platform = parsePlatform(c.req.param("platform"));

    if (!platform) {
      return c.notFound();
    }

    return redirectDesktop(c.req.raw, platform);
  });

  app.get("/:platform{windows|win|linux|macos|mac|darwin}", (c) => {
    return redirectCli(c.req.raw, c.req.param("platform"));
  });

  app.get("/cli/:platform", (c) => {
    const platform = parsePlatform(c.req.param("platform"));

    if (!platform) {
      return c.notFound();
    }

    return c.redirect(cliUrl(platform), 302);
  });

  app.get("/install/:platform", (c) => {
    const platform = parsePlatform(c.req.param("platform"));

    if (!platform) {
      return c.notFound();
    }

    return c.redirect(cliUrl(platform), 302);
  });

  app.notFound((c) => {
    return c.text("Not found\n", 404);
  });

  return app;
}

export default createApp();
