import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { ssoClient } from "@better-auth/sso/client";
import { stripeClient } from "@better-auth/stripe/client";
import {
  ac,
  admin,
  adminPluginAc,
  adminPluginAdminRole,
  adminPluginUserRole,
  member,
  owner,
} from "@tunnet/api/auth";
import {
  adminClient,
  deviceAuthorizationClient,
  inferOrgAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getManagementApiUrl } from "@/lib/env";

export const authClient = createAuthClient({
  baseURL: getManagementApiUrl(),
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    adminClient({
      ac: adminPluginAc,
      roles: {
        admin: adminPluginAdminRole,
        user: adminPluginUserRole,
      },
    }),
    organizationClient({
      ac,
      roles: {
        owner,
        admin,
        member,
      },
      dynamicAccessControl: {
        enabled: true,
      },
      schema: inferOrgAdditionalFields({
        organization: {
          additionalFields: {
            quickEnrollEnabled: {
              type: "boolean",
              required: false,
              defaultValue: true,
            },
            deletedAt: {
              type: "date",
              required: false,
            },
          },
        },
        organizationRole: {
          additionalFields: {
            position: {
              type: "number",
              required: false,
              defaultValue: 101,
            },
            color: {
              type: "string",
              required: false,
            },
          },
        },
      }),
    }),
    stripeClient({
      subscription: true,
    }),
    ssoClient(),
    oauthProviderClient(),
    deviceAuthorizationClient(),
  ],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  organization,
  useListOrganizations,
  useActiveOrganization,
} = authClient;

export type Session = typeof authClient.$Infer.Session;
