import type { EdgeTypes, NodeTypes } from "@xyflow/react";

import {
  MeshEdge,
  PolicyEdge,
  SubnetRouteEdge,
} from "@/components/topology/edges";
import {
  AccessDestinationNode,
  AccessPolicyNode,
  AccessSourceNode,
  EdgeNode,
  EnrollNode,
  ExitNode,
  GatewayNode,
  HostnameNode,
  K8sNode,
  NetworkGroupNode,
  PeerNode,
  ServeNode,
  SubnetNode,
  TunnelNode,
} from "@/components/topology/nodes";

export const topologyNodeTypes = {
  networkGroup: NetworkGroupNode,
  peer: PeerNode,
  gateway: GatewayNode,
  k8s: K8sNode,
  edge: EdgeNode,
  subnet: SubnetNode,
  hostname: HostnameNode,
  exit: ExitNode,
  serve: ServeNode,
  tunnel: TunnelNode,
  enroll: EnrollNode,
  accessSource: AccessSourceNode,
  accessPolicy: AccessPolicyNode,
  accessDestination: AccessDestinationNode,
} satisfies NodeTypes;

export const topologyEdgeTypes = {
  mesh: MeshEdge,
  subnetRoute: SubnetRouteEdge,
  policy: PolicyEdge,
} satisfies EdgeTypes;
