import { useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tunnet/ui/components/dropdown-menu";
import { useEffect, useState } from "react";
import { useTopologyUi } from "@/components/topology/TopologyProvider";

type MenuState = {
  x: number;
  y: number;
  endpointId?: string;
  networkId?: string;
  label: string;
  kind: "peer" | "network";
};

export function TopologyContextMenus({
  networkId,
}: {
  orgId: string;
  networkId?: string;
}) {
  const navigate = useNavigate();
  const { setSelected, setConnectIntent } = useTopologyUi();
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<MenuState>).detail;
      if (!detail) return;
      setMenu(detail);
    }
    window.addEventListener("tunnet-topology-context", onOpen);
    return () => window.removeEventListener("tunnet-topology-context", onOpen);
  }, []);

  if (!menu) return null;
  const endpointId = menu.endpointId;
  const menuNetworkId = menu.networkId;

  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) setMenu(null);
      }}
    >
      <DropdownMenuTrigger
        className="fixed size-0 opacity-0"
        style={{ left: menu.x, top: menu.y }}
      />
      <DropdownMenuContent className="w-48" align="start">
        {menu.kind === "peer" && endpointId ? (
          <>
            <DropdownMenuItem
              onClick={() =>
                setSelected({
                  kind: "topology",
                  node: {
                    id: endpointId,
                    kind: "machine",
                    label: menu.label,
                    endpointId,
                  },
                })
              }
            >
              View details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigate({
                  to: "/machines/$endpointId",
                  params: { endpointId },
                });
              }}
            >
              Open machine
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                setConnectIntent({
                  type: "serve",
                  endpointId,
                  networkId: networkId ?? menu.networkId ?? "",
                })
              }
            >
              Create serve
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                setConnectIntent({
                  type: "tunnel",
                  endpointId,
                  networkId: networkId ?? menu.networkId ?? "",
                })
              }
            >
              Create tunnel
            </DropdownMenuItem>
          </>
        ) : null}
        {menu.kind === "network" && menuNetworkId ? (
          <>
            <DropdownMenuItem
              onClick={() => {
                void navigate({
                  to: "/networks/$networkId",
                  params: { networkId: menuNetworkId },
                });
              }}
            >
              Open mesh
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigate({
                  to: "/networks/$networkId/access",
                  params: { networkId: menuNetworkId },
                });
              }}
            >
              View ACLs
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                setConnectIntent({
                  type: "enroll",
                  networkId: menuNetworkId,
                })
              }
            >
              Add peer
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function openTopologyContextMenu(
  event: React.MouseEvent,
  payload: {
    kind: "peer" | "network";
    label: string;
    endpointId?: string;
    networkId?: string;
  },
) {
  event.preventDefault();
  window.dispatchEvent(
    new CustomEvent("tunnet-topology-context", {
      detail: {
        x: event.clientX,
        y: event.clientY,
        ...payload,
      } satisfies MenuState,
    }),
  );
}
