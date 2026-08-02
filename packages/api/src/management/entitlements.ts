import { z } from "zod";

const featureSchema = z.object({
  multiOrganization: z.boolean(),
  cloudLanding: z.boolean(),
  cloudInfrastructure: z.boolean(),
  openSignUp: z.boolean(),
  clickhouseAudit: z.boolean(),
  auditEnterpriseStreams: z.boolean(),
  complianceExport: z.boolean(),
});

const limitSchema = z.object({
  organizations: z.number().nullable(),
  nodes: z.number().nullable(),
  seats: z.number().nullable(),
  relays: z.number().nullable(),
});

export const entitlementsSchema = z.object({
  status: z.enum(["community", "active", "grace", "expired"]),
  tier: z.enum(["community", "cloud", "enterprise"]),
  features: featureSchema,
  limits: limitSchema,
  licenseId: z.string().nullable(),
  subject: z.string().nullable(),
  issuedAt: z.number().nullable(),
  notAfter: z.number().nullable(),
  graceUntil: z.number().nullable(),
  stale: z.boolean(),
  reason: z.string().nullable(),
});

export type EntitlementsResponse = z.infer<typeof entitlementsSchema>;
