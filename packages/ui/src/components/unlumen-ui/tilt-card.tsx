"use client";

import type * as React from "react";
import { ClippedCircle } from "#components/unlumen-ui/clipped-circle";
import { Tilt, type TiltProps } from "#components/unlumen-ui/tilt";
import { cn } from "#lib/utils";

export interface TiltCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** left half of the split badge pill; shown as a simple pill if `badgeLabel` is omitted */
  price?: string;
  /** right half of the split pill, coloured by `badgeVariant` */
  badgeLabel?: string;
  badgeVariant?: "success" | "warning";
  imageSrc?: string;
  imageAlt?: string;
  /** wraps the card in a plain `<a>` tag */
  href?: string;
  children?: React.ReactNode;
  tiltProps?: Omit<TiltProps, "children" | "className">;
}

const BADGE_LABEL_CLASSES: Record<
  NonNullable<TiltCardProps["badgeVariant"]>,
  string
> = {
  success: "bg-emerald-500/20 text-emerald-300",
  warning: "bg-amber-500/20 text-amber-200",
};

export function TiltCard({
  title,
  description,
  price,
  badgeLabel,
  badgeVariant = "success",
  imageSrc,
  imageAlt = "",
  href,
  children,
  tiltProps,
  className,
  ...props
}: TiltCardProps) {
  const inner = (
    <Tilt
      rotationFactor={11}
      {...tiltProps}
      className={cn(
        "relative group overflow-hidden",
        "bg-background border border-border rounded-lg",
        "flex flex-col gap-4",
        "h-48 sm:h-52 md:h-56 w-full",
        "hover:shadow-lg hover:scale-105 transition-all duration-400 ease-out",
        className,
      )}
    >
      <div className="relative z-20 flex flex-row transition-all duration-200 justify-between px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex flex-col gap-1 flex-1 mr-2">
          <h2 className="text-lg tracking-tight leading-tight font-medium text-foreground">
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
          {children && <div className="mt-2">{children}</div>}
        </div>

        {price && badgeLabel ? (
          <div className="inline-flex h-fit items-center text-sm whitespace-nowrap shrink-0">
            <span className="rounded-l-full bg-secondary text-secondary-foreground h-fit py-1 px-2.5 font-medium ring-1 ring-border">
              {price}
            </span>
            <span
              className={cn(
                "rounded-r-full text-sm h-fit py-1 px-2.5 font-medium",
                BADGE_LABEL_CLASSES[badgeVariant],
              )}
            >
              {badgeLabel}
            </span>
          </div>
        ) : price ? (
          <span className="h-fit rounded-full bg-secondary text-secondary-foreground px-3 py-1 text-sm font-medium whitespace-nowrap shrink-0 ring-1 ring-border">
            {price}
          </span>
        ) : null}
      </div>

      {imageSrc && (
        <img
          src={imageSrc}
          alt={imageAlt}
          width={288}
          height={224}
          loading="lazy"
          decoding="async"
          className={cn(
            "absolute z-10 top-27 w-72 -right-10",
            "rotate-[-5deg] border-border border rounded-md",
            "transition-transform duration-300 ease-out",
            "group-hover:-rotate-3 group-hover:-translate-y-1 group-hover:-translate-x-0.5",
          )}
        />
      )}

      <ClippedCircle circleClassName="bg-white/15" circleSize={800} />
    </Tilt>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block cursor-pointer"
        {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {inner}
      </a>
    );
  }

  return <div {...props}>{inner}</div>;
}
