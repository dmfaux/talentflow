ALTER TABLE "themes" ADD COLUMN "seed_primary" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "seed_accent" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "seed_bg" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "font_display_key" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "font_body_key" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "landing_copy" jsonb;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "email_copy" jsonb;