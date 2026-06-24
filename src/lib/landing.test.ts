import { describe, expect, it } from "vitest";
import { makeLandingTemplate } from "@/lib/landing";
import type { EmailTheme } from "@/lib/theme";
import { DEFAULT_LANDING_COPY } from "@/lib/theme-copy";
import { validateHtmlTemplate, replaceSlots, type SlotData } from "@/lib/slots";

// A representative EmailTheme. Built inline (not imported from theme.ts) so this
// suite stays db-free — landing.ts and slots.ts have no @/db dependency, and
// EmailTheme is a type-only import that is erased at compile time.
const THEME: EmailTheme = {
  palette: {
    bg: "#f0f3f7",
    card: "#ffffff",
    primary: "#2c5bff",
    primaryDeep: "#1a45d4",
    primaryTint: "#e8eeff",
    accent: "#05dbd6",
    ink: "#11123c",
    inkSoft: "#2f3941",
    inkMuted: "#5a6b7a",
    inkFaint: "#9fb5c4",
    border: "#d1dce6",
  },
  fontDisplay: "'Instrument Serif', serif",
  fontSans: "'Instrument Sans', sans-serif",
  logo: null,
  showPoweredBy: true,
  // The default Instrument @import pair. Set explicitly so this db-free THEME
  // exercises the same fields the resolver hands makeLandingTemplate in production.
  fontImports: [
    "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap",
    "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap",
  ],
};

