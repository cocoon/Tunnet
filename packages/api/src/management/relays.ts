import { z } from "zod";

export const relayStatusSchema = z.enum([
  "pending",
  "healthy",
  "degraded",
  "offline",
  "suspended",
]);

export const relayAccessModeSchema = z.enum(["open", "shared_token", "http"]);

export const relaySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().nullable(),
  name: z.string().min(1).max(64),
  url: z.string(),
  region: z.string(),
  status: relayStatusSchema,
  qadEnabled: z.boolean(),
  metricsUrl: z.string().nullable(),
  accessMode: relayAccessModeSchema,
  lastHeartbeatAt: z.string().datetime().nullable(),
  identity: z.record(z.string(), z.unknown()),
  suspendedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createRelayBody = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  region: z.string().min(1).max(64).default("unknown"),
  url: z.string().max(2048).optional().default(""),
  qadEnabled: z.boolean().optional().default(false),
  metricsUrl: z.string().max(2048).nullable().optional(),
  accessMode: relayAccessModeSchema.optional().default("open"),
});

export const patchRelayBody = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
      .optional(),
    region: z.string().min(1).max(64).optional(),
    url: z.string().max(2048).optional(),
    qadEnabled: z.boolean().optional(),
    metricsUrl: z.string().max(2048).nullable().optional(),
    accessMode: relayAccessModeSchema.optional(),
    /** Set `suspended` to suspend, `healthy` to resume. */
    status: z.enum(["healthy", "degraded", "offline", "suspended"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field must be provided",
  });

export const relayListResponse = z.object({
  relays: z.array(relaySchema),
  /** Healthy Cloud deployment relay regions (read-only; org list only). */
  availableRelayRegions: z.array(z.string()).optional(),
});

export const createRelayResponse = z.object({
  relay: relaySchema,
  /** One-time registration token (plaintext, shown once). */
  registrationToken: z.string(),
  expiresAt: z.string().datetime(),
});

export const availableRelayRegionsResponse = z.object({
  regions: z.array(z.string()),
});

export type Relay = z.infer<typeof relaySchema>;
export type CreateRelayBody = z.infer<typeof createRelayBody>;
export type PatchRelayBody = z.infer<typeof patchRelayBody>;
