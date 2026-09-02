import { Hono } from "hono";

import { detectPlatform, type Platform, parsePlatform } from "./platform";
import { releases } from "./releases";

const app = new Hono();

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

function desktopUrl(platform: Platform): string | undefined {
  switch (platform) {
    case "windows":
      return releases.desktop.windows;

    case "linux":
    case "macos":
      return undefined;
  }
}

function redirectCli(request: Request, explicitPlatform?: string): Response {
  const platform = resolvePlatform(request, explicitPlatform);

  if (!platform) {
    return Response.redirect(releases.latest, 302);
  }

  return Response.redirect(cliUrl(platform), 302);
}

function redirectDesktop(
  request: Request,
  explicitPlatform?: string,
): Response {
  const platform = resolvePlatform(request, explicitPlatform);

  if (!platform) {
    return Response.redirect(releases.latest, 302);
  }

  const target = desktopUrl(platform);

  if (target) {
    return Response.redirect(target, 302);
  }

  return new Response(
    [
      `Tunnet Desktop is not available for ${platform} yet.`,
      "",
      `Install Tunnet CLI + daemon instead:`,
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

export default app;
