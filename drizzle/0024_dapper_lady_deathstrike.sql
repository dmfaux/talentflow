ALTER TABLE "campaigns" ADD COLUMN "ghost_ttl_days" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "pending_rejection_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "nudge_sent_at" timestamp;