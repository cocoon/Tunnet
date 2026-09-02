const GITHUB_RELEASES = "https://api.github.com/repos/tunnetio/Tunnet/releases";
const CACHE_KEY = new Request("https://get.tunnet.io/__desktop-release");
const CACHE_TTL_SECONDS = 300;
const DESKTOP_TAG = /^desktop-v(\d+)\.(\d+)\.(\d+)$/;

type GitHubRelease = {
  assets: Array<{
    browser_download_url: string;
    name: string;
  }>;
  draft: boolean;
  prerelease: boolean;
  tag_name: string;
};

export type GitHubReleaseFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type DesktopRelease = {
  latestJsonUrl: string;
  setupUrl: string;
  version: readonly [number, number, number];
};

function compareVersions(
  [leftMajor, leftMinor, leftPatch]: DesktopRelease["version"],
  [rightMajor, rightMinor, rightPatch]: DesktopRelease["version"],
): number {
  for (const difference of [
    leftMajor - rightMajor,
    leftMinor - rightMinor,
    leftPatch - rightPatch,
  ]) {
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function desktopRelease(candidate: GitHubRelease): DesktopRelease | undefined {
  const match = DESKTOP_TAG.exec(candidate.tag_name);

  if (!match || candidate.draft || candidate.prerelease) {
    return undefined;
  }

  const version = match.slice(1).map(Number) as [number, number, number];
  const setupName = `Tunnet_Desktop_${version.join(".")}_x64-setup.exe`;
  const setupUrl = candidate.assets.find(
    (asset) => asset.name === setupName,
  )?.browser_download_url;
  const latestJsonUrl = candidate.assets.find(
    (asset) => asset.name === "latest.json",
  )?.browser_download_url;

  if (!setupUrl || !latestJsonUrl) {
    return undefined;
  }

  return { latestJsonUrl, setupUrl, version };
}

export function selectLatestDesktopRelease(
  candidateReleases: readonly GitHubRelease[],
): DesktopRelease | undefined {
  return candidateReleases
    .map(desktopRelease)
    .filter((release): release is DesktopRelease => release !== undefined)
    .sort((left, right) => compareVersions(right.version, left.version))[0];
}

function releaseCache(): Cache | undefined {
  return typeof caches === "undefined" ? undefined : caches.default;
}

function nextPage(response: Response): string | undefined {
  const links = response.headers.get("Link");

  return links
    ?.split(",")
    .map((link) => link.trim())
    .find((link) => /;\s*rel="next"$/.test(link))
    ?.match(/^<([^>]+)>/)?.[1];
}

export async function discoverLatestDesktopRelease(
  fetchReleasePage: GitHubReleaseFetcher = (url, init) => fetch(url, init),
): Promise<DesktopRelease | undefined> {
  const candidateReleases: GitHubRelease[] = [];
  let pageUrl: string | undefined = `${GITHUB_RELEASES}?per_page=100`;

  while (pageUrl) {
    const response = await fetchReleasePage(pageUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "tunnet-get",
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const page: unknown = await response.json();

    if (!Array.isArray(page)) {
      return undefined;
    }

    candidateReleases.push(...(page as GitHubRelease[]));
    pageUrl = nextPage(response);
  }

  return selectLatestDesktopRelease(candidateReleases);
}

export async function resolveLatestDesktopRelease(): Promise<
  DesktopRelease | undefined
> {
  const cache = releaseCache();
  const cached = await cache?.match(CACHE_KEY);

  if (cached) {
    return (await cached.json()) as DesktopRelease;
  }

  const release = await discoverLatestDesktopRelease();

  if (release && cache) {
    await cache.put(
      CACHE_KEY,
      Response.json(release, {
        headers: {
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      }),
    );
  }

  return release;
}
