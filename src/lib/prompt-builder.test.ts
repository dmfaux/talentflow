import { describe, expect, it } from "vitest";
import { buildBespokeKitPrompt, type BrandColors } from "@/lib/prompt-builder";
import { BODY_MARKER } from "@/lib/email-shell";

// ── Bespoke brand-kit prompt ─────────────────────────────────────────
//
// buildBespokeKitPrompt produces the ONE prompt an operator runs to generate a
// Premium brand's bespoke theme: a landing page AND a matching email shell, from
// one design system, so their look and feel is guaranteed mutual. Asserted on
// substrings so the contract is provable without an LLM. Custom themes are always
// Premium, so the brand's own colours are always embedded.

const BRAND: BrandColors = {
  primary: "#006341",
  secondary: "#eeeeee",
  accent: "#b4c905",
  text: "#222222",
};

function prompt(brandColors: BrandColors | null = BRAND, logo = null) {
  return buildBespokeKitPrompt({
    name: "Northwind — Bespoke",
    brief: "A confident, editorial recruitment brand.",
    brandColors,
    logo,
  });
}

describe("buildBespokeKitPrompt", () => {
  it("embeds the theme name and the operator's brief verbatim", () => {
    const out = prompt();
    expect(out).toContain("Northwind — Bespoke");
    expect(out).toContain("A confident, editorial recruitment brand.");
  });

  it("asks for BOTH artifacts: the landing form mount and the email body marker", () => {
    const out = prompt();
    // Landing page: the exact application-form mount the renderer resolves.
    expect(out).toContain('<div id="application-form"></div>');
    // Email shell: the exact marker the app injects each email's body at.
    expect(out).toContain(BODY_MARKER);
    // It is one prompt producing two artifacts.
    expect(out.toLowerCase()).toContain("landing page");
    expect(out.toLowerCase()).toContain("email shell");
  });

  it("embeds the brand's exact colours (always Premium / white-label)", () => {
    const out = prompt();
    expect(out).toContain(BRAND.primary);
    expect(out).toContain(BRAND.accent!);
    // No "Powered by TalentStream" attribution on a white-label brand kit.
    expect(out).not.toContain("Powered by TalentStream");
  });

  it("falls back to choose-a-palette guidance when no brand colours are given", () => {
    const out = prompt(null);
    expect(out).toContain("Choose a sophisticated, distinctive colour palette");
  });

  it("references the logo URL when a logo is supplied, else says there is none", () => {
    const withLogo = buildBespokeKitPrompt({
      name: "Northwind",
      brief: "x",
      brandColors: BRAND,
      logo: { url: "https://cdn.test/logo.png", background: "light", position: "top-left" },
    });
    expect(withLogo).toContain("https://cdn.test/logo.png");
    expect(prompt(BRAND, null)).toContain("No brand logo is available");
  });
});
