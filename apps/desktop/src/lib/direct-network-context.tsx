import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useApp } from "../lib/app-context";
import type { NetworkSummary } from "../lib/types";

interface DirectNetworkContextValue {
  networks: NetworkSummary[];
  networkId: string;
  setNetworkId: (id: string) => void;
  activeNetwork: NetworkSummary | undefined;
}

const DirectNetworkContext = createContext<DirectNetworkContextValue | null>(
  null,
);

export function DirectNetworkProvider({ children }: { children: ReactNode }) {
  const { node } = useApp();
  const [networkId, setNetworkId] = useState("");

  const networks = useMemo(
    () => node?.networks.filter((n) => n.mode === "direct") ?? [],
    [node],
  );

  const activeNetwork =
    networks.find((n) => n.network_id === networkId) ?? networks[0];

  useEffect(() => {
    if (networks[0] && !networkId) {
      setNetworkId(networks[0].network_id);
    }
  }, [networks, networkId]);

  const value = useMemo(
    () => ({
      networks,
      networkId: activeNetwork?.network_id ?? "",
      setNetworkId,
      activeNetwork,
    }),
    [networks, activeNetwork],
  );

  return (
    <DirectNetworkContext.Provider value={value}>
      {children}
    </DirectNetworkContext.Provider>
  );
}

export function useDirectNetwork() {
  const ctx = useContext(DirectNetworkContext);
  if (!ctx) {
    throw new Error(
      "useDirectNetwork must be used within DirectNetworkProvider",
    );
  }
  return ctx;
}

export function useDirectNetworkId() {
  return useDirectNetwork().networkId;
}
