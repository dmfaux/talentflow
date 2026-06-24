import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  organizations,
  plans,
  usageEvents,
} from "@/db/schema";
import {
  getCampaignSpend,
  getOrgSpend,
  getSpendProjection,
} from "@/lib/pricing";
import type { TenantContext } from "@/lib/tenant";

const RUN = !!process.env.DATABASE_URL;

const fx = { orgA: "", orgB: "", brandA: "", campA: "", candA: "" };

const RUBRIC = {
  must_haves: ["TypeScript"],
  nice_to_haves: [],
  dealbreakers: [],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
};

/** Minimal tenant ctx for org-scoped reads — orgScope only reads effectiveOrgId. */
function ctxFor(orgId: string): TenantContext {
  return {
    userId: "u",
    isOperator: false,
    orgRole: "owner",
    orgId,
    actingOrgId: null,
    effectiveOrgId: orgId,
    activeBrandId: null,
  };
}

/** input + 5×output = base units ×1000; output 0 keeps the math obvious. */
function tokenRow(orgId: string, extra: Partial<typeof usageEvents.$inferInsert>) {
  return {
    org_id: orgId,
    kind: "ai_tokens" as const,
    input_tokens: 1000,
    output_tokens: 0,
    ...extra,
  };
}

describe.skipIf(!RUN)("usage-based spend reads (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(organizations); // cascades clients/campaigns/candidates/usage_events
    await db.delete(plans);
    await db.insert(plans).values({
      tier: "standard",
      base_fee_zar: 7500,
      included_credits: 6000,
      overage_discount_pct: 0,
    });

    [fx.orgA] = (
      await db.insert(organizations).values({ slug: "spend-a", name: "A" }).returning({ id: organizations.id })
    ).map((o) => o.id);
    [fx.orgB] = (
      await db.insert(organizations).values({ slug: "spend-b", name: "B" }).returning({ id: organizations.id })
    ).map((o) => o.id);
    [fx.brandA] = (
      await db.insert(clients).values({ org_id: fx.orgA, slug: "spend-brand-a", name: "BA" }).returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.campA] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "spend-c",
          role_title: "Engineer",
          gating_config: [],
          scoring_rubric: RUBRIC,
          selected_model_tier: "professional",
        })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);
    [fx.candA] = (
      await db
        .insert(candidates)
        .values({
          org_id: fx.orgA,
          campaign_id: fx.campA,
          name: "Cand A",
          email: "a@x.com",
          status: "scoring", // in-flight → counts toward the projection pipeline
        })
        .returning({ id: candidates.id })
    ).map((c) => c.id);

    await db.insert(usageEvents).values([
      // Org A scoring row — professional, 1 unit → 1 credit (campaign-attributed).
      tokenRow(fx.orgA, { model: "claude-sonnet-4-6", model_tier: "professional", campaign_id: fx.campA, candidate_id: fx.candA }),
      // Org A row stamped executive but with a HAIKU model string — the stamped
      // column must win (executive 2.5 credits, NOT essential 0.4).
      tokenRow(fx.orgA, { model: "claude-haiku-4-5", model_tier: "executive", campaign_id: fx.campA }),
      // Org A chat row — essential, candidate-scoped (no campaign_id) → must still
      // attribute to campA via the candidate join. 0.4 credits.
      tokenRow(fx.orgA, { model: "claude-haiku-4-5", model_tier: "essential", candidate_id: fx.candA }),
      // Org B — 5 units professional → 5 credits. Must never leak into org A.
      tokenRow(fx.orgB, { model: "claude-sonnet-4-6", model_tier: "professional", input_tokens: 5000 }),
    ]);
  });

  it("org-scopes spend — one org never sees another's usage", async () => {
    const a = await getOrgSpend(ctxFor(fx.orgA));
    const b = await getOrgSpend(ctxFor(fx.orgB));
    // A = 1 (prof) + 2.5 (exec) + 0.4 (essential) = 3.9; B = 5. No cross-leak.
    expect(a.totalCredits).toBeCloseTo(3.9, 5);
    expect(b.totalCredits).toBeCloseTo(5, 5);
  });

  it("prefers the stamped model_tier over the model string", async () => {
    const a = await getOrgSpend(ctxFor(fx.orgA));
    const byTier = Object.fromEntries(a.byTier.map((t) => [t.tier, t.credits]));
    // The haiku-string/executive-stamp row buckets to executive, not essential.
    expect(byTier.executive).toBeCloseTo(2.5, 5);
    expect(byTier.essential).toBeCloseTo(0.4, 5); // only the chat row
    expect(byTier.professional).toBeCloseTo(1, 5);
  });

  it("attributes campaign spend incl. candidate-scoped chat rows", async () => {
    const camp = await getCampaignSpend(ctxFor(fx.orgA), fx.campA);
    // All three org-A rows belong to campA (two via campaign_id, the chat via candidate).
    expect(camp.totalCredits).toBeCloseTo(3.9, 5);
    // Cross-org read of org-A's campaign from org B's ctx returns nothing.
    const cross = await getCampaignSpend(ctxFor(fx.orgB), fx.campA);
    expect(cross.totalCredits).toBe(0);
  });

  it("projects month-to-date with the plan allowance and in-flight pipeline", async () => {
    const p = await getSpendProjection(ctxFor(fx.orgA));
    expect(p.includedCredits).toBe(6000); // standard plan allowance
    expect(p.mtdCredits).toBeCloseTo(3.9, 5);
    expect(p.inFlightCount).toBe(1); // candA is "scoring"
    expect(p.costToFinishInclVat).toBeGreaterThan(0);
  });
});
