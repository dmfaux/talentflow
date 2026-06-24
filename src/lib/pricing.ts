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
import {
  campaigns,
  candidates,
  clients,
  organizations,
  plans,
  usageEvents,
} from "@/db/schema";
import { orgScope, type TenantContext } from "@/lib/tenant";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

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

/** One aggregated usage group (per model_tier × model). */
interface SpendRow {
  modelTier: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

/** Resolve a group's tier — the stamped column wins; legacy NULL rows fall back
 *  to deriving it from the free-text model string. */
function rowTier(r: SpendRow): ModelTier {
  return r.modelTier && r.modelTier in TIERS
    ? (r.modelTier as ModelTier)
    : tierForModel(r.model);
}

/** The four columns every spend query selects + groups by. */
const SPEND_COLUMNS = {
  modelTier: usageEvents.model_tier,
  model: usageEvents.model,
  inputTokens: sql<number>`coalesce(sum(${usageEvents.input_tokens}), 0)::int`,
  outputTokens: sql<number>`coalesce(sum(${usageEvents.output_tokens}), 0)::int`,
} as const;

/** Fold aggregated usage rows into the billed-credits + ZAR shape. */
function rowsToSpend(rows: SpendRow[], periodDays: number): OrgSpend {
  const unitsByTier: Record<ModelTier, number> = { essential: 0, professional: 0, executive: 0 };
  let totalUnits = 0;
  for (const r of rows) {
    // NULL-token rows contribute 0 units — conservative for the client.
    const u = baseUnits(r.inputTokens ?? 0, r.outputTokens ?? 0);
    unitsByTier[rowTier(r)] += u;
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
    periodDays,
    totalCredits,
    // A candidate ≈ 7 base units regardless of tier, so this is the real volume.
    estCandidates: totalUnits / BASE_UNITS_PER_CANDIDATE,
    byTier,
    subtotalExVat,
    vat,
    totalInclVat: subtotalExVat + vat,
  };
}

function sinceDays(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** First instant of the current calendar month (local time) — the billing period
 *  basis shared by the projection and the ceiling check. */
export function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Org-scoped spend over the last `days`. Reads usage_events through orgScope —
 * NEVER the operator raw-org-id path — so one org can never see another's spend.
 */
export async function getOrgSpend(ctx: TenantContext, days = 30): Promise<OrgSpend> {
  const rows = await db
    .select(SPEND_COLUMNS)
    .from(usageEvents)
    .where(
      and(
        orgScope(usageEvents, ctx),
        eq(usageEvents.kind, "ai_tokens"),
        gt(usageEvents.created_at, sinceDays(days)),
      ),
    )
    .groupBy(usageEvents.model_tier, usageEvents.model);
  return rowsToSpend(rows, days);
}

/**
 * Spend for a single campaign. Ownership is enforced by orgScope — a cross-org
 * campaignId returns zero rows. Chat ai_tokens carry candidate_id (not
 * campaign_id), so we LEFT JOIN candidates and attribute by
 * coalesce(usage.campaign_id, candidate.campaign_id). `days` omitted = all time.
 */
export async function getCampaignSpend(
  ctx: TenantContext,
  campaignId: string,
  days?: number,
): Promise<OrgSpend> {
  const conds = [
    orgScope(usageEvents, ctx),
    eq(usageEvents.kind, "ai_tokens"),
    eq(sql`coalesce(${usageEvents.campaign_id}, ${candidates.campaign_id})`, campaignId),
  ];
  if (days != null) conds.push(gt(usageEvents.created_at, sinceDays(days)));

  const rows = await db
    .select(SPEND_COLUMNS)
    .from(usageEvents)
    .leftJoin(candidates, eq(usageEvents.candidate_id, candidates.id))
    .where(and(...conds))
    .groupBy(usageEvents.model_tier, usageEvents.model);
  return rowsToSpend(rows, days ?? 0);
}

export interface CampaignSpendRow {
  campaignId: string;
  roleTitle: string;
  clientName: string | null;
  credits: number;
  zarInclVat: number;
}

/**
 * Per-campaign billed spend over the last `days`, biggest first. Powers the
 * Usage page's campaign table. Chat rows are attributed via the same coalesce as
 * getCampaignSpend; names resolve in a second org-scoped query.
 */
export async function getOrgCampaignBreakdown(
  ctx: TenantContext,
  days = 30,
  limit = 20,
): Promise<CampaignSpendRow[]> {
  const campaignKey = sql<string | null>`coalesce(${usageEvents.campaign_id}, ${candidates.campaign_id})`;
  const rows = await db
    .select({ campaignId: campaignKey, ...SPEND_COLUMNS })
    .from(usageEvents)
    .leftJoin(candidates, eq(usageEvents.candidate_id, candidates.id))
    .where(
      and(
        orgScope(usageEvents, ctx),
        eq(usageEvents.kind, "ai_tokens"),
        gt(usageEvents.created_at, sinceDays(days)),
      ),
    )
    .groupBy(campaignKey, usageEvents.model_tier, usageEvents.model);

  const creditsByCampaign = new Map<string, number>();
  for (const r of rows) {
    if (!r.campaignId) continue;
    const credits = billedCredits(baseUnits(r.inputTokens ?? 0, r.outputTokens ?? 0), rowTier(r));
    creditsByCampaign.set(r.campaignId, (creditsByCampaign.get(r.campaignId) ?? 0) + credits);
  }
  if (creditsByCampaign.size === 0) return [];

  const ids = [...creditsByCampaign.keys()];
  const meta = await db
    .select({ id: campaigns.id, roleTitle: campaigns.role_title, clientName: clients.name })
    .from(campaigns)
    .leftJoin(clients, eq(campaigns.client_id, clients.id))
    .where(and(orgScope(campaigns, ctx), inArray(campaigns.id, ids)));
  const metaById = new Map(meta.map((m) => [m.id, m]));

  return ids
    .map((id) => {
      const credits = creditsByCampaign.get(id)!;
      const m = metaById.get(id);
      return {
        campaignId: id,
        roleTitle: m?.roleTitle ?? "Unknown campaign",
        clientName: m?.clientName ?? null,
        credits,
        zarInclVat: credits * CREDIT_PRICE_ZAR * (1 + VAT_RATE),
      };
    })
    .sort((a, b) => b.credits - a.credits)
    .slice(0, limit);
}

export interface SpendProjection {
  periodLabel: string; // calendar month, "YYYY-MM"
  mtdCredits: number;
  mtdInclVat: number;
  projectedCredits: number;
  projectedInclVat: number;
  includedCredits: number; // plan monthly allowance
  hardCeilingCredits: number | null;
  inFlightCount: number; // candidates still drawing credits
  costToFinishInclVat: number; // ≈ R to finish the in-flight pipeline
  paused: boolean; // ceiling reached → new scoring intake is held (Phase 4)
  heldCount: number; // candidates parked at gating_passed (held backlog)
}

/**
 * Total billed credits for an org since `since`, by RAW orgId — for enforcement
 * / ceiling checks, NOT a tenant read (mirrors getOrgMargin's raw-orgId query).
 */
export async function creditsForOrgSince(orgId: string, since: Date): Promise<number> {
  const rows = await db
    .select(SPEND_COLUMNS)
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.org_id, orgId),
        eq(usageEvents.kind, "ai_tokens"),
        gt(usageEvents.created_at, since),
      ),
    )
    .groupBy(usageEvents.model_tier, usageEvents.model);
  let credits = 0;
  for (const r of rows) {
    credits += billedCredits(baseUnits(r.inputTokens ?? 0, r.outputTokens ?? 0), rowTier(r));
  }
  return credits;
}

