export interface EnqueueOptions {
  /** Deliver at this time (for scheduled/delayed messages). Immediate if omitted. */
  deliverAt?: Date;
  /** Idempotency key to prevent duplicate enqueues. */
  deduplicationId?: string;
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
  | { type: "chat-expire"; candidateId: string };

export interface JobQueue {
  enqueue(payload: JobPayload, options?: EnqueueOptions): Promise<void>;
}
