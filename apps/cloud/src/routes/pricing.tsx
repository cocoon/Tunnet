import { createFileRoute } from "@tanstack/react-router";

import { PricingPage } from "#/components/pricing/pricing-page";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      {
        title: "Pricing - Tunnet",
      },
      {
        name: "description",
        content:
          "Tunnet pricing. Free forever for direct mode; managed plans from $5/month. No per-device tax, no egress fees.",
      },
      {
        property: "og:title",
        content: "Pricing - Tunnet",
      },
      {
        property: "og:description",
        content:
          "Free forever for direct mode. Managed plans from $5/month. No per-device tax, no egress fees.",
      },
    ],
  }),
});
