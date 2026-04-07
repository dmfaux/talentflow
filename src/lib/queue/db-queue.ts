import { db } from "@/db";
import { jobs } from "@/db/schema";
import type { JobQueue, JobPayload, EnqueueOptions } from "./types";

export class DbQueue implements JobQueue {
  async enqueue(payload: JobPayload, options?: EnqueueOptions): Promise<void> {
    await db
      .insert(jobs)
      .values({
        type: payload.type,
        payload,
        deliver_at: options?.deliverAt ?? new Date(),
        deduplication_id: options?.deduplicationId ?? null,
      })
      .onConflictDoNothing();
  }
}
