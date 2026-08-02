import { z } from "zod";

export const edgeHeartbeatSampleSchema = z.object({
  id: z.string().uuid(),
  edgeId: z.string().uuid(),
  activeTunnels: z.number().int().nonnegative(),
  recordedAt: z.string().datetime(),
});

export const edgeCertInfoSchema = z.object({
  validUntil: z.string().datetime().nullable(),
});

export const edgeHealthResponse = z.object({
  heartbeats: z.array(edgeHeartbeatSampleSchema),
  cert: edgeCertInfoSchema,
  lastHeartbeatAt: z.string().datetime().nullable(),
  status: z.string(),
  activeTunnels: z.number().int().nonnegative(),
});

export type EdgeHeartbeatSample = z.infer<typeof edgeHeartbeatSampleSchema>;
export type EdgeHealthResponse = z.infer<typeof edgeHealthResponse>;
