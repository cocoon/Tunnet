import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/kubernetes/networks/$networkId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/networks/$networkId",
      params: { networkId: params.networkId },
      search: { kind: "k8s" },
    });
  },
});
