CREATE TABLE "plans" (
	"tier" text PRIMARY KEY NOT NULL,
	"base_fee_zar" integer NOT NULL,
	"included_credits" integer NOT NULL,
	"overage_discount_pct" integer DEFAULT 0 NOT NULL,
	"hard_ceiling_credits" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "selected_model_tier" text DEFAULT 'professional' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "max_model_tier" text DEFAULT 'executive' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "operator_max_model_tier" text DEFAULT 'executive' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "hard_ceiling_credits" integer;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "model_tier" text;--> statement-breakpoint
CREATE INDEX "usage_events_org_model_tier_idx" ON "usage_events" USING btree ("org_id","model_tier");