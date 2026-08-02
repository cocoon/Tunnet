import { Elysia } from "elysia";

import { auth } from "../../../auth";

export type AuthContext = {
  user: { id: string; name: string; email: string };
  session: { id: string; activeOrganizationId?: string | null };
  organizationId: string;
  memberRole: string;
};

/** Authenticated user without organization scope (Cloud / system routes). */
export type SessionUserContext = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  session: { id: string };
};

function orgIdFromParams(params: unknown): string {
  if (
    typeof params === "object" &&
    params !== null &&
    "orgId" in params &&
    typeof (params as { orgId: unknown }).orgId === "string"
  ) {
    return (params as { orgId: string }).orgId;
  }
  return "";
}

function orgIdFromPath(url: string): string {
  const match = new URL(url).pathname.match(/\/organizations\/([^/?#]+)/);
  return match?.[1] ?? "";
}

export async function resolveOrgContext(
  headers: Headers,
  orgIdParam: string,
): Promise<AuthContext | null> {
  const sessionResult = await auth.api.getSession({ headers });
  if (!sessionResult?.user || !sessionResult.session) {
    return null;
  }

  const organizationId =
    orgIdParam ||
    headers.get("x-organization-id") ||
    sessionResult.session.activeOrganizationId ||
    "";
  if (!organizationId) {
    return null;
  }

  let memberRole: string | undefined;
  try {
    if (sessionResult.session.activeOrganizationId === organizationId) {
      const member = await auth.api.getActiveMember({ headers });
      if (member && member.organizationId === organizationId) {
        memberRole = member.role;
      }
    }
  } catch {
    // Fall through to getFullOrganization.
  }

  if (!memberRole) {
    try {
      const organization = await auth.api.getFullOrganization({
        headers,
        query: { organizationId },
      });
      if (!organization) return null;
      const deletedAt = (organization as { deletedAt?: Date | string | null })
        .deletedAt;
      if (deletedAt) return null;
      memberRole = organization.members?.find(
        (member) => member.userId === sessionResult.user.id,
      )?.role;
    } catch {
      return null;
    }
  }

  if (!memberRole) {
    return null;
  }

  return {
    user: {
      id: sessionResult.user.id,
      name: sessionResult.user.name,
      email: sessionResult.user.email,
    },
    session: {
      id: sessionResult.session.id,
      activeOrganizationId: organizationId,
    },
    organizationId,
    memberRole,
  };
}

export const requireAuth = new Elysia({ name: "require-auth" })
  .derive({ as: "scoped" }, async ({ request, params }) => {
    const orgId = orgIdFromParams(params) || orgIdFromPath(request.url) || "";
    const authContext = await resolveOrgContext(request.headers, orgId);
    return { authContext };
  })
  .onBeforeHandle({ as: "scoped" }, ({ authContext }) => {
    if (!authContext) {
      return unauthorized();
    }
  });

export const sessionPlugin = new Elysia({ name: "session" }).derive(
  { as: "scoped" },
  async ({ request, params }) => {
    const orgId = orgIdFromParams(params) || orgIdFromPath(request.url) || "";
    const authContext = await resolveOrgContext(request.headers, orgId);
    return { authContext };
  },
);

export async function resolveSessionUser(
  headers: Headers,
): Promise<SessionUserContext | null> {
  const sessionResult = await auth.api.getSession({ headers });
  if (!sessionResult?.user || !sessionResult.session) {
    return null;
  }

  return {
    user: {
      id: sessionResult.user.id,
      name: sessionResult.user.name,
      email: sessionResult.user.email,
    },
    session: { id: sessionResult.session.id },
  };
}

export const sessionUserPlugin = new Elysia({ name: "session-user" }).derive(
  { as: "scoped" },
  async ({ request }) => {
    const sessionUser = await resolveSessionUser(request.headers);
    return { sessionUser };
  },
);

export function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function forbidden() {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export function badRequest(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export function notFound(message = "Not found") {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

export function conflict(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
}
