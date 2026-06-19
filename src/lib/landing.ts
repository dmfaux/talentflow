// ── Campaign Themes — the palette-driven landing generator (CT5) ─────
//
// The landing-page analog of makeEmailKit (src/lib/email.ts): one fixed,
// editorial layout whose every colour, font, and logo is supplied by the
// resolved theme. A theme themes BOTH surfaces — emails via makeEmailKit, the
// landing via makeLandingTemplate — and a tenant picking a theme gets a
// renderable landing with nothing to paste. The optional per-campaign paste
// (campaigns.html_template) is a Premium-only override, resolved upstream in
// theme.ts; this module never sees it.
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
// PURE + db-free on purpose: it takes an EmailTheme value, imports `EmailTheme`
// as a type only, and pulls nothing from theme.ts (which imports @/db). That
// keeps it safe to import anywhere and trivially unit-testable.

import type { EmailTheme } from "@/lib/theme";

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{campaign.role_title}}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap');

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
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }

    .ats-landing { min-height: 100vh; display: flex; flex-direction: column; }

    /* Header — brand mark only, quiet. */
    .ats-header {
      display: flex;
      align-items: center;
      padding: 22px clamp(20px, 5vw, 64px);
      background: var(--card);
      border-bottom: 1px solid var(--border);
    }
    .ats-header--top-left { justify-content: flex-start; }
    .ats-header--top-centre { justify-content: center; }
    .ats-logo { display: block; max-height: 40px; width: auto; }
    .ats-brand--dark { background: var(--ink); padding: 8px 14px; border-radius: 10px; }
    .ats-brand--text {
      font-family: var(--font-display);
      font-size: 26px;
      color: var(--ink);
      letter-spacing: -0.01em;
    }

    .ats-wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: clamp(36px, 6vw, 76px) clamp(20px, 5vw, 64px); flex: 1; }

    /* Hero — the role is the headline. */
    .ats-hero { max-width: 760px; }
    .ats-eyebrow {
      margin: 0 0 14px;
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--primary);
    }
    .ats-title {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 400;
      font-size: clamp(40px, 6.5vw, 68px);
      line-height: 1.04;
      letter-spacing: -0.02em;
      color: var(--ink);
    }
    .ats-rule { width: 64px; height: 3px; margin: 28px 0 0; background: var(--primary); border-radius: 2px; }
    .ats-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
    .ats-pill {
      display: inline-block;
      padding: 7px 14px;
      border-radius: 999px;
      background: var(--primary-tint);
      color: var(--primary-deep);
      font-size: 14px;
      font-weight: 500;
      line-height: 1.2;
    }
    .ats-pill--accent { background: var(--accent); color: var(--ink); }

    /* Body — description beside the framed apply card. */
    .ats-body {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(330px, 1fr);
      gap: clamp(32px, 5vw, 60px);
      align-items: start;
      margin-top: clamp(44px, 6vw, 72px);
    }
    .ats-about-head, .ats-apply-head {
      margin: 0 0 18px;
      font-family: var(--font-display);
      font-weight: 400;
      font-size: 25px;
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

    /* Apply card — the conversion moment. Primary accent edge, no risky
       text-on-primary (the form supplies its own brand-coloured button). */
    .ats-apply { position: sticky; top: 28px; }
    .ats-apply-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-top: 3px solid var(--primary);
      border-radius: 14px;
      padding: clamp(24px, 3vw, 32px);
      box-shadow: 0 1px 2px rgba(17, 18, 60, 0.04);
    }

    .ats-footer {
      padding: 32px 20px 40px;
      text-align: center;
      font-size: 13px;
      color: var(--ink-faint);
    }

    @media (max-width: 880px) {
      .ats-body { grid-template-columns: 1fr; }
      .ats-apply { position: static; }
    }
  </style>
</head>
<body>
  <div class="ats-landing">
    <header class="ats-header ats-header--${headerPosition}">
      ${brandMark(theme)}
    </header>

    <div class="ats-wrap">
      <section class="ats-hero">
        {{#campaign.department}}<p class="ats-eyebrow">{{campaign.department}}</p>{{/campaign.department}}
        <h1 class="ats-title">{{campaign.role_title}}</h1>
        <div class="ats-rule"></div>
        <div class="ats-meta">
          {{#campaign.location}}<span class="ats-pill">{{campaign.location}}</span>{{/campaign.location}}
          {{#campaign.employment_type}}<span class="ats-pill">{{campaign.employment_type}}</span>{{/campaign.employment_type}}
          {{#campaign.salary_range}}<span class="ats-pill ats-pill--accent">{{campaign.salary_range}}</span>{{/campaign.salary_range}}
        </div>
      </section>

      <div class="ats-body">
        <main class="ats-main">
          {{#campaign.role_description}}<section class="ats-about">
            <h2 class="ats-about-head">About the role</h2>
            <div class="ats-description">{{campaign.role_description}}</div>
          </section>{{/campaign.role_description}}
        </main>
        <aside class="ats-apply">
          <div class="ats-apply-card">
            <h2 class="ats-apply-head">Apply for this role</h2>
            <div id="application-form"></div>
          </div>
        </aside>
      </div>
    </div>${footer}
  </div>
</body>
</html>`;
}
