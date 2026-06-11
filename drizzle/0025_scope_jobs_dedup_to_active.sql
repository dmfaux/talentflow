-- Scope job deduplication to active (pending/processing) jobs only.
-- Previously the unique index covered completed/dead rows too, so a
-- deduplication_id was consumed forever after its first job finished —
-- silently dropping every later re-enqueue (e.g. re-processing a candidate
-- after a deferred CV upload, or re-running a recovery job that died).
DROP INDEX "jobs_dedup_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedup_idx" ON "jobs" USING btree ("deduplication_id") WHERE "deduplication_id" IS NOT NULL AND "status" IN ('pending', 'processing');
