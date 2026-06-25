import { beforeAll, describe, expect, it, vi } from "vitest";

// Email is mocked: the close path attempts an invoice email on create only. We
// assert the send count without a live transport.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn(async () => "msg-id") }));
vi.mock("@/lib/email", () => ({
  sendTransactionalEmail: sendMock,
  invoiceEmail: () => "<html></html>",
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  invoiceCounters,
  invoiceLineItems,
  invoices,
  organizations,
  plans,
  usageRollups,
  usageEvents,
} from "@/db/schema";
import { closeOrgPeriod } from "@/lib/billing";

const RUN = !!process.env.DATABASE_URL;

const PERIOD = "2020-01";
const IN_PERIOD = new Date(2020, 0, 15); // local Jan 2020 — inside periodBounds(PERIOD)

const RUBRIC = {
  must_haves: ["TypeScript"],
  nice_to_haves: [],
  dealbreakers: [],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
};

const fx = { orgA: "", orgB: "", orgC: "", brandA: "", campA: "", candA: "" };

const seqOf = (invoiceNo: string) => Number(invoiceNo.split("-")[2]);

describe.skipIf(!RUN)("billing close + invoicing (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(organizations); // cascades clients/campaigns/candidates/usage_events/invoices/rollups
    await db.delete(plans);
    await db.delete(invoiceCounters);
    await db.insert(invoiceCounters).values({ id: 1, next_seq: 1 });
    await db.insert(plans).values({
      tier: "standard",
      base_fee_zar: 7500,
      included_credits: 6000,
      overage_discount_pct: 0,
    });

    const mkOrg = async (slug: string, billing_email: string | null = null) =>
      (
        await db
          .insert(organizations)
          .values({ slug, name: slug, billing_email })
          .returning({ id: organizations.id })
      )[0].id;
    fx.orgA = await mkOrg("bill-a", "billing@bill-a.test"); // has billing_email → emailed on close
    fx.orgB = await mkOrg("bill-b");
    fx.orgC = await mkOrg("bill-c");

    fx.brandA = (
      await db.insert(clients).values({ org_id: fx.orgA, slug: "bill-brand-a", name: "BA" }).returning({ id: clients.id })
    )[0].id;
    fx.campA = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "bill-camp-a",
          role_title: "Engineer",
          gating_config: [],
          scoring_rubric: RUBRIC,
          selected_model_tier: "professional",
        })
        .returning({ id: campaigns.id })
    )[0].id;
    fx.candA = (
      await db
        .insert(candidates)
        .values({ org_id: fx.orgA, campaign_id: fx.campA, name: "Cand A", email: "a@x.com", status: "scored" })
        .returning({ id: candidates.id })
    )[0].id;

    // Org A usage IN the closed period: 7000 professional credits (scoring,
    // campaign-attributed) + 0.4 essential credits (chat, campaign_id NULL).
    await db.insert(usageEvents).values([
      {
        org_id: fx.orgA,
        kind: "ai_tokens",
        model: "claude-sonnet-4-6",
        model_tier: "professional",
        input_tokens: 7_000_000,
        output_tokens: 0,
        campaign_id: fx.campA,
        candidate_id: fx.candA,
        created_at: IN_PERIOD,
      },
      {
        org_id: fx.orgA,
        kind: "ai_tokens",
        model: "claude-haiku-4-5",
        model_tier: "essential",
        input_tokens: 1000,
        output_tokens: 0,
        candidate_id: fx.candA, // chat: no campaign_id
        created_at: IN_PERIOD,
      },
    ]);
  });

  it("creates an issued invoice with base/overage/chat/vat lines + a frozen rollup", async () => {
    sendMock.mockClear();
    const { invoice, created } = await closeOrgPeriod(fx.orgA, PERIOD);

    expect(created).toBe(true);
    expect(invoice.status).toBe("issued");
    expect(invoice.invoice_no).toMatch(/^INV-2020-\d{6}$/);
    // 7500 base + 1000.4 overage credits @ R1.20 = 8700.48 ex VAT → ×1.15.
    expect(invoice.subtotal_ex_vat).toBeCloseTo(8700.48, 2);
    expect(invoice.total_incl_vat).toBeCloseTo(8700.48 * 1.15, 2);
    expect(sendMock).toHaveBeenCalledTimes(1); // emailed on create

    const lines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoice_id, invoice.id));
    const byType = lines.map((l) => l.line_type).sort();
    expect(byType).toContain("base");
    expect(byType).toContain("vat");
    expect(byType).toContain("chat");
    const overage = lines.filter((l) => l.line_type === "overage");
    expect(overage.map((l) => l.model_tier)).toEqual(["professional"]); // essential-scoring + executive are 0

    // Rollup freeze: per-tier credits sum to the billed total (7000.4).
    const rollups = await db
      .select()
      .from(usageRollups)
      .where(and(eq(usageRollups.org_id, fx.orgA), eq(usageRollups.period, PERIOD)));
    const totalCredits = rollups.reduce((s, r) => s + r.credits, 0);
    expect(totalCredits).toBeCloseTo(7000.4, 4);
  });

  it("is idempotent per (org, period): a re-run returns the same invoice and emails nothing", async () => {
    sendMock.mockClear();
    const { invoice, created } = await closeOrgPeriod(fx.orgA, PERIOD);
    expect(created).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();

    const all = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.org_id, fx.orgA), eq(invoices.period, PERIOD)));
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(invoice.id);
  });

  it("assigns gapless invoice numbers under concurrent close", async () => {
    const [a, b] = await Promise.all([
      closeOrgPeriod(fx.orgB, PERIOD),
      closeOrgPeriod(fx.orgC, PERIOD),
    ]);
    const seqs = [seqOf(a.invoice.invoice_no), seqOf(b.invoice.invoice_no)].sort((x, y) => x - y);
    expect(seqs[1] - seqs[0]).toBe(1); // consecutive, no gap, no collision
  });

  it("does not alter a frozen invoice when the candidate is purged (SET NULL)", async () => {
    const before = (
      await db.select().from(invoices).where(eq(invoices.org_id, fx.orgA))
    )[0];

    // Purge the candidate — usage_events.candidate_id is SET NULL; the frozen
    // invoice + line items reference neither, so the billed number can't move.
    await db.delete(candidates).where(eq(candidates.id, fx.candA));

    const after = (
      await db.select().from(invoices).where(eq(invoices.id, before.id))
    )[0];
    expect(after.total_incl_vat).toBe(before.total_incl_vat);
    expect(after.subtotal_ex_vat).toBe(before.subtotal_ex_vat);
  });
});
