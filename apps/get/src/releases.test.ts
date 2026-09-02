import { describe, expect, test } from "bun:test";
import { createApp } from "./index";
import {
  discoverLatestRelease,
  type GitHubRelease,
  type GitHubReleaseFetcher,
  type ResolvedRelease,
  selectLatestRelease,
} from "./release-channels";

function release(
  tag: string,
  assets: string[],
  options: Partial<GitHubRelease> = {},
): GitHubRelease {
  return {
    assets: assets.map((name) => ({
      name,
      browser_download_url: `https://downloads.example.test/${tag}/${name}`,
    })),
    draft: false,
    prerelease: false,
    tag_name: tag,
    ...options,
  };
}
function core(version: string, options?: Partial<GitHubRelease>) {
  return release(
    `v${version}`,
    ["core-manifest.json", "install.sh", "install.ps1"],
    options,
  );
}
function desktop(version: string, options?: Partial<GitHubRelease>) {
  return release(
    `desktop-v${version}`,
    ["latest.json", `Tunnet_Desktop_${version}_x64-setup.exe`],
    options,
  );
}

describe("release family selection", () => {
  test("selects each family independently by semantic version", () => {
    const releases = [
      core("2.9.9"),
      desktop("99.0.0"),
      core("10.0.0"),
      desktop("3.1.0"),
    ];
    expect(selectLatestRelease(releases, "core")?.tag).toBe("v10.0.0");
    expect(selectLatestRelease(releases, "desktop")?.tag).toBe(
      "desktop-v99.0.0",
    );
  });

  test("ignores drafts and prereleases in both stable channels", () => {
    const releases = [
      core("9.0.0", { draft: true }),
      core("8.0.0", { prerelease: true }),
      core("1.0.0"),
      desktop("9.0.0", { draft: true }),
      desktop("8.0.0", { prerelease: true }),
      desktop("1.0.0"),
    ];
    expect(selectLatestRelease(releases, "core")?.tag).toBe("v1.0.0");
    expect(selectLatestRelease(releases, "desktop")?.tag).toBe(
      "desktop-v1.0.0",
    );
  });

  test("ignores malformed and incomplete releases", () => {
    const releases = [
      release("v7.0", ["core-manifest.json", "install.sh", "install.ps1"]),
      release("v6.0.0", ["install.sh", "install.ps1"]),
      release("desktop-v7.0.0", ["latest.json"]),
      core("1.2.3"),
      desktop("1.2.3"),
    ];
    expect(selectLatestRelease(releases, "core")?.tag).toBe("v1.2.3");
    expect(selectLatestRelease(releases, "desktop")?.tag).toBe(
      "desktop-v1.2.3",
    );
  });

  test("paginates before selecting", async () => {
    const requests: string[] = [];
    const fetcher: GitHubReleaseFetcher = async (url) => {
      requests.push(url);
      return url.includes("page=2")
        ? Response.json([core("2.0.0")])
        : Response.json([core("1.0.0")], {
            headers: {
              Link: '<https://api.github.com/repos/tunnetio/Tunnet/releases?per_page=100&page=2>; rel="next"',
            },
          });
    };
    expect((await discoverLatestRelease("core", fetcher))?.tag).toBe("v2.0.0");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEndWith("/releases?per_page=100");
  });
});

test("routes use assets from their selected release family", async () => {
  const coreRelease = selectLatestRelease(
    [core("4.5.6")],
    "core",
  ) as ResolvedRelease;
  const desktopRelease = selectLatestRelease(
    [desktop("7.8.9")],
    "desktop",
  ) as ResolvedRelease;
  const app = createApp(async (channel) =>
    channel === "core" ? coreRelease : desktopRelease,
  );
  const routes: Array<[string, string]> = [
    ["/core/latest.json", coreRelease.assets["core-manifest.json"]],
    ["/install.sh", coreRelease.assets["install.sh"]],
    ["/install.ps1", coreRelease.assets["install.ps1"]],
    ["/windows", coreRelease.assets["install.ps1"]],
    ["/cli/linux", coreRelease.assets["install.sh"]],
    ["/install/macos", coreRelease.assets["install.sh"]],
    ["/desktop/latest.json", desktopRelease.assets["latest.json"]],
    [
      "/desktop/windows",
      desktopRelease.assets["Tunnet_Desktop_7.8.9_x64-setup.exe"],
    ],
  ];
  for (const path of ["/linux", "/macos", "/cli/macos", "/install/linux"]) {
    routes.push([path, coreRelease.assets["install.sh"]]);
  }
  for (const path of ["/cli/windows", "/install/windows"]) {
    routes.push([path, coreRelease.assets["install.ps1"]]);
  }
  for (const [path, location] of routes) {
    const response = await app.request(`https://get.tunnet.io${path}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(location);
  }
});

test("plain curl receives the Unix bootstrap from the latest Core release", async () => {
  const coreRelease = selectLatestRelease(
    [core("4.5.6")],
    "core",
  ) as ResolvedRelease;
  const response = await createApp(async () => coreRelease).request(
    "https://get.tunnet.io/",
    {
      headers: { "User-Agent": "curl/9.0.0" },
    },
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    coreRelease.assets["install.sh"],
  );
});

test("PowerShell receives the Windows bootstrap from the latest Core release", async () => {
  const coreRelease = selectLatestRelease(
    [core("4.5.6")],
    "core",
  ) as ResolvedRelease;
  const response = await createApp(async () => coreRelease).request(
    "https://get.tunnet.io/",
    {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT; WindowsPowerShell)" },
    },
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    coreRelease.assets["install.ps1"],
  );
});
