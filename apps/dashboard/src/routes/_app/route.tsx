import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell } from "@/components/app/app-shell";
import { hasAuthenticatedTransition, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const { data: session, error, isPending } = useSession();
  const hasTransitionHint = hasAuthenticatedTransition();
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

  if (isPending && !session && !hasTransitionHint) {
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
