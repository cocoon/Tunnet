import { ipv4CidrSchema } from "@tunnet/ip";
import { z } from "zod";

import { networkSettingsSchema, remoteAgentPolicySchema } from "./org-settings";

const networkNameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9-]+$/);

export const networkDefaultActionSchema = z.enum(["allow", "deny"]);
export const networkIcmpPolicySchema = z.enum(["allow", "acl", "deny"]);

export const networkSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: networkNameSchema,
  cidr: z.string(),
  mtu: z.number().int().min(576).max(9000),
  defaultAction: networkDefaultActionSchema,
  icmpPolicy: networkIcmpPolicySchema,
  version: z.number().int().nonnegative(),
  settings: networkSettingsSchema,
  createdAt: z.string().datetime(),
});

export const createNetworkBody = z.object({
  name: networkNameSchema,
  cidr: ipv4CidrSchema,
  mtu: z.number().int().min(576).max(9000).default(1280),
  defaultAction: networkDefaultActionSchema.default("allow"),
  icmpPolicy: networkIcmpPolicySchema.default("allow"),
});

export const patchNetworkBody = z.object({
  name: networkNameSchema.optional(),
  cidr: ipv4CidrSchema.optional(),
  mtu: z.number().int().min(576).max(9000).optional(),
  defaultAction: networkDefaultActionSchema.optional(),
  icmpPolicy: networkIcmpPolicySchema.optional(),
  settings: z
    .object({
      agentPolicy: remoteAgentPolicySchema.partial().optional(),
    })
    .optional(),
});

export const networkListResponse = z.object({
  networks: z.array(networkSchema),
});

export type Network = z.infer<typeof networkSchema>;
export type CreateNetworkBody = z.input<typeof createNetworkBody>;
export type PatchNetworkBody = z.input<typeof patchNetworkBody>;