/** Candidate statuses that will still draw AI credits (queued/active scoring or
 *  an open follow-up chat + its pending re-score). */
const INFLIGHT_STATUSES = ["gating_passed", "scoring", "follow_up"];

/**
 * Calendar-month-to-date spend + a straight run-rate projection to month end,
 * plus the plan allowance, the ceiling, and the in-flight pipeline (count +
 * R-cost-to-finish) that powers the Usage page's viral-cap card. On-read; no
 * rollup. Org-scoped throughout.
 */
export async function getSpendProjection(ctx: TenantContext): Promise<SpendProjection> {
  const now = new Date();
  const monthStart = startOfCurrentMonth();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const runRate = daysInMonth / Math.max(1, dayOfMonth);

  const mtdRows = await db
    .select(SPEND_COLUMNS)
    .from(usageEvents)
    .where(
      and(
        orgScope(usageEvents, ctx),
        eq(usageEvents.kind, "ai_tokens"),
        gt(usageEvents.created_at, monthStart),
      ),
    )
    .groupBy(usageEvents.model_tier, usageEvents.model);
  const mtd = rowsToSpend(mtdRows, dayOfMonth);

  // Plan allowance + ceiling for the caller's OWN org (effectiveOrgId is the
  // tenant's / acting org — reading its own row, never another tenant's).
  let includedCredits = 0;
  let hardCeilingCredits: number | null = null;
  if (ctx.effectiveOrgId) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.effectiveOrgId),
      columns: { tier: true, hard_ceiling_credits: true },
    });
    if (org) {
      const plan = await db.query.plans.findFirst({ where: eq(plans.tier, org.tier) });
      includedCredits = plan?.included_credits ?? 0;
      hardCeilingCredits = org.hard_ceiling_credits ?? plan?.hard_ceiling_credits ?? null;
    }
  }

  // In-flight pipeline, grouped by each candidate's campaign tier so the cost
  // estimate reflects the real mix.
  const inflightRows = await db
    .select({
      tier: campaigns.selected_model_tier,
      n: sql<number>`count(*)::int`,
    })
    .from(candidates)
    .innerJoin(campaigns, eq(candidates.campaign_id, campaigns.id))
    .where(and(orgScope(candidates, ctx), inArray(candidates.status, INFLIGHT_STATUSES)))
    .groupBy(campaigns.selected_model_tier);

  let inFlightCount = 0;
  let costToFinishExVat = 0;
  for (const r of inflightRows) {
    const tier = r.tier && r.tier in TIERS ? (r.tier as ModelTier) : "professional";
    inFlightCount += r.n;
    // Remaining work ≈ one scored candidate's worth of units at the campaign tier.
    costToFinishExVat += r.n * billedCredits(BASE_UNITS_PER_CANDIDATE, tier) * CREDIT_PRICE_ZAR;
  }

  // Held backlog = candidates parked at gating_passed (when intake is paused they
  // stay here with no job). Cheap indexed count.
  const [held] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(candidates)
    .where(and(orgScope(candidates, ctx), eq(candidates.status, "gating_passed")));

  return {
    periodLabel,
    mtdCredits: mtd.totalCredits,
    mtdInclVat: mtd.totalInclVat,
    projectedCredits: mtd.totalCredits * runRate,
    projectedInclVat: mtd.totalInclVat * runRate,
    includedCredits,
    hardCeilingCredits,
    inFlightCount,
    costToFinishInclVat: costToFinishExVat * (1 + VAT_RATE),
    paused: hardCeilingCredits != null && mtd.totalCredits >= hardCeilingCredits,
    heldCount: held?.n ?? 0,
  };
}

