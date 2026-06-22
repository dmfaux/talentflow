/**
 * Curated font catalogue for the Campaign Themes feature.
 *
 * PURE, dependency-free module: it imports nothing from the rest of the app so
 * that `theme-fields.ts` and `theme.ts` can safely import it without cycles.
 *
 * An operator picks one DISPLAY font and one BODY font from these curated
 * dropdowns. Landing pages load the real web font via the Google Fonts
 * `@import` URL; emails fall back to the email-safe families baked into each
 * `stack` (most email clients strip `@import`, so the real webfont never
 * loads there — the fallbacks carry the look).
 */

export interface FontDef {
  /** Stable kebab id, e.g. "instrument-serif". Unique across BOTH lists. */
  key: string;
  /** Human label for the dropdown, e.g. "Instrument Serif". */
  label: string;
  role: "display" | "body";
  /** Full CSS font-family stack: real webfont first, then EMAIL-SAFE fallbacks. */
  stack: string;
  /** Google Fonts CSS URL for this family, or null for pure system stacks. */
  importUrl: string | null;
}

const GOOGLE_FONTS_BASE = "https://fonts.googleapis.com/css2?family=";

export const DEFAULT_DISPLAY_FONT_KEY = "instrument-serif";
export const DEFAULT_BODY_FONT_KEY = "instrument-sans";

/**
 * DISPLAY fonts — serif / high-character faces for headings and hero text.
 * Each non-system stack lists the real webfont first, then 2-3 email-safe
 * fallbacks, then a generic family.
 */
export const DISPLAY_FONTS: readonly FontDef[] = [
  {
    key: "instrument-serif",
    label: "Instrument Serif",
    role: "display",
    // Preserves today's default look byte-for-byte. Do not change.
    stack: "'Instrument Serif', Georgia, 'Times New Roman', 'DejaVu Serif', serif",
    importUrl:
      "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap",
  },
  {
    key: "fraunces",
    label: "Fraunces",
    role: "display",
    stack: "'Fraunces', Georgia, 'Times New Roman', serif",
    importUrl: `${GOOGLE_FONTS_BASE}Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&display=swap`,
  },
  {
    key: "playfair-display",
    label: "Playfair Display",
    role: "display",
    stack: "'Playfair Display', Georgia, 'Times New Roman', serif",
    importUrl: `${GOOGLE_FONTS_BASE}Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap`,
  },
  {
    key: "libre-baskerville",
    label: "Libre Baskerville",
    role: "display",
    stack: "'Libre Baskerville', Georgia, 'Times New Roman', serif",
    importUrl: `${GOOGLE_FONTS_BASE}Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap`,
  },
  {
    key: "dm-serif-display",
    label: "DM Serif Display",
    role: "display",
    stack: "'DM Serif Display', Georgia, 'Times New Roman', serif",
    importUrl: `${GOOGLE_FONTS_BASE}DM+Serif+Display:ital@0;1&display=swap`,
  },
  {
    key: "space-grotesk",
    label: "Space Grotesk",
    role: "display",
    // Grotesk display face — sans-safe fallbacks for emails.
    stack: "'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    importUrl: `${GOOGLE_FONTS_BASE}Space+Grotesk:wght@400;500;600;700&display=swap`,
  },
];

/**
 * BODY fonts — sans-serif faces for paragraph and UI copy. One pure-system
 * entry ("system-sans") has `importUrl: null` and a native font stack.
 */
export const BODY_FONTS: readonly FontDef[] = [
  {
    key: "instrument-sans",
    label: "Instrument Sans",
    role: "body",
    // Preserves today's default look byte-for-byte. Do not change.
    stack:
      "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    importUrl:
      "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap",
  },
  {
    key: "inter",
    label: "Inter",
    role: "body",
    stack: "'Inter', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    importUrl: `${GOOGLE_FONTS_BASE}Inter:wght@400;500;600;700&display=swap`,
  },
  {
    key: "work-sans",
    label: "Work Sans",
    role: "body",
    stack: "'Work Sans', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    importUrl: `${GOOGLE_FONTS_BASE}Work+Sans:wght@400;500;600;700&display=swap`,
  },
  {
    key: "dm-sans",
    label: "DM Sans",
    role: "body",
    stack: "'DM Sans', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    importUrl: `${GOOGLE_FONTS_BASE}DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap`,
  },
  {
    key: "source-sans-3",
    label: "Source Sans 3",
    role: "body",
    stack: "'Source Sans 3', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    importUrl: `${GOOGLE_FONTS_BASE}Source+Sans+3:wght@400;500;600;700&display=swap`,
  },
  {
    key: "system-sans",
    label: "System Default",
    role: "body",
    // Pure-system stack — no webfont to load, so importUrl is null.
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    importUrl: null,
  },
];

const DISPLAY_BY_KEY: ReadonlyMap<string, FontDef> = new Map(
  DISPLAY_FONTS.map((f) => [f.key, f]),
);
const BODY_BY_KEY: ReadonlyMap<string, FontDef> = new Map(
  BODY_FONTS.map((f) => [f.key, f]),
);

const DEFAULT_DISPLAY_FONT = DISPLAY_BY_KEY.get(DEFAULT_DISPLAY_FONT_KEY)!;
const DEFAULT_BODY_FONT = BODY_BY_KEY.get(DEFAULT_BODY_FONT_KEY)!;

/**
 * Resolve a display-font key to its FontDef, falling back to the default
 * display font when the key is missing or unknown.
 */
export function resolveDisplayFont(key: string | null | undefined): FontDef {
  return (key && DISPLAY_BY_KEY.get(key)) || DEFAULT_DISPLAY_FONT;
}

/**
 * Resolve a body-font key to its FontDef, falling back to the default body
 * font when the key is missing or unknown.
 */
export function resolveBodyFont(key: string | null | undefined): FontDef {
  return (key && BODY_BY_KEY.get(key)) || DEFAULT_BODY_FONT;
}

/**
 * Combined, de-duplicated, order-stable list of `@import` URLs for a
 * display+body pair. Skips null importUrls (pure system stacks) and dedupes
 * if both fonts resolve to the same URL. Order is display-then-body.
 * Used by the landing + email renderers.
 */
export function fontImportsFor(
  displayKey: string | null | undefined,
  bodyKey: string | null | undefined,
): string[] {
  const urls = [
    resolveDisplayFont(displayKey).importUrl,
    resolveBodyFont(bodyKey).importUrl,
  ];
  const out: string[] = [];
  for (const url of urls) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
