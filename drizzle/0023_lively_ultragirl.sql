ALTER TABLE "scoring_logs" ADD COLUMN "dimensions" jsonb;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD COLUMN "flags" jsonb;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD COLUMN "recommendation" text;