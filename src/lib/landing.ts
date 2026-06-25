// ── Campaign Themes — the palette-driven landing generator (CT5) ─────
//
// The landing-page analog of makeEmailKit (src/lib/email.ts): one fixed,
// editorial layout whose every colour, font, and logo is supplied by the
// resolved theme. A theme themes BOTH surfaces — emails via makeEmailKit, the
// landing via makeLandingTemplate — and a tenant picking a theme gets a
// renderable landing with nothing to paste. A custom (Premium) theme's bespoke
// landing override (themes.landing_html) is resolved upstream in theme.ts; this
// module never sees it.
//
// Output contract (matches a pasted template so it flows through the SAME
// pipeline — slots.ts validateHtmlTemplate/replaceSlots → HtmlTemplateRenderer):
//   • a complete <html><head><style>…</style></head><body>…</body></html> doc
//     (HtmlTemplateRenderer.extractBodyContent pulls <style> blocks + <body>);
//   • the literal, attribute-free <div id="application-form"></div> mount
//     (the renderer resolves the form by querySelector, and the wizard preview
//     swaps that exact string);
//   • only SLOT_ALLOW_LIST markers, optional fields wrapped in FLAT {{#…}} blocks
//     so they vanish when empty — so it passes validateHtmlTemplate by
//     construction;
//   • NO <script> (form logic is the app's job).
//
// Layout: the role brief and the application face each other from the first
// pixel — a wide editorial column (eyebrow → title → intro → a "role at a
// glance" fact panel → highlights → About) beside an elevated apply card, so
// the form is visible without scrolling past an empty hero. The apply card
// mounts the form ONLY; ApplicationForm renders its own "Apply for this role"
// heading + helper, so this template adds no heading of its own (avoids a
// duplicate). Every colour comes from the palette tokens, so the layout holds
// on light and dark themes alike.
//
// PURE + db-free on purpose: it takes an EmailTheme value, imports `EmailTheme`
// as a type only, and pulls nothing from theme.ts (which imports @/db). That
// keeps it safe to import anywhere and trivially unit-testable.

import type { EmailTheme } from "@/lib/theme";
import { DEFAULT_LANDING_COPY } from "@/lib/theme-copy";
import {
  fontImportsFor,
  DEFAULT_DISPLAY_FONT_KEY,
  DEFAULT_BODY_FONT_KEY,
} from "@/lib/theme-fonts";

// RD-1 back-fill: a pre-CT7 theme snapshot carries no fontImports key. An active
// campaign regenerates its landing from that snapshot, so a missing value must
// fall back to the Instrument defaults (what the landing previously loaded) — not
// to "no web font". A theme that deliberately chose system fonts stores an
// explicit [] (preserved by `??`). Sourced from theme-fonts (pure) to avoid a
// value import of theme.ts (which imports this module → would be a cycle).
const DEFAULT_LANDING_FONT_IMPORTS = fontImportsFor(
  DEFAULT_DISPLAY_FONT_KEY,
  DEFAULT_BODY_FONT_KEY
);

// Map an EmailTheme.palette onto CSS custom properties consumed by the layout
// below. Kebab-cased so the stylesheet reads naturally (var(--primary-deep)).
function paletteVars(palette: EmailTheme["palette"]): string {
  const rows: Array<[string, string]> = [
    ["--bg", palette.bg],
    ["--card", palette.card],
    ["--primary", palette.primary],
    ["--primary-deep", palette.primaryDeep],
    ["--primary-tint", palette.primaryTint],
    ["--accent", palette.accent],
    ["--ink", palette.ink],
    ["--ink-soft", palette.inkSoft],
    ["--ink-muted", palette.inkMuted],
    ["--ink-faint", palette.inkFaint],
    ["--border", palette.border],
  ];
  return rows.map(([k, v]) => `      ${k}: ${v};`).join("\n");
}

// HTML-attribute escape. theme.logo.* is operator/tenant-controlled (a brand's
// branding_logo_url or a bespoke theme's logo_url) and is interpolated into a
// double-quoted attribute on the PUBLIC landing page, which is rendered via
// innerHTML (HtmlTemplateRenderer) with no CSP. Without escaping, a logo URL like
//   https://x/a.png" onerror="…
// would break out of the src attribute and execute arbitrary JS in every
// visitor's browser (stored XSS). Escaping " (and &, <, >) neutralises break-out.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The brand mark: a baked/adopted logo (<img>) when the theme carries one, else
// the company name as a display-serif wordmark. logo background/position mirror
// the email kit + prompt-builder treatment. {{client.name}} stays a slot — it is
// escaped by replaceSlots at render; everything baked here is escapeAttr'd.
function brandMark(theme: EmailTheme): string {
  if (theme.logo) {
    return `<span class="ats-brand ats-brand--logo ats-brand--${escapeAttr(theme.logo.background)}"><img class="ats-logo" src="${escapeAttr(theme.logo.url)}" alt="{{client.name}}" /></span>`;
  }
  return `<span class="ats-brand ats-brand--text">{{client.name}}</span>`;
}

