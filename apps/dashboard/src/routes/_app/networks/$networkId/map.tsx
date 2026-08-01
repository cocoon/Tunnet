import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/networks/$networkId/map")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/networks/$networkId",
      params: { networkId: params.networkId },
    });
  },
});
