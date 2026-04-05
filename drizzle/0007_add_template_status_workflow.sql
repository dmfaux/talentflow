ALTER TABLE "templates" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "published_block_tree" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "preview_token" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "preview_token_expires_at" timestamp;--> statement-breakpoint
-- Backfill status from is_active. Existing active templates were
-- previously usable by campaigns, so they map to 'published'. Inactive
-- templates map to 'archived' (not selectable for new campaigns but
-- live campaigns continue rendering).
UPDATE "templates" SET "status" = 'published', "published_at" = "updated_at" WHERE "is_active" = true;--> statement-breakpoint
UPDATE "templates" SET "status" = 'archived' WHERE "is_active" = false;--> statement-breakpoint
-- Snapshot live block_tree into published_block_tree for published
-- custom templates. Builtins stay NULL (they render from code).
UPDATE "templates" SET "published_block_tree" = "block_tree"
  WHERE "status" = 'published' AND "source" = 'custom' AND "block_tree" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "templates_status_idx" ON "templates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_preview_token_idx" ON "templates" USING btree ("preview_token");