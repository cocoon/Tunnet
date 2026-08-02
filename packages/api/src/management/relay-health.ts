import { z } from "zod";

export const relayHeartbeatSampleSchema = z.object({
  id: z.string().uuid(),
  relayId: z.string().uuid(),
  recordedAt: z.string().datetime(),
  metrics: z.record(z.string(), z.unknown()).nullable(),
});

export const relayHealthResponse = z.object({
  heartbeats: z.array(relayHeartbeatSampleSchema),
  lastHeartbeatAt: z.string().datetime().nullable(),
  status: z.string(),
  suspendedAt: z.string().datetime().nullable(),
});

export type RelayHeartbeatSample = z.infer<typeof relayHeartbeatSampleSchema>;
export type RelayHealthResponse = z.infer<typeof relayHealthResponse>;
