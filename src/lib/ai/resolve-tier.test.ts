import { describe, expect, it } from "vitest";
import {
  asModelTier,
  clampTier,
  isModelTier,
  resolveModelForTier,
} from "@/lib/ai/resolve-tier";
import { TIERS, type ModelTier } from "@/lib/pricing";

const open = { operatorMax: "executive", orgMax: "executive" } as const;

describe("resolveModelForTier", () => {
  it("hard-pins chat to Essential, ignoring the requested tier and caps", () => {
    for (const requested of ["essential", "professional", "executive"] as ModelTier[]) {
      const r = resolveModelForTier(requested, "chat", {
        operatorMax: "executive",
        orgMax: "executive",
      });
      expect(r.tier).toBe("essential");
      expect(r.model).toBe(TIERS.essential.model);
    }
  });

  it("returns the requested scoring tier + model when within caps", () => {
    const r = resolveModelForTier("executive", "scoring", open);
    expect(r.tier).toBe("executive");
    expect(r.model).toBe(TIERS.executive.model);
  });

  it("clamps a stale Executive selection under a lowered org cap", () => {
    const r = resolveModelForTier("executive", "scoring", {
      operatorMax: "executive",
      orgMax: "professional",
    });
    expect(r.tier).toBe("professional");
    expect(r.model).toBe(TIERS.professional.model);
  });

  it("applies the most restrictive of operator and org caps", () => {
    const r = resolveModelForTier("executive", "scoring", {
      operatorMax: "essential",
      orgMax: "professional",
    });
    expect(r.tier).toBe("essential");
  });

  it("never upgrades above the requested tier", () => {
    expect(resolveModelForTier("essential", "scoring", open).tier).toBe("essential");
  });
});

describe("clampTier", () => {
  it("returns the most restrictive cap", () => {
    expect(clampTier("executive", "professional", "essential")).toBe("essential");
    expect(clampTier("professional", "executive")).toBe("professional");
    expect(clampTier("essential", "executive", "professional")).toBe("essential");
  });
});

describe("asModelTier / isModelTier", () => {
  it("accepts valid tiers and defaults unknowns to professional", () => {
    expect(asModelTier("executive")).toBe("executive");
    expect(asModelTier("bogus")).toBe("professional");
    expect(asModelTier(null)).toBe("professional");
    expect(asModelTier(undefined)).toBe("professional");
  });

  it("guards valid tiers", () => {
    expect(isModelTier("essential")).toBe(true);
    expect(isModelTier("bogus")).toBe(false);
    expect(isModelTier(null)).toBe(false);
  });
});