describe("makeLandingTemplate", () => {
  it("passes validateHtmlTemplate by construction (allowed slots + mount + no script)", () => {
    const check = validateHtmlTemplate(makeLandingTemplate(THEME));
    expect(check).toEqual({ ok: true });
  });

  it("is a full HTML document with the attribute-free application-form mount", () => {
    const html = makeLandingTemplate(THEME);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    // The renderer + preview both match this exact, attribute-free string.
    expect(html).toContain('<div id="application-form"></div>');
    expect(html).not.toMatch(/<script/i);
  });

  it("renders every palette token as a CSS variable", () => {
    const html = makeLandingTemplate(THEME);
    for (const value of Object.values(THEME.palette)) {
      expect(html).toContain(value);
    }
    expect(html).toContain("--primary: #2c5bff;");
  });

  it("re-colours from the palette — a different palette yields different output", () => {
    const branded = {
      ...THEME,
      palette: { ...THEME.palette, primary: "#006341", accent: "#b4c905" },
    };
    const html = makeLandingTemplate(branded);
    expect(html).toContain("#006341");
    expect(html).toContain("#b4c905");
    expect(html).not.toContain("--primary: #2c5bff;");
  });

  it("shows the powered-by footer only when showPoweredBy is true", () => {
    expect(makeLandingTemplate({ ...THEME, showPoweredBy: true })).toContain(
      "Powered by TalentStream"
    );
    expect(makeLandingTemplate({ ...THEME, showPoweredBy: false })).not.toContain(
      "Powered by TalentStream"
    );
  });

  it("renders a logo <img> when the theme carries one, else the {{client.name}} wordmark", () => {
    const withLogo = makeLandingTemplate({
      ...THEME,
      logo: {
        url: "https://cdn.example.com/acme.png",
        background: "dark",
        position: "top-centre",
      },
    });
    expect(withLogo).toContain('src="https://cdn.example.com/acme.png"');
    expect(withLogo).toContain("ats-header--top-centre");
    expect(withLogo).toContain("ats-brand--dark");

    const noLogo = makeLandingTemplate(THEME);
    expect(noLogo).toContain("ats-brand--text");
    expect(noLogo).toContain("{{client.name}}");
  });

  it("escapes a logo URL to prevent attribute break-out (stored XSS guard)", () => {
    const html = makeLandingTemplate({
      ...THEME,
      logo: {
        url: 'https://x/a.png" onerror="alert(document.cookie)',
        background: "light",
        position: "top-left",
      },
    });
    // The closing quote + onerror handler must be neutralised, not emitted raw.
    expect(html).not.toContain('onerror="alert(document.cookie)"');
    expect(html).toContain("&quot;");
    expect(html).toContain("a.png&quot; onerror=&quot;alert(document.cookie)");
  });

  it("renders through replaceSlots with real data and leaves no markers", () => {
    const data: SlotData = {
      client: { name: "Acme & Co" },
      campaign: {
        role_title: "Staff Engineer",
        role_description: "<p>Build things that matter.</p>",
        department: "Engineering",
        location: null,
        employment_type: null,
        salary_range_min: null,
        salary_range_max: null,
      },
    };
    const rendered = replaceSlots(makeLandingTemplate(THEME), data);
    // No unreplaced slot markers survive.
    expect(rendered).not.toMatch(/\{\{/);
    expect(rendered).toContain("Staff Engineer");
    // Department now renders as the first meta PILL (the eyebrow is the headline).
    expect(rendered).toContain('<span class="ats-pill">Engineering</span>');
    expect(rendered).toContain("Acme &amp; Co"); // escaped company name
    expect(rendered).toContain("Build things that matter.");
    // The headline copy carries a {{client.name}} slot → it is resolved + escaped
    // in element content by the downstream replaceSlots pass (not pre-escaped).
    expect(rendered).toContain('<p class="ats-eyebrow">Join Acme &amp; Co</p>');
    // Empty optional fields → their pills are stripped (location/type/salary): the
    // only ats-pill spans left are the single department pill.
    expect((rendered.match(/class="ats-pill"/g) ?? []).length).toBe(1);
  });

  it("renders the resolved landing copy with the default theme copy", () => {
    const html = makeLandingTemplate(THEME);
    // Headline → hero eyebrow; applyHeading → apply-card head; intro → lead para.
    expect(html).toContain(
      `<p class="ats-eyebrow">${DEFAULT_LANDING_COPY.headline}</p>`
    );
    expect(html).toContain(
      `<h2 class="ats-apply-head">${DEFAULT_LANDING_COPY.applyHeading}</h2>`
    );
    expect(html).toContain(`<p class="ats-intro">${DEFAULT_LANDING_COPY.intro}</p>`);
    // Each default highlight appears as a bulleted list item.
    for (const h of DEFAULT_LANDING_COPY.highlights) {
      expect(html).toContain(`<li class="ats-highlight">${h}</li>`);
    }
    expect(html).toContain('<ul class="ats-highlights">');
    // Default copy keeps the contract intact + still passes validation.
    expect(validateHtmlTemplate(html)).toEqual({ ok: true });
    expect(html).toContain('<div id="application-form"></div>');
  });

  it("inserts the default copy RAW so embedded slot tokens survive to replaceSlots", () => {
    // The default headline carries a {{client.name}} token — it must NOT be
    // HTML-escaped at build time (no &lbrace; etc.); it stays a live slot for the
    // downstream render pass.
    const html = makeLandingTemplate(THEME);
    expect(html).toContain(
      `<p class="ats-eyebrow">${DEFAULT_LANDING_COPY.headline}</p>`
    );
    const rendered = replaceSlots(html, {
      client: { name: "Acme" },
      campaign: {
        role_title: "Engineer",
        role_description: null,
        department: null,
        location: null,
        employment_type: null,
        salary_range_min: null,
        salary_range_max: null,
      },
    });
    expect(rendered).toContain('<p class="ats-eyebrow">Join Acme</p>');
  });

  it("emits one @import per fontImports URL, and none for an explicit empty list", () => {
    const oneFont = makeLandingTemplate({
      ...THEME,
      fontImports: ["https://fonts.googleapis.com/x"],
    });
    expect(oneFont).toContain("@import url('https://fonts.googleapis.com/x');");

    // An explicit [] means "system fonts" → no @import.
    const noFonts = makeLandingTemplate({ ...THEME, fontImports: [] });
    expect(noFonts).not.toContain("@import");
  });

  it("back-fills the Instrument defaults when fontImports is absent (RD-1: pre-CT7 snapshot)", () => {
    // A pre-CT7 snapshot has no fontImports key. It must NOT lose its web fonts —
    // it back-fills to the Instrument defaults rather than emitting no @import.
    const { fontImports: _f, ...noFontsField } = THEME;
    void _f;
    const out = makeLandingTemplate(noFontsField);
    expect(out).toContain("@import url('");
    expect(out).toContain("Instrument");
  });
});
