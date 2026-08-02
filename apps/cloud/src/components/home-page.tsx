import { type ReactNode, useEffect } from "react";
import "@/marketing.css";
import { MarketingFooter } from "#/components/footer";
import { initSmoothScroll } from "#/components/motion/smooth-scroll";
import { MarketingNav } from "#/components/nav";
import { AudienceQuotesSection } from "#/components/sections/audience-quotes";
import { CommandsTimelineSection } from "#/components/sections/commands-timeline";
import { FaqSection } from "#/components/sections/faq";
import { FinalCtaSection } from "#/components/sections/final-cta";
import { HeroSection } from "#/components/sections/hero";
import { OpenSourceSection } from "#/components/sections/open-source";
import { PricingTeaserSection } from "#/components/sections/pricing-teaser";
import { PrimitivesSection } from "#/components/sections/primitives";
import { RelayGlobeSection } from "#/components/sections/relay-globe";
import { SecuritySection } from "#/components/sections/security";
import { TrustMarquee } from "#/components/sections/trust-marquee";
import { TwoModesSection } from "#/components/sections/two-modes";

export function HomePage(): ReactNode {
  useEffect(() => {
    const cleanup = initSmoothScroll();
    return cleanup;
  }, []);

  return (
    <div className="marketing-root relative min-h-svh overflow-x-hidden bg-[var(--l1-bg)] text-[var(--l1-fg)]">
      <MarketingNav />
      <main>
        <HeroSection />
        <TrustMarquee />
        <PrimitivesSection />
        <TwoModesSection />
        <RelayGlobeSection />
        <SecuritySection />
        <CommandsTimelineSection />
        <OpenSourceSection />
        <AudienceQuotesSection />
        <PricingTeaserSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <MarketingFooter />
    </div>
  );
}
