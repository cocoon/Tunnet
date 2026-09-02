import { expect, test } from "bun:test";

import app from "./index";

test("redirects /desktop/windows to the Desktop setup, not the CLI installer", async () => {
  const response = await app.request("https://get.tunnet.io/desktop/windows");

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "https://github.com/tunnetio/Tunnet/releases/download/desktop-latest/Tunnet_Desktop_x64-setup.exe",
  );
});
