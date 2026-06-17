import { db } from "@/db";
import { jobs } from "@/db/schema";
import { namespaceDedup, type JobQueue, type JobPayload, type EnqueueOptions } from "./types";

export class DbQueue implements JobQueue {
  async enqueue(payload: JobPayload, options?: EnqueueOptions): Promise<void> {
    await db
      .insert(jobs)
      .values({
        type: payload.type,
        payload,
        deliver_at: options?.deliverAt ?? new Date(),
        org_id: options?.orgId ?? null,
        // Org-namespaced so two tenants' identical raw keys produce distinct
        // values — the existing partial-unique jobs_dedup_idx then keys off the
        // namespaced value and no longer collides across orgs.
        deduplication_id: namespaceDedup(options?.orgId, options?.deduplicationId) ?? null,
      })
      .onConflictDoNothing();
  }
}
