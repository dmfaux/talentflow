import { db } from "@/db";
import { candidates, jobs } from "@/db/schema";
import { handleJob } from "@/lib/queue/worker";
import type { JobPayload } from "@/lib/queue/types";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const BATCH_SIZE = 10;
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-worker-secret");
  if (process.env.WORKER_SECRET && secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();

  // Reclaim jobs whose worker died mid-run: a 'processing' row with an
  // expired lock means the claimer never reported back. Retryable jobs go
  // back to 'pending'; exhausted ones are dead-lettered instead of being
  // reclaimed forever.
  await db.execute(sql`
    UPDATE jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
        last_error = COALESCE(last_error, 'worker lock expired'),
        locked_until = NULL
    WHERE status = 'processing'
      AND locked_until < ${sql.raw(`'${now}'::timestamptz`)}
  `);

  // Backstop: if an earlier processing job was lost, died, or completed
  // without moving the candidate forward, requeue candidates that are still
  // waiting at the post-gating stage or that have sat in 'scoring' with no
  // live job. Candidates without a saved CV get a grace window so this
  // cannot race a normal deferred upload. Only meaningful when the jobs
  // table is the queue — with Service Bus the table cannot see in-flight
  // messages, so requeuing here would double-process.
  if (process.env.QUEUE_PROVIDER !== "servicebus") {
    await db.execute(sql`
      INSERT INTO jobs (type, payload, deduplication_id)
      SELECT
        'candidate-processing',
        jsonb_build_object('type', 'candidate-processing', 'candidateId', ${candidates.id}),
        'process-recovery-' || ${candidates.id}::text
      FROM ${candidates}
      WHERE (
          (
            ${candidates.status} = 'gating_passed'
            AND ${candidates.gating_passed} = true
            AND (
              ${candidates.cv_url} IS NOT NULL
              OR ${candidates.created_at} < now() - interval '15 minutes'
            )
          )
          OR (
            ${candidates.status} = 'scoring'
            AND ${candidates.updated_at} < now() - interval '15 minutes'
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jobs existing
          WHERE existing.type = 'candidate-processing'
            AND existing.status IN ('pending', 'processing')
            AND existing.payload->>'candidateId' = ${candidates.id}::text
        )
        -- Throttle: at most one recovery attempt per candidate per window,
        -- so a candidate the job keeps skipping (e.g. storage unconfigured)
        -- doesn't requeue on every tick.
        AND NOT EXISTS (
          SELECT 1
          FROM jobs recent
          WHERE recent.deduplication_id = 'process-recovery-' || ${candidates.id}::text
            AND recent.created_at > now() - interval '15 minutes'
        )
      ON CONFLICT DO NOTHING
    `);
  }

  // Atomically claim a batch of ready jobs
  // Use sql.raw() for timestamps to avoid Drizzle converting strings to Date
  // objects which postgres.js rejects. Values are self-generated, not user input.
  const readyJobs = await db.execute<{
    id: string;
    type: string;
    payload: JobPayload;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE jobs
    SET status = 'processing',
        locked_until = ${sql.raw(`'${lockUntil}'::timestamptz`)},
        attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'pending'
        AND deliver_at <= ${sql.raw(`'${now}'::timestamptz`)}
        AND (locked_until IS NULL OR locked_until < ${sql.raw(`'${now}'::timestamptz`)})
      ORDER BY deliver_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);

  let processed = 0;
  let failed = 0;

  for (const job of readyJobs) {
    try {
      await handleJob(job.payload);
      await db
        .update(jobs)
        .set({ status: "completed", completed_at: new Date(), locked_until: null })
        .where(eq(jobs.id, job.id));
      processed++;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      const newStatus =
        job.attempts >= job.max_attempts ? "dead" : "pending";
      await db
        .update(jobs)
        .set({ status: newStatus, last_error: message, locked_until: null })
        .where(eq(jobs.id, job.id));
      failed++;
    }
  }

  return NextResponse.json({
    processed,
    failed,
    total: readyJobs.length,
  });
}
