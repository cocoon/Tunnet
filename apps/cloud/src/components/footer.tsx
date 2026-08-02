import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { FaDiscord, FaGithub, FaXTwitter, FaYoutube } from "react-icons/fa6";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Mesh", href: "#mesh" },
      { label: "Modes", href: "#modes" },
      { label: "Edge", href: "#edge" },
      { label: "Security", href: "#security" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: "https://docs.tunnet.io", external: true },
      {
        label: "GitHub",
        href: "https://github.com/tunnetio/Tunnet",
        external: true,
      },
      {
        label: "Discord",
        href: "https://discord.gg/y5bNc3MYKz",
        external: true,
      },
      { label: "Status", href: "https://status.tunnet.io", external: true },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "Careers", href: "/careers" },
      { label: "Contact", href: "mailto:hello@tunnet.io", external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Terms", href: "/legal/terms" },
      {
        label: "Licenses",
        href: "https://github.com/tunnetio/Tunnet/blob/main/LICENSING.md",
        external: true,
      },
      {
        label: "CLA",
        href: "https://github.com/tunnetio/Tunnet/blob/main/CLA.md",
        external: true,
      },
    ],
  },
];

export function MarketingFooter(): ReactNode {
  return (
    <footer className="relative isolate overflow-hidden border-t border-[var(--l1-steel)] bg-[var(--l1-bg-2)] text-[var(--l1-muted)]">
      <div
        aria-hidden
        className="p-brushed pointer-events-none absolute inset-0 -z-10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[min(50vh,420px)] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 60% 65% at 50% 100%, oklch(0.6_0.115_50/0.16), transparent 60%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1200px] px-5 pt-20 pb-10 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_2fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5">
              <img alt="Tunnet" src="/logo.png" className="size-8" />
              <span className="l1-engraved font-display text-[19px] font-bold uppercase tracking-[0.08em] text-[var(--l1-fg)]">
                Tunnet
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--l1-muted)]">
              Zero-trust mesh networking for teams that move fast. Six
              primitives, one identity, fully open source.
            </p>

            <div className="mt-6 flex items-center gap-2.5 text-[var(--l1-muted)]">
              {[
                {
                  Icon: FaGithub,
                  href: "https://github.com/tunnetio/Tunnet",
                  label: "GitHub",
                },
                {
                  Icon: FaDiscord,
                  href: "https://discord.gg/y5bNc3MYKz",
                  label: "Discord",
                },
                {
                  Icon: FaXTwitter,
                  href: "https://x.com/tunnetio",
                  label: "X",
                },
                {
                  Icon: FaYoutube,
                  href: "https://youtube.com/@tunnet",
                  label: "YouTube",
                },
              ].map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="group grid size-9 place-items-center rounded-full border border-[var(--l1-steel)] bg-[var(--l1-panel)] transition-colors hover:border-[oklch(0.75_0.115_58/0.5)]"
                >
                  <Icon className="size-4 transition-colors group-hover:text-[var(--l1-copper)]" />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="l1-label text-[var(--l1-muted-2)]">{col.title}</p>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {"external" in l && l.external ? (
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noreferrer"
                          className="transition-colors hover:text-[var(--l1-fg)]"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <a
                          href={l.href}
                          className="transition-colors hover:text-[var(--l1-fg)]"
                        >
                          {l.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="p-hairline mt-16" />
        <div className="mt-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="l1-readout text-[var(--l1-muted-2)]">
            © {new Date().getFullYear()} Tunnet · open source by component
          </p>
        </div>
      </div>
    </footer>
  );
}
