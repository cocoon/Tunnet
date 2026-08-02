import { cn } from "@tunnet/ui/lib/utils";
import type { ReactNode } from "react";

const KEYWORDS = ["sudo", "curl", "irm", "iex", "docker", "compose"];
const TUNNET_VERBS = [
  "enroll",
  "service",
  "status",
  "ping",
  "dns",
  "route",
  "serve",
  "tunnel",
  "send",
  "ssh",
  "invite",
  "join",
  "create",
  "upgrade-to-managed",
  "update",
  "diag",
  "netcheck",
  "login",
  "firewall",
  "requests",
  "accept",
  "deny",
  "kick",
  "connect",
  "recordings",
  "play",
  "sessions",
  "off",
  "list",
  "add",
  "remove",
  "config",
  "up",
  "down",
  "edge",
  "register",
  "run",
];

function tokenize(line: string, lineId: number) {
  if (line.trim().startsWith("#"))
    return [{ id: `${lineId}-0`, text: line, kind: "cmt" as const }];
  const parts = line.split(/(\s+|"[^"]*"|'[^']*')/g).filter(Boolean);
  return parts.map((p, i) => {
    const kind = /^\s+$/.test(p)
      ? ("plain" as const)
      : /^["'].*["']$/.test(p)
        ? ("str" as const)
        : p.startsWith("--") || (p.startsWith("-") && p.length <= 3)
          ? ("flag" as const)
          : p === "|" || p === "&&" || p === "$" || p === "\\"
            ? ("op" as const)
            : KEYWORDS.includes(p)
              ? ("cmd" as const)
              : p === "tunnet" || p === "tunnet-edge"
                ? ("cmd" as const)
                : TUNNET_VERBS.includes(p)
                  ? ("verb" as const)
                  : ("plain" as const);
    return { id: `${lineId}-${i}`, text: p, kind };
  });
}

export function CodeBlock({
  code,
  className,
  showPrompt = true,
}: {
  code: string;
  className?: string;
  showPrompt?: boolean;
}): ReactNode {
  const lines = code.split("\n");
  return (
    <pre
      className={cn(
        "l1-scroll overflow-x-auto font-mono text-[13px] leading-[1.75] text-[var(--l1-fg-dim)]",
        className,
      )}
    >
      <code className="block">
        {lines.map((line, lineIndex) => {
          const isComment = line.trim().startsWith("#");
          return (
            <div key={line} className="flex">
              <span
                className={cn(
                  "mr-3 select-none",
                  showPrompt && !isComment
                    ? "text-[var(--l1-muted-2)]"
                    : "opacity-0",
                )}
              >
                $
              </span>
              <span>
                {tokenize(line, lineIndex).map((tok) => {
                  const cls =
                    tok.kind === "cmt"
                      ? "text-[var(--l1-muted-2)] italic"
                      : tok.kind === "cmd"
                        ? "text-[oklch(0.82_0.1_62)]"
                        : tok.kind === "verb"
                          ? "text-[oklch(0.79_0.12_150)]"
                          : tok.kind === "flag"
                            ? "text-[oklch(0.82_0.12_85)]"
                            : tok.kind === "str"
                              ? "text-[oklch(0.85_0.05_200)]"
                              : tok.kind === "op"
                                ? "text-[var(--l1-muted-2)]"
                                : "text-[var(--l1-fg-dim)]";
                  return (
                    <span key={tok.id} className={cls}>
                      {tok.text}
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </code>
    </pre>
  );
}
