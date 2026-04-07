ALTER TABLE "events" ADD COLUMN "visitor_id" text;--> statement-breakpoint
CREATE INDEX "events_visitor_id_idx" ON "events" USING btree ("visitor_id");