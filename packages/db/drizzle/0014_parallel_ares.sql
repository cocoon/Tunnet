CREATE TABLE "org_usage_monthly" (
	"organization_id" text NOT NULL,
	"month" integer NOT NULL,
	"relay_bytes" bigint DEFAULT 0 NOT NULL,
	"public_tunnel_bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_usage_monthly_pkey" PRIMARY KEY("organization_id","month")
);
--> statement-breakpoint
ALTER TABLE "org_usage_monthly" ADD CONSTRAINT "org_usage_monthly_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;