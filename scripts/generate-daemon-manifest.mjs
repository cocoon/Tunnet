import { pathToFileURL } from "node:url";

const TARGETS = {
  "x86_64-unknown-linux-gnu": ["linux", "x86_64", "gnu", "tar.gz"],
  "aarch64-unknown-linux-gnu": ["linux", "aarch64", "gnu", "tar.gz"],
  "x86_64-unknown-linux-musl": ["linux", "x86_64", "musl", "tar.gz"],
  "aarch64-unknown-linux-musl": ["linux", "aarch64", "musl", "tar.gz"],
  "aarch64-apple-darwin": ["macos", "aarch64", "", "tar.gz"],
  "x86_64-pc-windows-msvc": ["windows", "x86_64", "msvc", "zip"],
  "aarch64-pc-windows-msvc": ["windows", "aarch64", "msvc", "zip"],
};

export function generateCoreManifest({
  version,
  apiVersion,
  repository,
  artifacts,
}) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`invalid Core version: ${version}`);
  if (!Number.isInteger(apiVersion) || apiVersion < 1)
    throw new Error(`invalid Local API version: ${apiVersion}`);
  if (!Array.isArray(artifacts) || artifacts.length === 0)
    throw new Error("at least one Core artifact is required");
  return {
    schema_version: 1,
    version,
    api_version: apiVersion,
    artifacts: artifacts.map(({ target, sha256 }) => {
      const metadata = TARGETS[target];
      if (!metadata) throw new Error(`unsupported Core target: ${target}`);
      if (!/^[a-f0-9]{64}$/i.test(sha256))
        throw new Error("SHA-256 must contain 64 hexadecimal characters");
      const [platform, arch, environment, extension] = metadata;
      return {
        platform,
        arch,
        environment: environment || undefined,
        url: `https://github.com/${repository}/releases/download/v${version}/tunnet-headless-${version}-${target}.${extension}`,
        sha256: sha256.toLowerCase(),
      };
    }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, apiVersion, artifactsJson, repository] =
    process.argv.slice(2);
  process.stdout.write(
    JSON.stringify(
      generateCoreManifest({
        version,
        apiVersion: Number(apiVersion),
        artifacts: JSON.parse(artifactsJson),
        repository,
      }),
    ),
  );
}
