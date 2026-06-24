import { describe, expect, it } from "vitest";
import {
  BASE_UNITS_PER_CANDIDATE,
  CREDIT_PRICE_ZAR,
  baseUnits,
  billedCredits,
  tierForModel,
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
