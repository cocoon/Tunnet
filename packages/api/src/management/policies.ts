import { ipCidrSchema } from "@tunnet/ip";
import { z } from "zod";

const cidrSelector = z.object({
  kind: z.literal("cidr"),
  value: ipCidrSchema,
});

export const selectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }),
  z.object({ kind: z.literal("endpoint"), value: z.string() }),
  z.object({ kind: z.literal("tag"), value: z.string() }),
  z.object({ kind: z.literal("network"), value: z.string() }),
  cidrSelector,
  z.object({ kind: z.literal("user"), value: z.string().min(1) }),
]);

export const portRangeSchema = z.object({
  start: z.number().int().min(0).max(65535),
  end: z.number().int().min(0).max(65535),
});

export const policyScopeSchema = z.enum(["network", "organization"]);

export function slugifyPolicySlug(input: string): string {
  const lower = input.toLowerCase().trim();
  let out = "";
  let pendingHyphen = false;
  for (const ch of lower) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
      if (pendingHyphen && out.length > 0) {
        out += "-";
      }
      out += ch;
      pendingHyphen = false;
    } else {
      pendingHyphen = true;
    }
    if (out.length >= 128) {
      break;
    }
  }
  return out;
}

export const policySlugSchema = z.preprocess(
  (val) => (typeof val === "string" ? slugifyPolicySlug(val) : val),
  z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
);

export const policySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  networkId: z.string().uuid().nullable(),
  scope: policyScopeSchema,
  /** Stable slug for GitOps / Terraform (`allow-eng-prod`). */
  slug: z.string().nullable().optional(),
  srcSelector: selectorSchema,
  dstSelector: selectorSchema,
  action: z.enum(["allow", "deny"]),
  ports: z.array(portRangeSchema),
  protocol: z.enum(["tcp", "udp", "icmp", "any"]).nullable(),
  priority: z.number().int(),
  orderIndex: z.number().int(),
  enabled: z.boolean(),
  /** Posture definition names required of the source (OR across names). */
  srcPosture: z.array(z.string()).nullable().optional(),
  createdAt: z.string().datetime(),
});

export const createPolicyBody = z.object({
  slug: policySlugSchema,
  srcSelector: selectorSchema,
  dstSelector: selectorSchema,
  action: z.enum(["allow", "deny"]),
  ports: z.array(portRangeSchema).default([]),
  protocol: z.enum(["tcp", "udp", "icmp", "any"]).nullable().optional(),
  priority: z.number().int().default(0),
  orderIndex: z.number().int().default(0),
  enabled: z.boolean().default(true),
  srcPosture: z.array(z.string()).optional(),
});

export const patchPolicyBody = createPolicyBody.partial();

/** Organization-scoped policies may only deny (guardrails). */
export const createOrgPolicyBody = createPolicyBody.refine(
  (body) => body.action === "deny",
  { message: "Organization-scoped Allow is not supported", path: ["action"] },
);

export const patchOrgPolicyBody = patchPolicyBody.superRefine((body, ctx) => {
  if (body.action !== undefined && body.action !== "deny") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Organization-scoped Allow is not supported",
      path: ["action"],
    });
  }
});

export const policyListResponse = z.object({
  policies: z.array(policySchema),
});

export type Policy = z.infer<typeof policySchema>;
export type CreatePolicyBody = z.input<typeof createPolicyBody>;
export type PatchPolicyBody = z.input<typeof patchPolicyBody>;
export type Selector = z.infer<typeof selectorSchema>;
export type PolicyScope = z.infer<typeof policyScopeSchema>;
