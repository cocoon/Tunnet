import type { Platform } from "./platform";

const REPOSITORY = "https://github.com/tunnetio/Tunnet";
const LATEST_RELEASE = `${REPOSITORY}/releases/latest`;
const LATEST_DOWNLOAD = `${LATEST_RELEASE}/download`;

export const releases = {
  latest: LATEST_RELEASE,

  cli: {
    windows: `${LATEST_DOWNLOAD}/install.ps1`,
    linux: `${LATEST_DOWNLOAD}/install.sh`,
    macos: `${LATEST_DOWNLOAD}/install.sh`,
  } satisfies Record<Platform, string>,
} as const;
