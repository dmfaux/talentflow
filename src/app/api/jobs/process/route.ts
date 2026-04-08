import { db } from "@/db";
import { jobs } from "@/db/schema";
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
