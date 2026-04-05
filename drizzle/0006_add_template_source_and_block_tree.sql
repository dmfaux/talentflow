ALTER TABLE "templates" ADD COLUMN "source" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "block_tree" jsonb;--> statement-breakpoint
CREATE INDEX "templates_source_idx" ON "templates" USING btree ("source");--> statement-breakpoint
-- Mark the three shared-library templates as 'builtin' — they render
-- from code via src/templates/registry.ts, not from block_tree JSON.
UPDATE "templates" SET "source" = 'builtin' WHERE "key" IN ('editorial', 'corporate', 'modern');