ALTER TABLE "template_status_log" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "template_status_log" CASCADE;--> statement-breakpoint
DROP TABLE "templates" CASCADE;--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "campaigns_template_id_templates_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "campaigns_template_id_idx";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "html_template" text;--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "key_responsibilities";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "template_id";