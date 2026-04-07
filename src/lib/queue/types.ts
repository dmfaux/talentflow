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
      emailKind: "gating_failed" | "gating_passed" | "application_received";
    };

export interface JobQueue {
  enqueue(payload: JobPayload, options?: EnqueueOptions): Promise<void>;
}
