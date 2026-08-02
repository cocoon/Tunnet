import { Marquee } from "@tunnet/ui/components/marquee";
import type { ReactNode } from "react";
import {
  FaApple,
  FaAws,
  FaDocker,
  FaGithub,
  FaGoogle,
  FaLinux,
  FaWindows,
} from "react-icons/fa";
import {
  SiCloudflare,
  SiKubernetes,
  SiNixos,
  SiPostgresql,
  SiRust,
  SiTerraform,
} from "react-icons/si";

const PLATFORMS = [
  { icon: FaApple, label: "macOS" },
  { icon: FaLinux, label: "Linux" },
  { icon: FaWindows, label: "Windows" },
  { icon: FaDocker, label: "Docker" },
  { icon: SiKubernetes, label: "Kubernetes" },
  { icon: SiPostgresql, label: "Postgres" },
  { icon: FaGithub, label: "GitHub Actions" },
  { icon: SiTerraform, label: "Terraform" },
  { icon: FaAws, label: "AWS" },
  { icon: FaGoogle, label: "GCP" },
  { icon: SiCloudflare, label: "Cloudflare" },
  { icon: SiNixos, label: "NixOS" },
  { icon: SiRust, label: "Rust" },
] as const;

export function TrustMarquee(): ReactNode {
  return (
    <section className="relative border-y border-[var(--l1-steel)] bg-[var(--l1-bg-2)]/70 py-9">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 h-8 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,oklch(0.6_0.115_50/0.08),transparent)]"
      />
      <p className="mx-auto mb-7 flex max-w-[1160px] items-center justify-center px-5 text-center sm:px-8">
        <span className="l1-label text-[var(--l1-muted-2)]">
          Plugs into what you already run
        </span>
      </p>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-[linear-gradient(90deg,var(--l1-bg),transparent)]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-[linear-gradient(270deg,var(--l1-bg),transparent)]" />
        <Marquee pauseOnHover className="[--duration:40s] [--gap:0rem]">
          {PLATFORMS.map((p) => (
            <div
              key={p.label}
              className="flex items-center gap-2.5 border-r border-[var(--l1-steel)] px-8 text-[var(--l1-muted)] transition-colors hover:text-[var(--l1-copper)]"
            >
              <p.icon className="size-4" />
              <span className="l1-label !tracking-[0.16em]">{p.label}</span>
            </div>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
