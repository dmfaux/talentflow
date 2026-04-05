ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_slug_unique";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "clients" SET "slug" = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'));--> statement-breakpoint
UPDATE "clients" SET "slug" = trim(both '-' from "slug");--> statement-breakpoint
UPDATE "clients" SET "slug" = "slug" || '-' || left(id::text, 4) WHERE "slug" IN (SELECT "slug" FROM "clients" GROUP BY "slug" HAVING count(*) > 1);--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_slug_idx" ON "clients" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_slug_unique" UNIQUE("client_id","slug");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_slug_unique" UNIQUE("slug");
