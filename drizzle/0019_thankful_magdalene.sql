ALTER TABLE "scoring_logs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD COLUMN "fallback_chain" jsonb;