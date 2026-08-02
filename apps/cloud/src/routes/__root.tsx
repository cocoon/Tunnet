import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Tunnet - Private networking for every team",
      },
      {
        name: "description",
        content:
          "Open-source zero-trust mesh networking. Mesh, serve, tunnel, send, SSH and edge - six primitives, one identity, fully self-hostable.",
      },
      {
        name: "theme-color",
        content: "#16181d",
      },
      {
        property: "og:title",
        content: "Tunnet - Private networking for every team",
      },
      {
        property: "og:description",
        content: "The network is the network. Everything else just works.",
      },
      {
        property: "og:type",
        content: "website",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {/*
          TUNNET · LAYER-1 · DESIGN CONTRACT
          THESIS: The network is the network - this page is built inside the
          physical network. It refuses the dark+neon AI default and the clean
          pastel SaaS clone; it is the front of a real piece of gear.
          OWN-WORLD: obsidian graphite chassis, brushed steel plates, warm
          copper traces, phosphor status lamps, engraved instrument lettering
          (Barlow Condensed display, Geist body, Geist Mono readouts).
          STORY: a visitor lands inside their own network - packets flowing,
          lamps lit, a console they recognize from the machines they already run.
          FIRST VIEWPORT: engraved headline over a live mesh console - a front
          plate with an animated copper-trace topology, status lamps and a
          ticking readout strip, with the install command in a recessed bezel.
          FORM: Layer-1 hardware materiality; scroll-driven cinema with GSAP
          ScrollTrigger, Lenis smooth scroll, packet-flow traces.
          FINISH: unreviewed and undocumented is unfinished; this build ends
          with the finish review, the verdict, and DESIGN.md.
        */}
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
