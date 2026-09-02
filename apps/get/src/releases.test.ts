import { expect, test } from "bun:test";

import {
  type DesktopRelease,
  discoverLatestDesktopRelease,
  type GitHubReleaseFetcher,
  selectLatestDesktopRelease,
} from "./desktop-releases";
import { createApp } from "./index";

function desktopRelease(version: string) {
  const tag = `desktop-v${version}`;
  const baseUrl = `https://releases.example.test/${tag}`;

  return {
    assets: [
      {
        name: "latest.json",
        browser_download_url: `${baseUrl}/latest.json`,
      },
      {
        name: `Tunnet_Desktop_${version}_x64-setup.exe`,
        browser_download_url: `${baseUrl}/Tunnet_Desktop_${version}_x64-setup.exe`,
      },
    ],
    draft: false,
    prerelease: false,
    tag_name: tag,
  };
}

const desktopV123 = desktopRelease("1.2.3");
const desktopV200 = desktopRelease("2.0.0");

test("selects the newest published Desktop release and ignores Core releases", () => {
  expect(
    selectLatestDesktopRelease([
      {
        assets: [
          {
            name: "install.ps1",
            browser_download_url:
              "https://releases.example.test/v99.0.0/install.ps1",
          },
        ],
        draft: false,
        prerelease: false,
        tag_name: "v99.0.0",
      },
      desktopV123,
      desktopV200,
    ])?.setupUrl,
  ).toBe(desktopV200.assets[1]?.browser_download_url);
});

test("never selects draft or prerelease Desktop releases", () => {
  expect(
    selectLatestDesktopRelease([
      { ...desktopRelease("3.0.0"), draft: true },
      { ...desktopRelease("4.0.0"), prerelease: true },
      desktopV123,
    ])?.setupUrl,
  ).toBe(desktopV123.assets[1]?.browser_download_url);
});

test("paginates GitHub releases before choosing the latest Desktop release", async () => {
  const requestedPages: string[] = [];
  const fetchReleasePage: GitHubReleaseFetcher = async (url) => {
    requestedPages.push(url);

    if (url.includes("page=2")) {
      return Response.json([desktopV200]);
    }

    return Response.json(
      [
        {
          assets: [],
          draft: false,
          prerelease: false,
          tag_name: "v99.0.0",
        },
        desktopV123,
      ],
      {
        headers: {
          Link: '<https://api.github.com/repos/example/project/releases?per_page=100&page=2>; rel="next"',
        },
      },
    );
  };

  expect((await discoverLatestDesktopRelease(fetchReleasePage))?.setupUrl).toBe(
    desktopV200.assets[1]?.browser_download_url,
  );
  expect(requestedPages).toHaveLength(2);
});

test("routes Desktop setup and updater requests to the selected Desktop release", async () => {
  const release = selectLatestDesktopRelease([desktopV123]) as DesktopRelease;
  const app = createApp(async () => release);

  const setup = await app.request("https://get.tunnet.io/desktop/windows");
  const manifest = await app.request(
    "https://get.tunnet.io/desktop/latest.json",
  );

  expect(setup.status).toBe(302);
  expect(setup.headers.get("location")).toBe(release.setupUrl);
  expect(setup.headers.get("location")).not.toContain("v99.0.0");
  expect(manifest.status).toBe(302);
  expect(manifest.headers.get("location")).toBe(release.latestJsonUrl);
});