// ── Operator-only margin (raw cost) ──────────────────────────────────
//
// Internal model cost per 1,000 base units, ZAR (docs/pricing-model.md §2).
// OPERATOR-ONLY — getOrgSpend deliberately omits cost/margin; this is the only
// place raw cost surfaces and it must never be reached from a tenant route.
const INTERNAL_COST_ZAR_PER_1K: Record<ModelTier, number> = {
  essential: 0.019,
  professional: 0.056,
  executive: 0.093,
};

export interface OrgMargin {
  credits: number;
  billedExVat: number; // what the org is billed, ex VAT
  rawCostZar: number; // our internal model cost
  marginZar: number; // billed − cost
  marginPct: number; // margin / billed (0 when no spend)
}

/**
 * OPERATOR-ONLY raw cost + margin for an org. Takes a RAW orgId (operator god-
 * view, behind requireApiOperator) — NOT orgScope — so it must never be called
 * from a tenant surface. Returns internal cost the client never sees.
 */
export async function getOrgMargin(orgId: string, days = 30): Promise<OrgMargin> {
  const rows = await db
    .select(SPEND_COLUMNS)
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.org_id, orgId),
        eq(usageEvents.kind, "ai_tokens"),
        gt(usageEvents.created_at, sinceDays(days)),
      ),
    )
    .groupBy(usageEvents.model_tier, usageEvents.model);

  let credits = 0;
  let billedExVat = 0;
  let rawCostZar = 0;
  for (const r of rows) {
    const units = baseUnits(r.inputTokens ?? 0, r.outputTokens ?? 0);
    const tier = rowTier(r);
    const c = billedCredits(units, tier);
    credits += c;
    billedExVat += c * CREDIT_PRICE_ZAR;
    rawCostZar += units * INTERNAL_COST_ZAR_PER_1K[tier];
  }
  const marginZar = billedExVat - rawCostZar;
  return {
    credits,
    billedExVat,
    rawCostZar,
    marginZar,
    marginPct: billedExVat > 0 ? marginZar / billedExVat : 0,
  };
}
