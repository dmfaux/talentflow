import { describe, expect, it } from "vitest";
import {
  BASE_UNITS_PER_CANDIDATE,
  CREDIT_PRICE_ZAR,
  VAT_RATE,
  baseUnits,
  billedCredits,
  periodBounds,
  previousPeriodLabel,
  priceInvoice,
  tierForModel,
  type ModelTier,
} from "@/lib/pricing";

// Locks the canonical value-credit model (docs/pricing-model.md). If these
// numbers move, the landing page, docs, and spend view must move with them.
describe("value-credit math", () => {
  it("base units weight output ×5: a scored candidate ≈ 7 units", () => {
    expect(baseUnits(3600, 680)).toBeCloseTo(7.0, 1);
    expect(baseUnits(0, 0)).toBe(0);
  });

  it("a ~7-unit candidate bills ≈ 3 / 7 / 18 credits by tier", () => {
    expect(billedCredits(BASE_UNITS_PER_CANDIDATE, "essential")).toBeCloseTo(2.8);
    expect(billedCredits(BASE_UNITS_PER_CANDIDATE, "professional")).toBe(7);
    expect(billedCredits(BASE_UNITS_PER_CANDIDATE, "executive")).toBe(17.5);
  });

  it("one credit sells for R1.20 ex VAT", () => {
    expect(CREDIT_PRICE_ZAR).toBe(1.2);
  });

  it("resolves tiers from free-text model strings, defaulting to professional", () => {
    expect(tierForModel("claude-haiku-4-5")).toBe("essential");
    expect(tierForModel("claude-sonnet-4-6")).toBe("professional");
    expect(tierForModel("claude-opus-4-8")).toBe("executive");
    expect(tierForModel("gpt-4o")).toBe("professional");
    expect(tierForModel("local")).toBe("professional");
    expect(tierForModel(null)).toBe("professional");
  });
});

// docs/pricing-model.md §4 plan: premium = R18,000 base, 18,000 included credits,
// 10% overage discount.
const PREMIUM = { base_fee_zar: 18000, included_credits: 18000, overage_discount_pct: 10 };
const noTier = (over: Partial<Record<ModelTier, number>> = {}): Record<ModelTier, number> => ({
  essential: 0,
  professional: 0,
  executive: 0,
  ...over,
});

describe("invoice pricing (priceInvoice)", () => {
  it("under allowance: only base + VAT, no overage", () => {
    const inv = priceInvoice(PREMIUM, noTier({ professional: 5000 }), 0);
    expect(inv.overageCredits).toBe(0);
    expect(inv.lines.map((l) => l.lineType)).toEqual(["base", "vat"]);
    expect(inv.subtotalExVat).toBe(18000);
    expect(inv.vat).toBeCloseTo(18000 * VAT_RATE);
    expect(inv.totalInclVat).toBeCloseTo(18000 * 1.15);
  });

  it("over allowance: overage billed at R1.20 less the 10% discount", () => {
    // 20,000 credits − 18,000 included = 2,000 overage @ R1.20 × 0.9 = R2,160.
    const inv = priceInvoice(PREMIUM, noTier({ professional: 20000 }), 0);
    expect(inv.totalCredits).toBe(20000);
    expect(inv.overageCredits).toBe(2000);
    const overage = inv.lines.find((l) => l.lineType === "overage")!;
    expect(overage.unitRateZar).toBeCloseTo(1.08); // 1.20 × 0.9
    expect(overage.amountZar).toBeCloseTo(2160);
    expect(inv.subtotalExVat).toBeCloseTo(18000 + 2160);
    expect(inv.totalInclVat).toBeCloseTo((18000 + 2160) * 1.15);
  });

  it("splits overage across scoring tiers + a separate chat line; ZAR sums to the total", () => {
    // 30,000 total (10k essential incl 4k chat, 10k professional, 10k executive),
    // 18,000 included → 12,000 overage.
    const inv = priceInvoice(
      PREMIUM,
      { essential: 10000, professional: 10000, executive: 10000 },
      4000,
    );
    expect(inv.overageCredits).toBe(12000);
    const byType = inv.lines.filter((l) => l.lineType === "overage" || l.lineType === "chat");
    // Essential-scoring (6k), Professional (10k), Executive (10k), Chat (4k).
    expect(byType).toHaveLength(4);
    const chat = inv.lines.find((l) => l.lineType === "chat")!;
    expect(chat.modelTier).toBeNull();
    // chat share = 4000/30000 of 12,000 overage = 1,600 credits @ R1.08 = R1,728.
    expect(chat.quantityCredits).toBeCloseTo(1600);
    expect(chat.amountZar).toBeCloseTo(1728);
    // Per-bucket overage ZAR sums exactly to the headline overage ZAR.
    const overageZar = byType.reduce((s, l) => s + l.amountZar, 0);
    expect(overageZar).toBeCloseTo(12000 * 1.08);
    // overage credits across buckets reconcile to the headline overage credits.
    const overageCredits = byType.reduce((s, l) => s + (l.quantityCredits ?? 0), 0);
    expect(overageCredits).toBeCloseTo(12000);
  });

  it("no usage at all still bills the base fee + VAT", () => {
    const inv = priceInvoice(PREMIUM, noTier(), 0);
    expect(inv.totalCredits).toBe(0);
    expect(inv.subtotalExVat).toBe(18000);
    expect(inv.totalInclVat).toBeCloseTo(18000 * 1.15);
  });
});

describe("period helpers", () => {
  it("periodBounds returns a half-open [start, next-month) window", () => {
    const { start, end } = periodBounds("2026-02");
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(1); // February (0-indexed)
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(2); // March 1
    expect(end.getDate()).toBe(1);
  });

  it("previousPeriodLabel is the month before `now`, handling the year boundary", () => {
    expect(previousPeriodLabel(new Date(2026, 0, 15))).toBe("2025-12");
    expect(previousPeriodLabel(new Date(2026, 6, 1))).toBe("2026-06");
  });
});
