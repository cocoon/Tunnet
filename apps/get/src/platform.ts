export type Platform = "windows" | "linux" | "macos";

export function parsePlatform(value?: string | null): Platform | undefined {
  switch (value?.trim().toLowerCase()) {
    case "windows":
    case "win":
    case "win32":
      return "windows";

    case "linux":
      return "linux";

    case "mac":
    case "macos":
    case "darwin":
    case "osx":
      return "macos";

    default:
      return undefined;
  }
}

export function detectPlatform(request: Request): Platform | undefined {
  const clientHint = request.headers
    .get("sec-ch-ua-platform")
    ?.replaceAll('"', "")
    .trim()
    .toLowerCase();

  if (clientHint) {
    if (clientHint.includes("windows")) return "windows";
    if (clientHint.includes("mac")) return "macos";
    if (clientHint.includes("linux")) return "linux";
  }

  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";

  if (userAgent.includes("windows")) {
    return "windows";
  }

  if (
    userAgent.includes("macintosh") ||
    userAgent.includes("mac os") ||
    userAgent.includes("darwin")
  ) {
    return "macos";
  }

  if (userAgent.includes("linux")) {
    return "linux";
  }

  return undefined;
}
