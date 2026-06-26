import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";

// ── Public pricing-page plan data (read model) ───────────────────────
//
// The marketing pricing cards are data-driven off the `plans` table so an
// operator can hide a plan or redact its commercials from /operator/plans
// without a redeploy (the home route is revalidated on toggle). Only the
// numbers + visibility flags live here; the qualitative marketing copy
// (names, blurbs, perks) stays in the client view, keyed by tier.

/** A plan card the public pricing page may render (public_visible only). */
export interface PublicPlan {
  tier: string; // standard | premium | enterprise (and any future tier)
  base_fee_zar: number;
  included_credits: number;
  overage_discount_pct: number;
  /** false → render the card but hide price/credits behind a "let's talk" CTA. */
  show_pricing: boolean;
}

// Display order for the canonical tiers; unknown tiers sort last (stable).
const TIER_ORDER: Record<string, number> = {
  standard: 0,
  premium: 1,
  enterprise: 2,
};

/**
 * Every plan that should appear on the public pricing page, in display order.
 * Hidden plans (public_visible = false) are excluded entirely; a redacted plan
 * (show_pricing = false) is still returned — the view hides its numbers.
 */
export async function getPublicPlanCards(): Promise<PublicPlan[]> {
  const rows = await db
    .select({
      tier: plans.tier,
      base_fee_zar: plans.base_fee_zar,
      included_credits: plans.included_credits,
      overage_discount_pct: plans.overage_discount_pct,
      show_pricing: plans.show_pricing,
    })
    .from(plans)
    .where(eq(plans.public_visible, true));

  return rows.sort(
    (a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
  );
}
