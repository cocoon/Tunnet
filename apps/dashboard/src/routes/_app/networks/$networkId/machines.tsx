import { createFileRoute, redirect } from "@tanstack/react-router";

/** Machines list lives on the Mesh overview. */
export const Route = createFileRoute("/_app/networks/$networkId/machines")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/networks/$networkId",
      params: { networkId: params.networkId },
    });
  },
});
