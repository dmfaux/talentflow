ALTER TABLE "clients" ADD COLUMN "brand_primary_color" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "brand_secondary_color" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "brand_accent_color" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "brand_text_color" text DEFAULT '#0b0f1c';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "logo_background" text DEFAULT 'light';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "logo_position" text DEFAULT 'top-left';