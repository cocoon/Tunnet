import { expect, test } from "bun:test";

import {
  type DesktopRelease,
  selectLatestDesktopRelease,
} from "./desktop-releases";
import { createApp } from "./index";

const desktopV2Setup =
  "https://github.com/tunnetio/Tunnet/releases/download/desktop-v0.2.0/Tunnet_Desktop_0.2.0_x64-setup.exe";
const desktopV3Setup =
  "https://github.com/tunnetio/Tunnet/releases/download/desktop-v0.3.0/Tunnet_Desktop_0.3.0_x64-setup.exe";

const desktopV2 = {
  assets: [
    {
      name: "latest.json",
      browser_download_url:
        "https://github.com/tunnetio/Tunnet/releases/download/desktop-v0.2.0/latest.json",
    },
    {
      name: "Tunnet_Desktop_0.2.0_x64-setup.exe",
      browser_download_url: desktopV2Setup,
    },
  ],
  draft: false,
  prerelease: false,
  tag_name: "desktop-v0.2.0",
};

const desktopV3 = {
  assets: [
    {
      name: "latest.json",
      browser_download_url:
        "https://github.com/tunnetio/Tunnet/releases/download/desktop-v0.3.0/latest.json",
    },
    {
      name: "Tunnet_Desktop_0.3.0_x64-setup.exe",
      browser_download_url: desktopV3Setup,
    },
  ],
  draft: false,
  prerelease: false,
  tag_name: "desktop-v0.3.0",
};

test("selects the newest published Desktop release and ignores Core releases", () => {
  expect(
    selectLatestDesktopRelease([
      {
        assets: [
          {
            name: "install.ps1",
            browser_download_url:
              "https://github.com/tunnetio/Tunnet/releases/download/v0.8.0/install.ps1",
          },
        ],
        draft: false,
        prerelease: false,
        tag_name: "v0.8.0",
      },
      desktopV2,
      desktopV3,
    ])?.setupUrl,
  ).toBe(desktopV3Setup);
});

test("never selects draft or prerelease Desktop releases", () => {
  expect(
    selectLatestDesktopRelease([
      { ...desktopV3, draft: true, tag_name: "desktop-v0.4.0" },
      { ...desktopV3, prerelease: true, tag_name: "desktop-v0.5.0" },
      desktopV2,
    ])?.setupUrl,
  ).toBe(desktopV2Setup);
});

test("routes Desktop setup and updater requests to the selected Desktop release", async () => {
  const release = selectLatestDesktopRelease([desktopV2]) as DesktopRelease;
  const app = createApp(async () => release);

  const setup = await app.request("https://get.tunnet.io/desktop/windows");
  const manifest = await app.request(
    "https://get.tunnet.io/desktop/latest.json",
  );

  expect(setup.status).toBe(302);
  expect(setup.headers.get("location")).toBe(release.setupUrl);
  expect(setup.headers.get("location")).not.toContain("/download/v0.8.0/");
  expect(manifest.status).toBe(302);
  expect(manifest.headers.get("location")).toBe(release.latestJsonUrl);
});
