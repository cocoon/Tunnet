import { Elysia } from "elysia";
import { license } from "../../auth";

export const entitlementsRoutes = new Elysia({ prefix: "/entitlements" }).get(
  "/",
  () => license.snapshot(),
);
