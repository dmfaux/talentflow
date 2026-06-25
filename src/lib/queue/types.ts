export interface EnqueueOptions {
  /** Deliver at this time (for scheduled/delayed messages). Immediate if omitted. */
  deliverAt?: Date;
  /** Idempotency key to prevent duplicate enqueues. */
  deduplicationId?: string;
  /** Owning org for attribution + per-tenant dedup (S10). Every JobPayload
   *  variant carries a candidateId, so this is always derivable at the call
   *  site; genuinely-global jobs pass null explicitly. */
  orgId?: string | null;
}

/**
 * Namespace a raw deduplication key by org so two tenants' identical
 * idempotency keys can never collide (S10 Resolved Decision A). The single
 * rule used by BOTH queue drivers (DbQueue's partial-unique `jobs_dedup_idx`
 * and ServiceBus's `messageId`) and by the `jobs/process` raw-SQL backstop,
 * so per-tenant dedup is defined in exactly one place. A null org → "global"
 * so global jobs still dedup among themselves. Returns undefined when there is
 * no raw key (no dedup requested).
 */
export function namespaceDedup(
  orgId: string | null | undefined,
  rawDeduplicationId: string | null | undefined
): string | undefined {
  if (!rawDeduplicationId) return undefined;
  return `${orgId ?? "global"}:${rawDeduplicationId}`;
}

export type JobPayload =
  | { type: "candidate-processing"; candidateId: string }
  | {
      type: "send-email";
      candidateId: string;
      emailKind:
        | "gating_failed"
        | "gating_passed"
        | "application_received"
        | "rejected"
        | "rejection_confirmation"
        | "no_response";
      /** Optional verbatim admin note — only used by some email kinds. */
      adminReason?: string;
    }
  | { type: "send-chat-invitation"; candidateId: string }
  | { type: "rescore-after-chat"; candidateId: string; conversationId: string }
  | { type: "chat-nudge"; candidateId: string }
  | { type: "chat-expire"; candidateId: string }
  // Usage-based pricing (Phase 6). The first ORG-scoped variant: it carries no
  // candidateId, so the worker's org-active gate resolves the org from orgId.
  | { type: "billing-close"; orgId: string; period: string };

export interface JobQueue {
  enqueue(payload: JobPayload, options?: EnqueueOptions): Promise<void>;
}
