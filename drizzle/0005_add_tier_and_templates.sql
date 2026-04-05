CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"thumbnail_url" text,
	"owner_client_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tier" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_client_id_clients_id_fk" FOREIGN KEY ("owner_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_key_idx" ON "templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "templates_owner_client_id_idx" ON "templates" USING btree ("owner_client_id");--> statement-breakpoint
-- Seed the three shared-library templates so existing campaigns can be backfilled
INSERT INTO "templates" ("key", "name", "description", "thumbnail_url", "owner_client_id", "is_active") VALUES
	('editorial', 'Editorial', 'Typography-forward design with generous whitespace. Suited to senior professional roles — finance, legal, consulting.', '/templates/editorial.svg', NULL, true),
	('corporate', 'Corporate', 'Structured, formal layout with clear hierarchy and a strong hero. Suited to banking, insurance, and large enterprise.', '/templates/corporate.svg', NULL, true),
	('modern', 'Modern', 'Split-screen hero with geometric accents and a floating form card. Suited to tech companies, scale-ups, and product roles.', '/templates/modern.svg', NULL, true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Add template_id as nullable first, backfill from the editorial template, then set NOT NULL
ALTER TABLE "campaigns" ADD COLUMN "template_id" uuid;--> statement-breakpoint
UPDATE "campaigns" SET "template_id" = (SELECT "id" FROM "templates" WHERE "key" = 'editorial' LIMIT 1) WHERE "template_id" IS NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "template_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_template_id_idx" ON "campaigns" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "html_template";
