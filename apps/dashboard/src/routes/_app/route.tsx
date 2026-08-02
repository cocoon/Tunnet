import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell } from "@/components/app/app-shell";
import {
  hasAuthenticatedTransition,
  useListOrganizations,
  useSession,
} from "@/lib/auth-client";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function useActiveOrgList() {
  const { data: organizationsRaw, isPending } = useListOrganizations();
  const organizations = (
    Array.isArray(organizationsRaw) ? organizationsRaw : []
  ).filter((org) => !(org as { deletedAt?: string | Date | null }).deletedAt);
  return { organizations, isPending };
}

function AppLayout() {
  const navigate = useNavigate();
  const { data: session, error, isPending } = useSession();
  const hasTransitionHint = hasAuthenticatedTransition();
  const { organizations, isPending: orgsPending } = useActiveOrgList();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isOnboarding = pathname === "/onboarding";

  useEffect(() => {
    if (
      isPending ||
      session ||
      pathname === "/login" ||
      (error && error.status !== 401)
    ) {
      return;
    }

    const redirect = `${pathname}${window.location.search}${window.location.hash}`;
    void navigate({
      to: "/login",
      search: { redirect },
      replace: true,
    });
  }, [error, isPending, navigate, pathname, session]);

  useEffect(() => {
    if (isPending || !session || orgsPending) return;
    if (organizations.length === 0 && !isOnboarding) {
      void navigate({ to: "/onboarding", replace: true });
    }
  }, [
    isOnboarding,
    isPending,
    navigate,
    organizations.length,
    orgsPending,
    session,
  ]);

  if (isPending && !session && !hasTransitionHint) {
    return <AuthBoundary />;
  }

  if (session && orgsPending && !isOnboarding) {
    return <AuthBoundary />;
  }

  if (session && organizations.length === 0 && !isOnboarding) {
    return <AuthBoundary />;
  }

  if (isOnboarding) {
    return <Outlet />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function AuthBoundary() {
  return <main className="min-h-svh bg-background" aria-busy="true" />;
}
