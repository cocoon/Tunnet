import { createFileRoute } from "@tanstack/react-router";

import { DownloadPage } from "#/components/download/download-page";

export const Route = createFileRoute("/download")({
  component: DownloadPage,
  head: () => ({
    meta: [
      {
        title: "Download - Tunnet",
      },
      {
        name: "description",
        content:
          "Install Tunnet on Windows, Linux or macOS. One command installs the CLI, daemon and service; a desktop app is available for Windows.",
      },
      {
        property: "og:title",
        content: "Download Tunnet",
      },
      {
        property: "og:description",
        content:
          "Install the Tunnet agent on every laptop, server and CI runner. One agent, one identity, fully self-hostable.",
      },
    ],
  }),
});
