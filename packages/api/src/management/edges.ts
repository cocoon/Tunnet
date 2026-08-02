import { z } from "zod";

export const edgeStatusSchema = z.enum([
  "pending",
  "healthy",
  "degraded",
  "offline",
  "disabled",
]);

export const edgeKindSchema = z.enum(["hosted", "self_hosted"]);

export const edgeSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string().min(1).max(64),
  kind: edgeKindSchema,
  region: z.string(),
  publicIp: z.string().nullable(),
  domain: z.string().min(1),
  capacityLimit: z.number().int().positive(),
  activeTunnels: z.number().int().nonnegative(),
  status: edgeStatusSchema,
  lastHeartbeatAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createEdgeBody = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  region: z.string().min(1).max(64).default("unknown"),
  domain: z.string().min(1).max(253),
  publicIp: z.string().optional(),
  capacityLimit: z.number().int().min(1).max(100_000).default(100),
  kind: edgeKindSchema.default("self_hosted"),
});

export const patchEdgeBody = z
  .object({
    name: z.string().min(1).max(64).optional(),
    region: z.string().min(1).max(64).optional(),
    domain: z.string().min(1).max(253).optional(),
    publicIp: z.string().nullable().optional(),
    capacityLimit: z.number().int().min(1).max(100_000).optional(),
    status: z.enum(["healthy", "degraded", "offline", "disabled"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field must be provided",
  });

export const edgeListResponse = z.object({
  edges: z.array(edgeSchema),
});

export const createEdgeResponse = z.object({
  edge: edgeSchema,
  /** One-time registration token (plaintext, shown once). */
  registrationToken: z.string(),
  expiresAt: z.string().datetime(),
});

export type Edge = z.infer<typeof edgeSchema>;
export type CreateEdgeBody = z.infer<typeof createEdgeBody>;
export type PatchEdgeBody = z.infer<typeof patchEdgeBody>;
