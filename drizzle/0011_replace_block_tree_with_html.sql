-- Replace block-tree JSON columns with HTML template columns.
-- Drop the source column (no more builtin vs custom distinction).
ALTER TABLE "templates" ADD COLUMN "html_template" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "published_html_template" text;--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "block_tree";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "published_block_tree";--> statement-breakpoint
DROP INDEX IF EXISTS "templates_source_idx";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "source";
