import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  userAc,
} from "better-auth/plugins/admin/access";

/**
 * Better Auth admin-plugin access control (deployment-wide).
 * Separate from organization RBAC in `./permissions.ts`.
 */
export const statement = {
  ...defaultStatements,
  cloud: ["access"],
} as const;

export const ac = createAccessControl(statement);

export const admin = ac.newRole({
  cloud: ["access"],
  ...adminAc.statements,
});

export const user = ac.newRole({
  ...userAc.statements,
});
