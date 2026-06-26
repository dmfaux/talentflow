ALTER TABLE "organizations" ADD COLUMN "base_fee_zar" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "included_credits" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "overage_discount_pct" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "public_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "show_pricing" boolean DEFAULT true NOT NULL;