import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import {
  prefersReducedMotion,
  registerMarketingMotion,
} from "#/components/motion/landing-timeline";

let lenis: Lenis | null = null;

export function initSmoothScroll(): () => void {
  registerMarketingMotion();
  if (prefersReducedMotion() || typeof window === "undefined" || lenis)
    return () => {};
  lenis = new Lenis({ duration: 1.15, anchors: true });
  lenis.on("scroll", ScrollTrigger.update);
  const raf = (time: number) => lenis?.raf(time * 1000);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);
  // Re-measure triggers once fonts/layout settle and on window load.
  const onLoad = () => ScrollTrigger.refresh();
  window.addEventListener("load", onLoad);
  const onFonts = () => ScrollTrigger.refresh();
  if (document.fonts?.ready) void document.fonts.ready.then(onFonts);
  return () => {
    window.removeEventListener("load", onLoad);
    gsap.ticker.remove(raf);
    lenis?.destroy();
    lenis = null;
  };
}

export function scrollToId(id: string, offset = -88) {
  if (lenis) {
    lenis.scrollTo(`#${id}`, { offset });
    return;
  }
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
