import { Link } from "@tanstack/react-router";
import { cn } from "@tunnet/ui/lib/utils";
import { ArrowRightIcon, MenuIcon, XIcon } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from "motion/react";
import { type ReactNode, useRef, useState } from "react";

const APP_URL = "https://app.tunnet.io";

const HOME_LINKS = [
  { label: "Mesh", href: "#mesh" },
  { label: "Modes", href: "#modes" },
  { label: "Relays", href: "#relay" },
  { label: "Security", href: "#security" },
  { label: "CLI", href: "#cli" },
  { label: "Pricing", href: "/pricing" },
  { label: "Download", href: "/download" },
  { label: "Docs", href: "https://docs.tunnet.io", external: true },
] as const;

const PRICING_LINKS = [
  { label: "Plans", href: "#plans" },
  { label: "Calculator", href: "#calculator" },
  { label: "Compare", href: "#compare" },
  { label: "FAQ", href: "#faq" },
  { label: "Home", href: "/" },
  { label: "Download", href: "/download" },
  { label: "Docs", href: "https://docs.tunnet.io", external: true },
] as const;

const DOWNLOAD_LINKS = [
  { label: "Install", href: "#install" },
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "https://docs.tunnet.io", external: true },
] as const;

export function MarketingNav({
  variant = "home",
}: {
  variant?: "home" | "pricing" | "download";
}): ReactNode {
  const NAV_LINKS =
    variant === "pricing"
      ? PRICING_LINKS
      : variant === "download"
        ? DOWNLOAD_LINKS
        : HOME_LINKS;
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const lastY = useRef(0);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 8);
    const delta = y - lastY.current;
    if (y > 140 && delta > 3) setHidden(true);
    else if (delta < -3 || y < 140) setHidden(false);
    lastY.current = y;
  });

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out",
        hidden && "-translate-y-full",
        scrolled
          ? "border-b border-[var(--l1-steel)] bg-[oklch(0.128_0.007_258/0.85)] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto grid h-16 max-w-[1200px] grid-cols-[auto_1fr_auto] items-center gap-4 px-5 sm:px-8">
        <Link to="/" className="group inline-flex items-center gap-2.5">
          <img alt="Tunnet" src="/logo.png" className="size-8" />
          <span className="l1-engraved font-display text-[19px] font-bold uppercase tracking-[0.08em] text-[var(--l1-fg)]">
            Tunnet
          </span>
        </Link>

        <nav className="hidden justify-center lg:flex" aria-label="Primary">
          <div className="flex items-center gap-0.5 rounded-full border border-[var(--l1-steel)] bg-[var(--l1-panel)]/60 p-1 backdrop-blur">
            {NAV_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                {...("external" in item && item.external
                  ? { target: "_blank", rel: "noreferrer" }
                  : {})}
                className="rounded-full px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--l1-muted)] transition-colors hover:text-[var(--l1-copper)]"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="flex items-center gap-2">
          <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
            <a
              href={APP_URL}
              className="l1-btn l1-btn--copper h-9 !px-4 !text-[12.5px]"
            >
              Get started
              <ArrowRightIcon className="size-3.5" />
            </a>
          </motion.div>

          <button
            type="button"
            className="grid size-9 place-items-center rounded-[10px] border border-[var(--l1-steel-strong)] bg-[var(--l1-panel)] text-[var(--l1-fg-dim)] lg:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <XIcon className="size-4" />
            ) : (
              <MenuIcon className="size-4" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-[var(--l1-steel)] bg-[var(--l1-bg)] lg:hidden"
          >
            <div className="flex flex-col gap-1 px-5 py-4">
              {NAV_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  {...("external" in item && item.external
                    ? { target: "_blank", rel: "noreferrer" }
                    : {})}
                  className="rounded-xl px-3 py-2.5 text-[13px] font-medium text-[var(--l1-fg-dim)]"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ))}
              <a
                href={APP_URL}
                className="rounded-xl px-3 py-2.5 text-[13px] font-medium text-[var(--l1-muted)]"
                onClick={() => setOpen(false)}
              >
                Sign in
              </a>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
