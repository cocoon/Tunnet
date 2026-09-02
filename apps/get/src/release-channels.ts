const GITHUB_RELEASES = "https://api.github.com/repos/tunnetio/Tunnet/releases";
const CACHE_TTL_SECONDS = 300;

export type ReleaseChannel = "core" | "desktop";
export type Version = readonly [number, number, number];

export type GitHubRelease = {
  assets: Array<{ browser_download_url: string; name: string }>;
  draft: boolean;
  prerelease: boolean;
  tag_name: string;
};

export type ResolvedRelease = {
  assets: Record<string, string>;
  tag: string;
  version: Version;
};

export type GitHubReleaseFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const CHANNELS = {
  core: {
    tag: /^v(\d+)\.(\d+)\.(\d+)$/,
    requiredAssets: ["core-manifest.json", "install.sh", "install.ps1"],
  },
  desktop: {
    tag: /^desktop-v(\d+)\.(\d+)\.(\d+)$/,
    requiredAssets: ["latest.json"],
  },
} as const;

function candidate(
  release: GitHubRelease,
  channel: ReleaseChannel,
): ResolvedRelease | undefined {
  const definition = CHANNELS[channel];
  const match = definition.tag.exec(release.tag_name);
  if (!match || release.draft || release.prerelease) return undefined;
  const assets = Object.fromEntries(
    release.assets.map((asset) => [asset.name, asset.browser_download_url]),
  );
  if (definition.requiredAssets.some((name) => !assets[name])) return undefined;
  if (channel === "desktop") {
    const setup = `Tunnet_Desktop_${match.slice(1).join(".")}_x64-setup.exe`;
    if (!assets[setup]) return undefined;
  }
  return {
    assets,
    tag: release.tag_name,
    version: match.slice(1).map(Number) as [number, number, number],
  };
}

function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectLatestRelease(
  releases: readonly GitHubRelease[],
  channel: ReleaseChannel,
): ResolvedRelease | undefined {
  let latest: ResolvedRelease | undefined;
  for (const release of releases) {
    const selected = candidate(release, channel);
    if (
      selected &&
      (!latest || compareVersions(selected.version, latest.version) > 0)
    )
      latest = selected;
  }
  return latest;
}

function nextPage(response: Response): string | undefined {
  return response.headers
    .get("Link")
    ?.split(",")
    .map((link) => link.trim())
    .find((link) => /;\s*rel="next"$/.test(link))
    ?.match(/^<([^>]+)>/)?.[1];
}

export async function discoverLatestRelease(
  channel: ReleaseChannel,
  fetchPage: GitHubReleaseFetcher = (url, init) => fetch(url, init),
): Promise<ResolvedRelease | undefined> {
  const releases: GitHubRelease[] = [];
  let url: string | undefined = `${GITHUB_RELEASES}?per_page=100`;
  while (url) {
    const response = await fetchPage(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "tunnet-get",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return undefined;
    const page: unknown = await response.json();
    if (!Array.isArray(page)) return undefined;
    releases.push(...(page as GitHubRelease[]));
    url = nextPage(response);
  }
  return selectLatestRelease(releases, channel);
}

function releaseCache(): Cache | undefined {
  return typeof caches === "undefined" ? undefined : caches.default;
}

export async function resolveLatestRelease(
  channel: ReleaseChannel,
): Promise<ResolvedRelease | undefined> {
  const cache = releaseCache();
  const key = new Request(`https://get.tunnet.io/__release-channel/${channel}`);
  const cached = await cache?.match(key);
  if (cached) return (await cached.json()) as ResolvedRelease;
  const release = await discoverLatestRelease(channel);
  if (release && cache) {
    await cache.put(
      key,
      Response.json(release, {
        headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
      }),
    );
  }
  return release;
}
