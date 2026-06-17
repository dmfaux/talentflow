import { db } from "@/db";
import { usageEvents } from "@/db/schema";

// ── Per-org usage metering (S10) ─────────────────────────────────────
//
// The cost-visibility ledger writer. Billing is deferred, but AI spend must be
// attributable per org before launch, and the global queue must be tenant-safe.
// recordUsageEvent is the single production insert path (S14 seeds through it),
// and it is deliberately best-effort: a metering failure must NEVER break the
// scoring / chat / email / provisioning hot path it is called from.

export type UsageKind =
  | "ai_tokens"
  | "campaign_created"
  | "candidate_created"
  | "chat_message"
  | "email_sent";

export interface UsageEventInput {
  orgId: string;
  brandId?: string | null;
  kind: UsageKind;
  /** ai_tokens only — provider name from the SDK fallback result. */
  provider?: string | null;
  /** ai_tokens only — model id from the SDK result. */
  model?: string | null;
  /** SDK usage.inputTokens. v6 reports `number | undefined`; pass undefined→null
   *  so "unknown" is distinguishable from a genuine zero. Never coerce to 0. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  campaignId?: string | null;
  candidateId?: string | null;
  /** Defaults to 1 (one event). */
  quantity?: number;
}

/**
 * Record a usage event. Best-effort and fire-and-forget — mirrors the
 * `.enqueue(...).catch(...)` pattern used for side effects elsewhere. The
 * insert is intentionally not awaited by callers; any failure is logged and
 * swallowed so it can never throw into the caller's hot path.
 */
export function recordUsageEvent(input: UsageEventInput): void {
  void db
    .insert(usageEvents)
    .values({
      org_id: input.orgId,
      brand_id: input.brandId ?? null,
      kind: input.kind,
      provider: input.provider ?? null,
      model: input.model ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      campaign_id: input.campaignId ?? null,
      candidate_id: input.candidateId ?? null,
      quantity: input.quantity ?? 1,
    })
    .catch((err) => console.error("recordUsageEvent failed:", err));
}
