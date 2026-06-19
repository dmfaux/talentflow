import { describe, expect, it } from "vitest";
import { makeLandingTemplate } from "@/lib/landing";
import type { EmailTheme } from "@/lib/theme";
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
    expect(rendered).toContain("Engineering"); // department eyebrow kept
    expect(rendered).toContain("Acme &amp; Co"); // escaped company name
    expect(rendered).toContain("Build things that matter.");
    // Empty optional fields → their pills are stripped (location/type/salary).
    expect(rendered).not.toContain('class="ats-pill"');
  });
});
