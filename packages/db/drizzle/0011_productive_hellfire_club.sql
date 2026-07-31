ALTER TABLE "networks" ADD COLUMN "default_action" text DEFAULT 'allow' NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "icmp_policy" text DEFAULT 'allow' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "order_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "policies_by_org_order_idx" ON "policies" USING btree ("organization_id","order_index");--> statement-breakpoint
CREATE INDEX "policies_by_network_order_idx" ON "policies" USING btree ("network_id","order_index") WHERE "policies"."network_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_default_action_check" CHECK ("networks"."default_action" IN ('allow', 'deny'));--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_icmp_policy_check" CHECK ("networks"."icmp_policy" IN ('allow', 'acl', 'deny'));