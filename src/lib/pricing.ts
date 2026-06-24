// ── Usage → credits → ZAR pricing (prototype, pre-migration) ──────────
//
// Canonical "value-credit" model (see docs/pricing-model.md):
//   • 1 AI credit = a fixed sell price, CREDIT_PRICE_ZAR (ex VAT) — the one knob.
//   • An AI operation's credit cost = base units × the tier's credit rate, where
//     base units = (input + 5×output) / 1000 (output weighted ×5 because every
//     mapped model prices output at exactly 5× input).
//   • Premium tiers charge MORE credits for the same work (the margin lever);
//     cheaper tiers charge fewer. Chat is always billed at the Essential rate.
//
// Reads the EXISTING usage_events ledger and resolves the tier from the stored
// free-text `model` string (production stamps a `model_tier` column instead).
// Returns BILLED credits + ZAR only — never raw cost or margin (operator-only).

import { db } from "@/db";
import { usageEvents } from "@/db/schema";
import { orgScope, type TenantContext } from "@/lib/tenant";
import { and, eq, gt, sql } from "drizzle-orm";

export const OUTPUT_WEIGHT = 5;
/** Sell price of one AI credit, ex VAT (ZAR). The single pricing knob. */
export const CREDIT_PRICE_ZAR = 1.2;
export const VAT_RATE = 0.15;
/** A scored candidate ≈ 7,000 normalised tokens of actual work (tier-agnostic). */
export const BASE_UNITS_PER_CANDIDATE = 7;

export type ModelTier = "essential" | "professional" | "executive";

export interface TierInfo {
  tier: ModelTier;
  label: string;
  model: string;
  /** Credits charged per 1,000 normalised tokens — the margin lever. */
  creditRate: number;
}

export const TIERS: Record<ModelTier, TierInfo> = {
  essential: { tier: "essential", label: "Essential", model: "claude-haiku-4-5", creditRate: 0.4 },
  professional: { tier: "professional", label: "Professional", model: "claude-sonnet-4-6", creditRate: 1.0 },
  executive: { tier: "executive", label: "Executive", model: "claude-opus-4-8", creditRate: 2.5 },
};

const TIER_ORDER: ModelTier[] = ["essential", "professional", "executive"];

/**
 * Resolve a stored free-text model string to a friendly tier. Unknown / local /
 * openrouter / null strings fall back to Professional so every usage row prices
 * to a tier and never crashes or reads as zero.
 */
export function tierForModel(model: string | null): ModelTier {
  const m = (model ?? "").toLowerCase();
  if (m.includes("haiku")) return "essential";
  if (m.includes("opus")) return "executive";
  return "professional"; // sonnet + unknown/local/openrouter/gpt fallback
}

/** Normalised base units for a token pair: (input + 5×output) / 1000. */
export function baseUnits(inputTokens: number, outputTokens: number): number {
  return (inputTokens + OUTPUT_WEIGHT * outputTokens) / 1000;
}

/** Billed AI credits for `units` of work at a tier. */
export function billedCredits(units: number, tier: ModelTier): number {
  return units * TIERS[tier].creditRate;
}

export interface TierSpend {
  tier: ModelTier;
  label: string;
  credits: number; // billed value-credits
  zar: number; // credits × CREDIT_PRICE_ZAR, ex VAT
}

export interface OrgSpend {
  periodDays: number;
  totalCredits: number; // billed value-credits
  estCandidates: number; // tier-agnostic, from actual token volume
  byTier: TierSpend[];
  subtotalExVat: number;
  vat: number;
  totalInclVat: number;
}

/**
 * Org-scoped spend over the last `days`. Reads usage_events through orgScope —
 * NEVER the operator raw-org-id path — so one org can never see another's spend.
 */
export async function getOrgSpend(ctx: TenantContext, days = 30): Promise<OrgSpend> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      model: usageEvents.model,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.input_tokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.output_tokens}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        orgScope(usageEvents, ctx),
        eq(usageEvents.kind, "ai_tokens"),
        gt(usageEvents.created_at, since),
      ),
    )
    .groupBy(usageEvents.model);

  const unitsByTier: Record<ModelTier, number> = { essential: 0, professional: 0, executive: 0 };
  let totalUnits = 0;
  for (const r of rows) {
    // NULL-token rows contribute 0 units — conservative for the client.
    const u = baseUnits(r.inputTokens ?? 0, r.outputTokens ?? 0);
    unitsByTier[tierForModel(r.model)] += u;
    totalUnits += u;
  }

  const byTier: TierSpend[] = TIER_ORDER.map((tier) => {
    const credits = billedCredits(unitsByTier[tier], tier);
    return { tier, label: TIERS[tier].label, credits, zar: credits * CREDIT_PRICE_ZAR };
  });

  const totalCredits = byTier.reduce((s, t) => s + t.credits, 0);
  const subtotalExVat = byTier.reduce((s, t) => s + t.zar, 0);
  const vat = subtotalExVat * VAT_RATE;

  return {
    periodDays: days,
    totalCredits,
    // A candidate ≈ 7 base units regardless of tier, so this is the real volume.
    estCandidates: totalUnits / BASE_UNITS_PER_CANDIDATE,
    byTier,
    subtotalExVat,
    vat,
    totalInclVat: subtotalExVat + vat,
  };
}
