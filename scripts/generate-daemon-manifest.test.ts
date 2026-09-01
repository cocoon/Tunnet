import { describe, expect, test } from "bun:test";
import { generateDaemonManifest } from "./generate-daemon-manifest.mjs";

describe("Core release metadata", () => {
  test("points only to an immutable Core release", () => {
    const manifest = generateDaemonManifest({
      version: "1.2.3",
      apiVersion: 2,
      repository: "tunnetio/Tunnet",
      artifacts: [{ target: "x86_64-pc-windows-msvc", sha256: "a".repeat(64) }],
    });
    expect(manifest.artifacts[0].url).toContain("/releases/download/v1.2.3/");
    expect(manifest.artifacts[0].url).not.toContain("latest");
    expect(manifest.api_version).toBe(2);
  });

  test("rejects malformed release inputs", () => {
    expect(() =>
      generateDaemonManifest({
        version: "desktop-v1",
        apiVersion: 2,
        repository: "tunnetio/Tunnet",
        artifacts: [],
      }),
    ).toThrow();
  });
});
