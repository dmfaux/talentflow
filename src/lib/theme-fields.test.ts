import { describe, expect, it } from "vitest";
import {
  isPremiumTier,
  isThemeScope,
  normaliseThemeFields,
  normaliseThemePalette,
  THEME_PALETTE_KEYS,
} from "@/lib/theme-fields";

// A complete, valid palette (all 11 tokens) for building test inputs.
const PALETTE = Object.fromEntries(
  THEME_PALETTE_KEYS.map((k) => [k, "#112233"])
) as Record<(typeof THEME_PALETTE_KEYS)[number], string>;

const VALID_LANDING = `<html><body><h1>Apply</h1><div id="application-form"></div></body></html>`;

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "Aurora",
    scope: "gallery",
    palette: PALETTE,
    font_display: "Georgia, serif",
    font_sans: "Helvetica, Arial, sans-serif",
    ...overrides,
  };
}

describe("normaliseThemePalette", () => {
  it("normalises every token to #rrggbb", () => {
    const result = normaliseThemePalette({
      ...PALETTE,
      primary: "#ABC",
      accent: "FF0000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // normaliseHexColor lowercases + prefixes '#'; it keeps 3-digit shorthand.
      expect(result.palette.primary).toBe("#abc");
      expect(result.palette.accent).toBe("#ff0000");
      expect(Object.keys(result.palette)).toHaveLength(THEME_PALETTE_KEYS.length);
    }
  });

  it("reports the first invalid key", () => {
    const result = normaliseThemePalette({ ...PALETTE, inkMuted: "not-a-hex" });
    expect(result).toEqual({ ok: false, key: "inkMuted" });
  });

  it("rejects a missing token", () => {
    const partial = { ...PALETTE } as Record<string, unknown>;
    delete partial.border;
    const result = normaliseThemePalette(partial);
    expect(result).toEqual({ ok: false, key: "border" });
  });

  it("rejects a non-object", () => {
    expect(normaliseThemePalette(null)).toEqual({ ok: false, key: null });
  });
});

describe("isThemeScope / isPremiumTier", () => {
  it("accepts only the two scopes", () => {
    expect(isThemeScope("gallery")).toBe(true);
    expect(isThemeScope("custom")).toBe(true);
    expect(isThemeScope("bespoke")).toBe(false);
  });

  it("gates Premium+ only", () => {
    expect(isPremiumTier("premium")).toBe(true);
    expect(isPremiumTier("enterprise")).toBe(true);
    expect(isPremiumTier("standard")).toBe(false);
    expect(isPremiumTier(null)).toBe(false);
  });
});

describe("normaliseThemeFields — gallery invariants (D-4)", () => {
  it("forces show_powered_by=true and nulls org/client even when the body sets them", () => {
    const result = normaliseThemeFields(
      base({
        scope: "gallery",
        org_id: "org-1",
        client_id: "brand-1",
        show_powered_by: false,
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.show_powered_by).toBe(true);
      expect(result.values.org_id).toBeNull();
      expect(result.values.client_id).toBeNull();
    }
  });
});

describe("normaliseThemeFields — custom invariants", () => {
  it("requires both org_id and client_id", () => {
    const missing = normaliseThemeFields(base({ scope: "custom", org_id: "org-1" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/org_id and client_id/);
  });

  it("keeps a white-label flag and the ids for a complete custom theme", () => {
    const result = normaliseThemeFields(
      base({
        scope: "custom",
        org_id: "org-1",
        client_id: "brand-1",
        show_powered_by: false,
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.scope).toBe("custom");
      expect(result.values.org_id).toBe("org-1");
      expect(result.values.client_id).toBe("brand-1");
      expect(result.values.show_powered_by).toBe(false);
    }
  });
});

describe("normaliseThemeFields — field validation", () => {
  it("rejects an unknown scope", () => {
    const result = normaliseThemeFields(base({ scope: "bespoke" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/scope/);
  });

  it("requires a name", () => {
    const result = normaliseThemeFields(base({ name: "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/name/);
  });

  it("rejects a bad palette hex with the offending key", () => {
    const result = normaliseThemeFields(
      base({ palette: { ...PALETTE, primary: "zzz" } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/palette\.primary/);
  });

  it("requires both font stacks", () => {
    expect(normaliseThemeFields(base({ font_display: "" })).ok).toBe(false);
    expect(normaliseThemeFields(base({ font_sans: "" })).ok).toBe(false);
  });

  it("rejects an invalid logo_background", () => {
    const result = normaliseThemeFields(base({ logo_background: "rainbow" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/logo_background/);
  });
});

describe("normaliseThemeFields — landing_html (CT4 mount contract)", () => {
  it("accepts a template with the form mount and stores it", () => {
    const result = normaliseThemeFields(base({ landing_html: VALID_LANDING }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values.landing_html).toBe(VALID_LANDING);
  });

  it("rejects a template missing the application-form div", () => {
    const result = normaliseThemeFields(
      base({ landing_html: "<html><body>no form</body></html>" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/application-form/);
  });

  it("rejects a template containing a <script> tag", () => {
    const result = normaliseThemeFields(
      base({
        landing_html: `<div id="application-form"></div><script>alert(1)</script>`,
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/script/);
  });

  it("treats a blank landing_html as 'no landing' (null, not an error)", () => {
    const result = normaliseThemeFields(base({ landing_html: "   " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values.landing_html).toBeNull();
  });
});
