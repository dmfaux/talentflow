import { describe, expect, it, vi } from "vitest";

// ── CT6 · landing precedence — the snapshot (frozen) branch (PURE) ───
//
// resolveEffectiveLanding has two halves: a DRAFT branch that resolves live
// through the DB, and a SNAPSHOT branch (active campaigns) that reads the frozen
// theme_snapshot and never touches the database. These cases exercise ONLY the
// snapshot branch, so the resolver is fully unit-testable here. We mock @/db
// with a findFirst that throws — proving the snapshot branch never reaches it.

vi.mock("@/db", () => ({
  db: {
    query: {
      themes: {
        findFirst: async () => {
          throw new Error("snapshot branch must not hit the DB");
        },
      },
    },
  },
}));

import { makeLandingTemplate } from "@/lib/landing";
import {
  DEFAULT_EMAIL_THEME,
  resolveEffectiveLanding,
  type EmailTheme,
  type ThemeSnapshot,
} from "@/lib/theme";

const MOUNT = '<div id="application-form"></div>';

// A distinctive frozen palette colour we can look for in the regenerated landing.
const BRANDED_PRIMARY = "#006341";
const brandedEmail: EmailTheme = {
  ...DEFAULT_EMAIL_THEME,
  palette: { ...DEFAULT_EMAIL_THEME.palette, primary: BRANDED_PRIMARY },
};

/** A minimal logo-less brand — irrelevant to the snapshot branch (no DB read),
 *  but required by the resolver's campaign shape. */
const brand = {
  default_theme_id: null,
  branding_logo_url: null,
  logo_background: null,
  logo_position: null,
};

function snapshot(over: Partial<ThemeSnapshot>): ThemeSnapshot {
  return {
    email: DEFAULT_EMAIL_THEME,
    landingHtml: null,
    theme_id: null,
    frozen_at: new Date(0).toISOString(),
    ...over,
  };
}

describe("resolveEffectiveLanding — snapshot branch (CT6)", () => {
  it("returns the frozen landingHtml verbatim when it is non-blank", async () => {
    const html = await resolveEffectiveLanding({
      theme_id: null,
      client: brand,
      theme_snapshot: snapshot({ landingHtml: "<frozen-bespoke-landing>" }),
    });
    expect(html).toBe("<frozen-bespoke-landing>");
  });

  it("regenerates makeLandingTemplate(snapshot.email) when landingHtml is null", async () => {
    const snap = snapshot({ email: brandedEmail, landingHtml: null });
    const html = await resolveEffectiveLanding({
      theme_id: null,
      client: brand,
      theme_snapshot: snap,
    });
    // Byte-equal to the generator output for the FROZEN email theme.
    expect(html).toBe(makeLandingTemplate(snap.email));
    expect(html).toContain(MOUNT); // the form can still mount
    expect(html).toContain(BRANDED_PRIMARY); // coloured from the frozen palette
  });

  it("treats a blank frozen landingHtml as 'no override' — regenerates from the palette", async () => {
    const snap = snapshot({ email: brandedEmail, landingHtml: "   " });
    const html = await resolveEffectiveLanding({
      theme_id: null,
      client: brand,
      theme_snapshot: snap,
    });
    expect(html).toBe(makeLandingTemplate(snap.email));
  });
});
