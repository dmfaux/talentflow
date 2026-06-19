import { describe, expect, it } from "vitest";
import {
  buildTemplatePrompt,
  TALENTSTREAM_PROMPT_PALETTE,
  type BrandColors,
} from "@/lib/prompt-builder";

// ── CT4 · AI-prompt tier-flip ────────────────────────────────────────
//
// buildTemplatePrompt is the single source of the white-label lever: Standard/
// null campaigns embed the shared TalentStream palette + the "Powered by
// TalentStream" footer (matching their default-themed emails); Premium+ embed
// the brand's own colours and drop the powered-by footer. Asserted on substrings
// of the returned prompt so the contract is provable without an LLM.

const BRAND: BrandColors = {
  primary: "#006341",
  secondary: "#eeeeee",
  accent: "#b4c905",
  text: "#222222",
};

const POWERED_BY = "Powered by TalentStream";

function prompt(tier: string | null | undefined, brandColors: BrandColors | null = BRAND) {
  return buildTemplatePrompt({
    name: "Senior Engineer",
    brief: "A clean recruitment landing page.",
    brandColors,
    logo: null,
    tier,
  });
}

describe("buildTemplatePrompt — tier flip", () => {
  it("Standard embeds the TalentStream palette and keeps the powered-by footer", () => {
    const out = prompt("standard");
    expect(out).toContain(TALENTSTREAM_PROMPT_PALETTE.primary);
    expect(out).toContain(TALENTSTREAM_PROMPT_PALETTE.accent!);
    expect(out).toContain(POWERED_BY);
    // The brand's own colours are ignored on Standard.
    expect(out).not.toContain(BRAND.primary);
  });

  it("Premium embeds the brand colours and drops the powered-by footer", () => {
    const out = prompt("premium");
    expect(out).toContain(BRAND.primary);
    expect(out).toContain(BRAND.accent!);
    expect(out).not.toContain(POWERED_BY);
    // The TalentStream palette is not forced on a Premium brand.
    expect(out).not.toContain(TALENTSTREAM_PROMPT_PALETTE.primary);
  });

  it("Enterprise is treated as Premium+ (brand colours, no powered-by)", () => {
    const out = prompt("enterprise");
    expect(out).toContain(BRAND.primary);
    expect(out).not.toContain(POWERED_BY);
  });

  it("null / unknown tier is treated as Standard", () => {
    for (const tier of [null, undefined, "", "free", "bogus"]) {
      const out = prompt(tier);
      expect(out, `tier=${String(tier)}`).toContain(TALENTSTREAM_PROMPT_PALETTE.primary);
      expect(out, `tier=${String(tier)}`).toContain(POWERED_BY);
      expect(out, `tier=${String(tier)}`).not.toContain(BRAND.primary);
    }
  });

  it("Premium with no brand colours falls back to the choose-a-palette guidance", () => {
    const out = prompt("premium", null);
    expect(out).toContain("Choose a sophisticated, distinctive colour palette");
    expect(out).not.toContain(POWERED_BY);
  });
});
