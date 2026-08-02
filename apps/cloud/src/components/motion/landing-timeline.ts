import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

export function registerMarketingMotion() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

export const easeOutExpo = "expo.out";
export const easeOutQuart = "power3.out";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function revealFrom(
  targets: gsap.TweenTarget,
  trigger: Element | string,
  extras: gsap.TweenVars = {},
) {
  if (prefersReducedMotion()) {
    gsap.set(targets, { clearProps: "all", opacity: 1, y: 0 });
    return;
  }
  gsap.from(targets, {
    opacity: 0,
    y: 20,
    duration: 0.85,
    stagger: 0.08,
    ease: easeOutQuart,
    scrollTrigger: {
      trigger,
      start: "top 82%",
      toggleActions: "play none none none",
    },
    ...extras,
  });
}

/** Reveal `.l1-reveal` children as they enter the viewport.
 * Hidden state is applied by GSAP (not CSS) so content is never blank if
 * ScrollTrigger fails to run. Any error here degrades to fully-visible. */
export function setupReveals(root: Element) {
  const items = root.querySelectorAll<HTMLElement>(".l1-reveal");
  if (!items.length || prefersReducedMotion()) return;
  try {
    gsap.set(items, { opacity: 0, y: 18, filter: "blur(6px)" });
    ScrollTrigger.batch(items, {
      start: "top 88%",
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.85,
          stagger: 0.09,
          ease: easeOutQuart,
          overwrite: true,
        }),
    });
  } catch {
    gsap.set(items, { clearProps: "opacity,transform,filter" });
  }
}

/** Scroll-progress scrub of a value through a section. */
export function scrubTo(
  trigger: Element | string,
  vars: gsap.TweenVars,
  fromTo: [gsap.TweenVars, gsap.TweenVars],
) {
  if (prefersReducedMotion()) return;
  return gsap.fromTo(trigger, fromTo[0], {
    ...fromTo[1],
    ease: "none",
    scrollTrigger: {
      trigger,
      start: "top bottom",
      end: "bottom top",
      scrub: 0.6,
    },
    ...vars,
  });
}
