import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "@tunnet/ui/components/badge";
import { Button } from "@tunnet/ui/components/button";
import { Input } from "@tunnet/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@tunnet/ui/components/input-group";
import { Label } from "@tunnet/ui/components/label";
import { Separator } from "@tunnet/ui/components/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tunnet/ui/components/tabs";
import {
  ArrowRightIcon,
  Building2Icon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { toast } from "sonner";

import { useFeature } from "@/hooks/use-entitlements";
import {
  authClient,
  markAuthenticatedTransition,
  signIn,
  signUp,
} from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

type AuthTab = "signin" | "signup" | "sso";
type LoadingAction = "signin" | "signup" | "sso" | null;

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const signupEnabled = useFeature("openSignUp");
  const [activeTab, setActiveTab] = useState<AuthTab>("signin");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void authClient.getSession().then(({ data }) => {
      if (!cancelled && data) {
        void navigate({ to: "/" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const showSignup = signupEnabled;

  function afterAuth() {
    markAuthenticatedTransition();
    if (redirectTo) {
      void navigate({ to: redirectTo as "/" });
      return;
    }
    void navigate({ to: "/" });
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoadingAction("signin");
    const { error } = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoadingAction(null);
    if (error) {
      toast.error(error.message ?? "Sign in failed");
      return;
    }
    afterAuth();
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoadingAction("signup");
    const { error } = await signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoadingAction(null);
    if (error) {
      toast.error(error.message ?? "Registration failed");
      return;
    }
    afterAuth();
  }

  async function handleSso(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("sso-email") ?? "").trim();
    const domain = String(form.get("sso-domain") ?? "").trim();
    if (!email && !domain) {
      toast.error("Enter an email or domain for SSO");
      return;
    }

    setLoadingAction("sso");
    const { error, data } = await authClient.signIn.sso({
      ...(email ? { email } : {}),
      ...(domain ? { domain } : {}),
      callbackURL: redirectTo || `${window.location.origin}/`,
    });
    setLoadingAction(null);
    if (error) {
      toast.error(error.message ?? "SSO sign-in failed");
      return;
    }
    if (data && typeof data === "object" && "url" in data && data.url) {
      markAuthenticatedTransition();
      window.location.href = String(data.url);
    }
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <PageBackdrop />
      <div className="relative mx-auto flex min-h-svh w-full max-w-[1440px] items-center p-3 sm:p-6 lg:p-10">
        <div className="grid min-h-[720px] w-full overflow-hidden rounded-[2rem] border border-border/80 bg-card shadow-2xl shadow-foreground/10 lg:grid-cols-[minmax(0,1fr)_minmax(480px,560px)]">
          <BrandPanel />
          <section className="flex min-h-[720px] flex-col bg-card">
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-8 sm:px-10 sm:py-12 lg:px-12 lg:py-14">
              <Header />
              <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as AuthTab)}
                className="mt-8"
              >
                <TabsList className="grid h-11 w-full grid-cols-3 bg-muted/70 p-1">
                  <TabsTrigger value="signin">Sign in</TabsTrigger>
                  <TabsTrigger value="signup" disabled={!showSignup}>
                    Sign up
                  </TabsTrigger>
                  <TabsTrigger value="sso">SSO</TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="mt-6">
                  <OAuthActions />
                  <AuthDivider />
                  <SignInForm
                    loading={loadingAction === "signin"}
                    showPassword={showPassword}
                    onTogglePassword={() =>
                      setShowPassword((current) => !current)
                    }
                    onSubmit={(event) => void handleSignIn(event)}
                  />
                  {showSignup ? (
                    <p className="mt-6 text-center text-sm text-muted-foreground">
                      New to Tunnet?{" "}
                      <button
                        type="button"
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                        onClick={() => setActiveTab("signup")}
                      >
                        Create an account
                      </button>
                    </p>
                  ) : null}
                </TabsContent>

                <TabsContent value="sso" className="mt-6">
                  <SsoForm
                    loading={loadingAction === "sso"}
                    onSubmit={(event) => void handleSso(event)}
                  />
                </TabsContent>

                {showSignup ? (
                  <TabsContent value="signup" className="mt-6">
                    <SignUpForm
                      loading={loadingAction === "signup"}
                      onSubmit={(event) => void handleSignUp(event)}
                    />
                    <p className="mt-6 text-center text-sm text-muted-foreground">
                      Already have an account?{" "}
                      <button
                        type="button"
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                        onClick={() => setActiveTab("signin")}
                      >
                        Sign in
                      </button>
                    </p>
                  </TabsContent>
                ) : null}
              </Tabs>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function PageBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{
        background:
          "radial-gradient(55% 55% at 8% 8%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 72%), radial-gradient(45% 50% at 92% 94%, color-mix(in srgb, var(--foreground) 7%, transparent), transparent 70%)",
      }}
    />
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#0a0a0c] lg:flex lg:flex-col lg:justify-between">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(120,160,255,0.32),transparent_28%),radial-gradient(circle_at_78%_32%,rgba(210,110,255,0.22),transparent_25%),radial-gradient(circle_at_60%_90%,rgba(70,220,190,0.16),transparent_30%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
      />
      <div
        aria-hidden="true"
        className="absolute -inset-32 animate-[spin_34s_linear_infinite] rounded-full bg-[conic-gradient(from_180deg_at_50%_50%,transparent_0deg,rgba(130,150,255,0.2)_70deg,transparent_150deg,rgba(235,140,255,0.18)_250deg,transparent_330deg)] blur-3xl"
      />
      <div className="relative flex items-start justify-between p-10 xl:p-12">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-xs font-medium text-white/60 transition-colors hover:text-white"
        >
          <span className="flex size-8 items-center justify-center rounded-xl border border-white/15 bg-white/8 p-1.5 shadow-lg shadow-black/20 backdrop-blur">
            <img
              src="/logo.png"
              alt="Tunnet"
              className="size-full object-contain"
            />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.24em]">
            Tunnet
          </span>
        </a>
      </div>
      <div className="relative p-10 xl:p-12">
        <h2 className="max-w-lg font-heading text-5xl font-semibold leading-[0.92] tracking-tight text-white xl:text-6xl">
          Your network,
          <br />
          <span className="text-white/45">in your hands.</span>
        </h2>
        <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/60">
          Connect machines, manage private networks, and keep every route under
          control from one calm workspace.
        </p>
        <div className="mt-10 grid max-w-md grid-cols-2 gap-3 text-xs text-white/65">
          <Feature icon={<ShieldCheckIcon />} label="Private by design" />
          <Feature icon={<KeyRoundIcon />} label="Identity-aware access" />
          <Feature icon={<Building2Icon />} label="Built for teams" />
          <Feature icon={<LockKeyholeIcon />} label="Encrypted connections" />
        </div>
      </div>
    </aside>
  );
}

