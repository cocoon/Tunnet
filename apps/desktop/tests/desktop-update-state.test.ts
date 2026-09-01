import { describe, expect, test } from "bun:test";
import { transitionDesktopUpdate } from "../src/lib/desktop-update-state";

describe("Desktop updater state", () => {
  test("keeps download and install user-initiated", () => {
    expect(transitionDesktopUpdate("idle", "check")).toBe("checking");
    expect(transitionDesktopUpdate("checking", "found")).toBe("available");
    expect(transitionDesktopUpdate("available", "download")).toBe(
      "downloading",
    );
    expect(transitionDesktopUpdate("downloading", "downloaded")).toBe("ready");
    expect(transitionDesktopUpdate("ready", "install")).toBe("installing");
  });

  test("supports no-update and retry paths", () => {
    expect(transitionDesktopUpdate("checking", "none")).toBe("idle");
    expect(transitionDesktopUpdate("downloading", "fail")).toBe("error");
    expect(transitionDesktopUpdate("error", "check")).toBe("checking");
  });
});
