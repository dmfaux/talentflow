import { describe, expect, it } from "vitest";
import {
  isPremiumTier,
  isThemeScope,
  normaliseEmailTemplates,
  normaliseThemeFields,
  normaliseThemePalette,
  THEME_PALETTE_KEYS,
} from "@/lib/theme-fields";

// A complete, valid palette (all 11 tokens) for building test inputs.
const PALETTE = Object.fromEntries(
  THEME_PALETTE_KEYS.map((k) => [k, "#112233"])
) as Record<(typeof THEME_PALETTE_KEYS)[number], string>;

const VALID_LANDING = `<html><body><h1>Apply</h1><div id="application-form"></div></body></html>`;

// A valid per-type bespoke email map (CT6). applicationReceived takes no
// action.url; chatInvitation requires {{action.url}} or it fails validation.
const VALID_EMAIL_TEMPLATES = {
  applicationReceived:
    "<p>Hi {{candidate.name}}, your application for {{campaign.role_title}} at {{client.name}} is received.</p>",
  chatInvitation:
    '<p>Hi {{candidate.name}}</p><a href="{{action.url}}">Start the chat</a>',
};

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
  it("accepts a template with the form mount and stores it (custom scope)", () => {
    // CT6: bespoke landing structure is custom/Premium-only; a gallery theme is
    // forced to null landing_html (see the CT6 block below), so a stored landing
    // must be authored on a custom theme.
    const result = normaliseThemeFields(
      base({
        scope: "custom",
        org_id: "org-1",
        client_id: "brand-1",
        landing_html: VALID_LANDING,
      })
    );
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

describe("normaliseEmailTemplates (CT6)", () => {
  it("accepts a valid per-type map and returns it", () => {
    const result = normaliseEmailTemplates(VALID_EMAIL_TEMPLATES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.templates).toEqual(VALID_EMAIL_TEMPLATES);
    }
  });

  it("returns null for an absent / blank-only map (no overrides)", () => {
    expect(normaliseEmailTemplates(null)).toEqual({ ok: true, templates: null });
    // Blank string values are dropped, leaving no overrides → null.
    expect(normaliseEmailTemplates({ rejection: "   " })).toEqual({
      ok: true,
      templates: null,
    });
  });

  it("rejects an unknown template key", () => {
    const result = normaliseEmailTemplates({ welcomeAboard: "<p>hi</p>" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/welcomeAboard/);
  });

  it("propagates a validateEmailTemplate failure (missing required action.url)", () => {
    // chatInvitation requires {{action.url}}; omitting it must surface the error.
    const result = normaliseEmailTemplates({
      chatInvitation: "<p>Hi {{candidate.name}}, please continue.</p>",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/chatInvitation/);
      expect(result.message).toMatch(/action\.url/);
    }
  });
});

describe("normaliseThemeFields — email_templates (CT6)", () => {
  it("forces email_templates to null for a gallery theme even when supplied", () => {
    const result = normaliseThemeFields(
      base({ scope: "gallery", email_templates: VALID_EMAIL_TEMPLATES })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.email_templates).toBeNull();
      expect(result.values.landing_html).toBeNull();
    }
  });

  it("forces landing_html AND email_templates to null for gallery (custom-only structure)", () => {
    const result = normaliseThemeFields(
      base({
        scope: "gallery",
        landing_html: VALID_LANDING,
        email_templates: VALID_EMAIL_TEMPLATES,
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.landing_html).toBeNull();
      expect(result.values.email_templates).toBeNull();
    }
  });

  it("preserves landing_html + email_templates for a complete custom theme", () => {
    const result = normaliseThemeFields(
      base({
        scope: "custom",
        org_id: "org-1",
        client_id: "brand-1",
        landing_html: VALID_LANDING,
        email_templates: VALID_EMAIL_TEMPLATES,
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.landing_html).toBe(VALID_LANDING);
      expect(result.values.email_templates).toEqual(VALID_EMAIL_TEMPLATES);
    }
  });

  it("rejects a custom theme whose email_templates fail the per-type contract", () => {
    const result = normaliseThemeFields(
      base({
        scope: "custom",
        org_id: "org-1",
        client_id: "brand-1",
        email_templates: { chatNudge: "<p>{{candidate.name}}, please reply.</p>" },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/action\.url/);
  });
});

describe("normaliseThemeFields — CT7 seeds, font keys, copy", () => {
  it("derives the 11-token palette from 3 seeds", () => {
    const result = normaliseThemeFields(
      base({
        palette: undefined,
        seeds: { primary: "#2c5bff", accent: "#05dbd6", bg: "#f0f3f7" },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.seed_primary).toBe("#2c5bff");
    expect(result.values.seed_bg).toBe("#f0f3f7");
    expect(Object.keys(result.values.palette)).toHaveLength(
      THEME_PALETTE_KEYS.length
    );
    expect(result.values.palette.primary).toBe("#2c5bff");
  });

  it("rejects invalid seed hex with a 400", () => {
    const result = normaliseThemeFields(
      base({ palette: undefined, seeds: { primary: "nope", accent: "#05dbd6", bg: "#fff" } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/seeds/);
  });

  it("resolves font registry keys to stacks and stores the keys", () => {
    const result = normaliseThemeFields(
      base({
        font_display: undefined,
        font_sans: undefined,
        font_display_key: "fraunces",
        font_body_key: "inter",
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.font_display_key).toBe("fraunces");
    expect(result.values.font_body_key).toBe("inter");
    expect(result.values.font_display).toContain("Fraunces");
    expect(result.values.font_sans).toContain("Inter");
  });

  it("rejects an unknown font key (strict at the write boundary)", () => {
    const bad = normaliseThemeFields(base({ font_display_key: "frawnces" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/font_display_key/);
    const badBody = normaliseThemeFields(base({ font_body_key: "intur" }));
    expect(badBody.ok).toBe(false);
    if (!badBody.ok) expect(badBody.message).toMatch(/font_body_key/);
  });

  it("accepts gallery themes carrying landing_copy and email_copy", () => {
    const result = normaliseThemeFields(
      base({
        landing_copy: { headline: "Join {{client.name}}", highlights: ["a", "b"] },
        email_copy: { shared: { greeting: "Hi {{candidate.name}}," } },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.landing_copy?.headline).toBe("Join {{client.name}}");
    expect(result.values.email_copy?.shared.greeting).toBe("Hi {{candidate.name}},");
  });

  it("rejects landing_copy / email_copy that reference disallowed slots", () => {
    expect(
      normaliseThemeFields(base({ landing_copy: { headline: "Hi {{candidate.name}}" } })).ok
    ).toBe(false);
    expect(
      normaliseThemeFields(
        base({ email_copy: { perType: { applicationReceived: { body: "{{action.url}}" } } } })
      ).ok
    ).toBe(false);
  });
});