function Header() {
  return (
    <header>
      <div className="flex items-center gap-3 lg:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-foreground p-1.5">
          <img
            src="/logo.png"
            alt="Tunnet"
            className="size-full object-contain"
          />
        </span>
        <span className="font-heading text-lg font-semibold tracking-tight">
          Tunnet
        </span>
      </div>
      <div className="mt-7 flex items-end justify-between gap-4 lg:mt-0">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
            Let&apos;s get connected
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Sign in to manage your networks and machines, or create a new
            workspace.
          </p>
        </div>
      </div>
    </header>
  );
}

function OAuthActions() {
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled
        className="relative h-11 w-full justify-center gap-3 bg-background"
      >
        <FcGoogle />
        <span>Continue with Google</span>
        <Badge
          variant="secondary"
          className="absolute right-2 text-[9px] uppercase tracking-wider"
        >
          Soon
        </Badge>
      </Button>
    </div>
  );
}

function AuthDivider() {
  return (
    <div className="my-7 flex items-center gap-3" aria-hidden="true">
      <Separator className="flex-1" />
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        or use email
      </span>
      <Separator className="flex-1" />
    </div>
  );
}

function SignInForm({
  loading,
  showPassword,
  onTogglePassword,
  onSubmit,
}: {
  loading: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <Field label="Email" htmlFor="signin-email" hint="Required">
        <Input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          size="lg"
        />
      </Field>
      <Field label="Password" htmlFor="signin-password" hint="Required">
        <InputGroup className="h-10">
          <InputGroupInput
            id="signin-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="Enter your password"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={onTogglePassword}
              className="text-muted-foreground hover:text-foreground"
            >
              {showPassword ? (
                <EyeOffIcon aria-hidden="true" />
              ) : (
                <EyeIcon aria-hidden="true" />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <button
          type="button"
          className="font-medium text-foreground underline-offset-4 hover:underline"
          onClick={() =>
            toast.info("Password recovery will be available soon.")
          }
        >
          Forgot password?
        </button>
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={loading}
        className="mt-1 h-11 w-full justify-between px-4"
      >
        <span>{loading ? "Signing in..." : "Sign in to Tunnet"}</span>
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    </form>
  );
}

function SignUpForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <Field label="Your name" htmlFor="signup-name">
        <Input
          id="signup-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          placeholder="Alex Morgan"
          size="lg"
        />
      </Field>
      <Field label="Email" htmlFor="signup-email">
        <Input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          size="lg"
        />
      </Field>
      <Field
        label="Password"
        htmlFor="signup-password"
        hint="At least 8 characters"
      >
        <Input
          id="signup-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Create a password"
          size="lg"
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        disabled={loading}
        className="mt-1 h-11 w-full justify-between px-4"
      >
        <span>{loading ? "Creating account..." : "Create your account"}</span>
        <ArrowRightIcon aria-hidden="true" />
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        By continuing, you agree to Tunnet&apos;s terms and privacy policy.
      </p>
    </form>
  );
}

function SsoForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <div className="rounded-2xl border border-border bg-muted/45 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-sm">
            <Building2Icon aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">
              Sign in with your organization
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Use your work email or organization domain to continue through its
              identity provider.
            </p>
          </div>
        </div>
      </div>
      <Field label="Work email" htmlFor="sso-email" hint="Recommended">
        <Input
          id="sso-email"
          name="sso-email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          size="lg"
        />
      </Field>
      <div className="relative flex items-center gap-3" aria-hidden="true">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>
      <Field
        label="Organization domain"
        htmlFor="sso-domain"
        hint="Example: company.com"
      >
        <Input
          id="sso-domain"
          name="sso-domain"
          type="text"
          placeholder="company.com"
          size="lg"
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        disabled={loading}
        className="mt-1 h-11 w-full justify-between px-4"
      >
        <span>{loading ? "Redirecting..." : "Continue with SSO"}</span>
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? (
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Feature({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/6 px-3 py-2.5 backdrop-blur-sm">
      <span className="text-white/70 [&_svg]:size-3.5">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
