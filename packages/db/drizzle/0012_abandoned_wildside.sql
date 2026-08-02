CREATE TABLE "edge_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"edge_id" uuid NOT NULL,
	"active_tunnels" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_registration_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"edge_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'self_hosted' NOT NULL,
	"region" text DEFAULT 'unknown' NOT NULL,
	"public_ip" "inet",
	"domain" text NOT NULL,
	"capacity_limit" integer DEFAULT 100 NOT NULL,
	"active_tunnels" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"public_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edges_organization_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "edges_organization_domain_unique" UNIQUE("organization_id","domain"),
	CONSTRAINT "edges_kind_check" CHECK ("edges"."kind" IN ('hosted', 'self_hosted')),
	CONSTRAINT "edges_status_check" CHECK ("edges"."status" IN ('pending', 'healthy', 'degraded', 'offline', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "organization_relay_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"policy" text DEFAULT 'inherit' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_relay_settings_policy_check" CHECK ("organization_relay_settings"."policy" IN ('inherit', 'augment', 'exclusive'))
);
--> statement-breakpoint
ALTER TABLE "organization_tunnel_settings" RENAME COLUMN "default_relay_id" TO "default_edge_id";--> statement-breakpoint
ALTER TABLE "tunnel_secrets" RENAME COLUMN "relay_auth_token" TO "edge_auth_token";--> statement-breakpoint
ALTER TABLE "tunnels" RENAME COLUMN "relay_id" TO "edge_id";--> statement-breakpoint
ALTER TABLE "tunnels" RENAME COLUMN "relay_auth_hash" TO "edge_auth_hash";--> statement-breakpoint
ALTER TABLE "relays" DROP CONSTRAINT "relays_organization_name_unique";--> statement-breakpoint
ALTER TABLE "relays" DROP CONSTRAINT "relays_organization_domain_unique";--> statement-breakpoint
ALTER TABLE "relays" DROP CONSTRAINT "relays_kind_check";--> statement-breakpoint
ALTER TABLE "relays" DROP CONSTRAINT "relays_status_check";--> statement-breakpoint
ALTER TABLE "organization_tunnel_settings" DROP CONSTRAINT "organization_tunnel_settings_default_relay_id_relays_id_fk";
--> statement-breakpoint
ALTER TABLE "tunnels" DROP CONSTRAINT "tunnels_relay_id_relays_id_fk";
--> statement-breakpoint
DROP INDEX "tunnels_by_relay_idx";--> statement-breakpoint
ALTER TABLE "relay_registration_tokens" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_heartbeats" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "qad_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "metrics_url" text;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "access_mode" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "identity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "edge_heartbeats" ADD CONSTRAINT "edge_heartbeats_edge_id_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."edges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_registration_tokens" ADD CONSTRAINT "edge_registration_tokens_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_registration_tokens" ADD CONSTRAINT "edge_registration_tokens_edge_id_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."edges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_registration_tokens" ADD CONSTRAINT "edge_registration_tokens_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_relay_settings" ADD CONSTRAINT "organization_relay_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edge_heartbeats_by_edge_recorded_idx" ON "edge_heartbeats" USING btree ("edge_id","recorded_at");--> statement-breakpoint
CREATE INDEX "edge_registration_tokens_by_expires_at_idx" ON "edge_registration_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "edges_by_organization_status_idx" ON "edges" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "organization_tunnel_settings" ADD CONSTRAINT "organization_tunnel_settings_default_edge_id_edges_id_fk" FOREIGN KEY ("default_edge_id") REFERENCES "public"."edges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnels" ADD CONSTRAINT "tunnels_edge_id_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."edges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relays_organization_name_unique" ON "relays" USING btree ("organization_id","name") WHERE "relays"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "relays_deployment_name_unique" ON "relays" USING btree ("name") WHERE "relays"."organization_id" IS NULL;--> statement-breakpoint
CREATE INDEX "relays_by_deployment_status_idx" ON "relays" USING btree ("status") WHERE "relays"."organization_id" IS NULL;--> statement-breakpoint
CREATE INDEX "tunnels_by_edge_idx" ON "tunnels" USING btree ("edge_id");--> statement-breakpoint
ALTER TABLE "relay_heartbeats" DROP COLUMN "active_tunnels";--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "public_ip";--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "domain";--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "capacity_limit";--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "active_tunnels";--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "public_key";--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_status_check" CHECK ("relays"."status" IN ('pending', 'healthy', 'degraded', 'offline', 'suspended'));