/**
 * Build the campaign landing page for a resolved theme. The result is a
 * self-contained, slot-marked HTML document; render it through replaceSlots +
 * HtmlTemplateRenderer exactly like a tenant-pasted template.
 */
export function makeLandingTemplate(theme: EmailTheme): string {
  const headerPosition = escapeAttr(theme.logo?.position ?? "top-left");
  const footer = theme.showPoweredBy
    ? `\n      <footer class="ats-footer">Powered by TalentStream</footer>`
    : "";

  // Fixed landing copy (headline / intro / highlights). The strings MAY embed
  // slot tokens like {{client.name}}; they are inserted RAW into element CONTENT
  // so embedded {{slots}} survive the downstream replaceSlots pass and are
  // escaped THERE (escapeAttr stays for the logo URL/attributes only).
  const copy = DEFAULT_LANDING_COPY;

  // CT7 web fonts: one @import per resolved font URL. A MISSING value (pre-CT7
  // snapshot) back-fills to the Instrument defaults; an explicit [] (system fonts)
  // is preserved → no @import. The --font-display/--font-sans vars still come from
  // theme.fontDisplay/fontSans below.
  const fontImports = (theme.fontImports ?? DEFAULT_LANDING_FONT_IMPORTS)
    .map((u) => `@import url('${u}');`)
    .join("\n    ");

  // Highlights → a checked selling-point list. Empty array → render nothing (no
  // empty <ul> container). Each item is raw operator copy (see the copy note).
  const highlights =
    copy.highlights.length > 0
      ? `\n        <ul class="ats-highlights">
          ${copy.highlights
            .map((h) => `<li class="ats-highlight">${h}</li>`)
            .join("\n          ")}
        </ul>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{campaign.role_title}}</title>
  <style>
    ${fontImports}

    :root {
${paletteVars(theme.palette)}
      --font-display: ${theme.fontDisplay};
      --font-sans: ${theme.fontSans};
    }

    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink-soft);
      font-family: var(--font-sans);
      font-size: 17px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--primary); }

    .ats-landing { min-height: 100vh; display: flex; flex-direction: column; }

    /* Header — brand mark only, quiet, defined by a hairline. */
    .ats-header {
      display: flex;
      align-items: center;
      padding: 20px clamp(20px, 5vw, 56px);
      background: var(--card);
      border-bottom: 1px solid var(--border);
    }
    .ats-header--top-left { justify-content: flex-start; }
    .ats-header--top-centre { justify-content: center; }
    .ats-logo { display: block; max-height: 38px; width: auto; }
    .ats-brand--dark { background: var(--ink); padding: 8px 14px; border-radius: 10px; }
    .ats-brand--text {
      font-family: var(--font-display);
      font-size: 25px;
      color: var(--ink);
      letter-spacing: -0.01em;
    }

    .ats-wrap { width: 100%; max-width: 1200px; margin: 0 auto; padding: clamp(34px, 5vw, 64px) clamp(20px, 5vw, 56px); flex: 1; }

    /* The shell: the role brief (left) faces the application (right), from the top. */
    .ats-shell {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(360px, 1fr);
      gap: clamp(34px, 4.5vw, 60px);
      align-items: start;
    }

    /* Hero — the role is the headline. */
    .ats-eyebrow {
      margin: 0 0 16px;
      font-family: var(--font-sans);
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--primary);
    }
    .ats-title {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 400;
      font-size: clamp(38px, 5.2vw, 58px);
      line-height: 1.04;
      letter-spacing: -0.02em;
      color: var(--ink);
    }
    .ats-rule { width: 54px; height: 3px; margin: 26px 0 0; background: var(--primary); border-radius: 2px; }
    .ats-intro {
      margin: 24px 0 0;
      max-width: 60ch;
      font-family: var(--font-sans);
      font-size: clamp(17px, 2vw, 19px);
      color: var(--ink-soft);
    }

    /* "Role at a glance" — labelled fact tiles. Each is a self-contained tinted
       tile, so an absent field simply leaves no tile (never an empty box). */
    .ats-facts { display: flex; flex-wrap: wrap; gap: 12px; margin: 30px 0 0; }
    .ats-fact {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 12px 16px;
      min-width: 132px;
      background: var(--primary-tint);
      border-radius: 12px;
    }
    .ats-fact-k {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink-muted);
    }
    .ats-fact-v { font-size: 15px; font-weight: 600; color: var(--ink); line-height: 1.35; }

    /* Highlights — operator selling-points, checked. */
    .ats-highlights {
      list-style: none;
      margin: 28px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 11px;
    }
    .ats-highlight {
      position: relative;
      padding-left: 30px;
      font-family: var(--font-sans);
      font-size: 16px;
      color: var(--ink-soft);
    }
    .ats-highlight::before {
      content: "";
      position: absolute;
      left: 2px;
      top: 0.34em;
      width: 14px;
      height: 8px;
      border-left: 2.5px solid var(--primary);
      border-bottom: 2.5px solid var(--primary);
      transform: rotate(-45deg);
    }

    /* About the role — continues the brief column, set off by a hairline. */
    .ats-about {
      margin-top: clamp(34px, 4vw, 44px);
      padding-top: clamp(30px, 3.5vw, 40px);
      border-top: 1px solid var(--border);
    }
    .ats-about-head {
      margin: 0 0 16px;
      font-family: var(--font-display);
      font-weight: 400;
      font-size: 26px;
      letter-spacing: -0.01em;
      color: var(--ink);
    }
    .ats-description { color: var(--ink-soft); }
    .ats-description > :first-child { margin-top: 0; }
    .ats-description h2, .ats-description h3 {
      font-family: var(--font-display); font-weight: 400; color: var(--ink);
      letter-spacing: -0.01em; margin: 30px 0 12px;
    }
    .ats-description h3 { font-size: 20px; }
    .ats-description p { margin: 0 0 16px; }
    .ats-description a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
    .ats-description strong { color: var(--ink); font-weight: 600; }
    .ats-description ul, .ats-description ol { margin: 0 0 16px; padding-left: 22px; }
    .ats-description li { margin: 0 0 8px; }

    /* Apply card — the conversion moment. Elevated, with a primary top edge; the
       form mounts here and supplies its own heading + brand-coloured button. */
    .ats-apply { position: relative; }
    .ats-apply-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-top: 4px solid var(--primary);
      border-radius: 16px;
      padding: clamp(24px, 2.6vw, 34px);
      box-shadow: 0 18px 40px -24px rgba(15, 23, 42, 0.45);
    }

    .ats-footer {
      padding: 36px 20px 44px;
      text-align: center;
      font-size: 13px;
      color: var(--ink-faint);
    }

    @media (max-width: 900px) {
      .ats-shell { grid-template-columns: 1fr; gap: 36px; }
    }
  </style>
</head>
<body>
  <div class="ats-landing">
    <header class="ats-header ats-header--${headerPosition}">
      ${brandMark(theme)}
    </header>

    <div class="ats-wrap">
      <div class="ats-shell">
        <div class="ats-brief">
          <p class="ats-eyebrow">${copy.headline}</p>
          <h1 class="ats-title">{{campaign.role_title}}</h1>
          <div class="ats-rule"></div>
          <p class="ats-intro">${copy.intro}</p>
          <div class="ats-facts">
            {{#campaign.department}}<div class="ats-fact"><span class="ats-fact-k">Department</span><span class="ats-fact-v">{{campaign.department}}</span></div>{{/campaign.department}}
            {{#campaign.location}}<div class="ats-fact"><span class="ats-fact-k">Location</span><span class="ats-fact-v">{{campaign.location}}</span></div>{{/campaign.location}}
            {{#campaign.employment_type}}<div class="ats-fact"><span class="ats-fact-k">Type</span><span class="ats-fact-v">{{campaign.employment_type}}</span></div>{{/campaign.employment_type}}
            {{#campaign.salary_range}}<div class="ats-fact"><span class="ats-fact-k">Salary</span><span class="ats-fact-v">{{campaign.salary_range}}</span></div>{{/campaign.salary_range}}
          </div>${highlights}
          {{#campaign.role_description}}<section class="ats-about">
            <h2 class="ats-about-head">About the role</h2>
            <div class="ats-description">{{campaign.role_description}}</div>
          </section>{{/campaign.role_description}}
        </div>
        <aside class="ats-apply">
          <div class="ats-apply-card">
            <div id="application-form"></div>
          </div>
        </aside>
      </div>
    </div>${footer}
  </div>
</body>
</html>`;
}
