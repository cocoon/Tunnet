"use client";

import { motion } from "motion/react";
import type * as React from "react";
import { cn } from "#lib/utils";

export interface HoverFeatureCard {
  name: string;
  description: string;
  href?: string;
  img?: string;
  imgLight?: string;
  imgClassName?: string;
  imgWidth?: number;
  containerClassName?: string;
  fadeBottom?: boolean;
  soon?: boolean;
}

export interface HoverFeatureCardsProps {
  items: HoverFeatureCard[];
  className?: string;
  renderLink?: (href: string, children: React.ReactNode) => React.ReactNode;
}

function HoverFeatureCard({
  item,
  renderLink,
}: {
  item: HoverFeatureCard;
  renderLink?: HoverFeatureCardsProps["renderLink"];
}) {
  const hasImage = Boolean(item.img || item.imgLight);
  const darkSrc = item.img ?? item.imgLight;
  const lightSrc = item.imgLight ?? item.img;
  const dualTheme = Boolean(item.img && item.imgLight);

  const inner = (
    <motion.div
      initial="rest"
      whileHover="hover"
      animate="rest"
      whileTap={{ scale: item.href && !item.soon ? 0.97 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      variants={{ rest: { scale: 1, y: 0 } }}
      className={cn(
        "group relative flex w-full flex-col",
        item.soon
          ? "cursor-not-allowed opacity-80"
          : item.href
            ? "cursor-pointer"
            : "",
      )}
    >
      <div
        className={cn(
          "relative z-5 flex h-64 w-full flex-col overflow-hidden rounded-3xl border transition-colors",
          hasImage ? "bg-transparent" : "bg-[var(--surface,var(--card))]",
          !item.soon && item.href ? "hover:border-border/80" : "",
          item.soon ? "border-dashed border-border" : "border-border",
        )}
      >
        {item.soon ? (
          <span className="absolute top-3 right-3 z-20 rounded-full border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
            Coming soon
          </span>
        ) : null}

        {hasImage ? (
          <>
            {dualTheme ? (
              <>
                <img
                  src={darkSrc}
                  alt=""
                  aria-hidden
                  width={item.imgWidth ?? 800}
                  height={item.imgWidth ?? 800}
                  className={cn(
                    "absolute inset-0 hidden size-full object-cover dark:block",
                    item.imgClassName,
                  )}
                />
                <img
                  src={lightSrc}
                  alt=""
                  aria-hidden
                  width={item.imgWidth ?? 800}
                  height={item.imgWidth ?? 800}
                  className={cn(
                    "absolute inset-0 size-full object-cover dark:hidden",
                    item.imgClassName,
                  )}
                />
              </>
            ) : (
              <img
                src={darkSrc}
                alt=""
                aria-hidden
                width={item.imgWidth ?? 800}
                height={item.imgWidth ?? 800}
                className={cn(
                  "absolute inset-0 size-full object-cover",
                  item.imgClassName,
                )}
              />
            )}

            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/40"
            />
            {item.fadeBottom ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 to-transparent"
              />
            ) : null}

            <div
              className={cn(
                "relative z-10 flex h-full flex-col justify-end px-5 pt-6 pb-5",
                item.containerClassName,
              )}
            >
              <span
                className={cn(
                  "text-xl font-medium tracking-tight text-white drop-shadow-sm",
                  item.soon && "text-white/70",
                )}
              >
                {item.name}
              </span>
            </div>
          </>
        ) : (
          <div
            className={cn(
              "relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-t-3xl bg-muted/20 px-5 pt-6 pb-4",
              item.containerClassName,
            )}
          >
            <span
              className={cn(
                "text-xl font-medium tracking-tight",
                item.soon ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {item.name}
            </span>
          </div>
        )}
      </div>

      <motion.div
        variants={{
          rest: { opacity: 0.72, y: -12 },
          hover: { opacity: 1, y: 0 },
        }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="z-1 w-11/12 self-center overflow-hidden"
      >
        <div className="relative rounded-b-3xl border border-t-0 border-border bg-card/80 px-5 py-3 backdrop-blur-sm">
          <div className="pointer-events-none absolute -top-1 -left-1 h-12 w-[103%] bg-gradient-to-b from-background to-transparent" />
          <p className="relative text-sm font-base text-muted-foreground">
            {item.description}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );

  if (item.href && renderLink) {
    return renderLink(item.href, inner);
  }

  return inner;
}

function HoverFeatureCards({
  items,
  className,
  renderLink,
}: HoverFeatureCardsProps) {
  return (
    <div
      className={cn("grid w-full grid-cols-1 gap-4 sm:grid-cols-2", className)}
    >
      {items.map((item) => (
        <HoverFeatureCard key={item.name} item={item} renderLink={renderLink} />
      ))}
    </div>
  );
}

export { HoverFeatureCard, HoverFeatureCards };
