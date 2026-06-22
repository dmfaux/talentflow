/**
 * theme-colors.ts — pure, dependency-free colour math for Campaign Themes.
 *
 * An operator picks 3 SEED colours (primary, accent, bg). This module derives
 * the full 11-token palette consumed by the landing/email renderers.
 *
 * ABSOLUTE: this module is self-contained. It imports NOTHING from the rest of
 * the app so that `theme-fields.ts` can import it without creating a cycle.
 * All output colours are valid lowercase `#rrggbb` strings.
 */

export interface ThemeSeeds {
  primary: string; // brand primary, e.g. "#2c5bff"
  accent: string; // accent/secondary, e.g. "#05dbd6"
  bg: string; // page background, e.g. "#f0f3f7"
}

/** The full 11-token palette consumed by the renderers. */
export interface DerivedPalette {
  bg: string;
  card: string;
  primary: string;
  primaryDeep: string;
  primaryTint: string;
  accent: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  inkFaint: string;
  border: string;
}

export const DEFAULT_THEME_SEEDS: ThemeSeeds = {
  primary: "#2c5bff",
  accent: "#05dbd6",
  bg: "#f0f3f7",
};

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Parse a `#rrggbb` (or `#rgb` short form) hex string into 0..255 channels.
 * Returns null for anything that is not a valid hex colour.
 */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== "string") return null;
  let s = hex.trim().toLowerCase();
  if (s.startsWith("#")) s = s.slice(1);

  if (/^[0-9a-f]{3}$/.test(s)) {
    // Expand short form: "abc" -> "aabbcc".
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }

  if (!/^[0-9a-f]{6}$/.test(s)) return null;

  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function channelToHex(value: number): string {
  const v = clamp(Math.round(value), 0, 255);
  return v.toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/**
 * Normalise an arbitrary hex string to lowercase `#rrggbb`, falling back to
 * `fallback` (assumed valid) when the input cannot be parsed.
 */
function normaliseHex(hex: string, fallback: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return fallback.toLowerCase();
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// ---------------------------------------------------------------------------
// Public colour conversions (unit-tested directly)
// ---------------------------------------------------------------------------

/** Convert a hex colour to HSL. h 0..360, s/l 0..100. Invalid input -> black. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  const l = (max + min) / 2;

  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
  }

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** Convert HSL (h 0..360, s/l 0..100) to a lowercase `#rrggbb` string. */
export function hslToHex(h: number, s: number, l: number): string {
  // Normalise inputs defensively.
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const lit = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Relative luminance per WCAG 2.x for a single 0..255 channel. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG contrast ratio between two colours. Returns 1..21. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Core derivation
// ---------------------------------------------------------------------------

/**
 * Walk an ink colour's lightness toward higher contrast against `card` until it
 * meets `threshold`, moving in steps of `step` L. `direction` is -1 for light
 * backgrounds (darker ink) and +1 for dark backgrounds (lighter ink).
 *
 * GUARANTEE: this is a guard, not a best-effort. If the hue-tinted lightness
 * walk cannot reach `threshold` against `card` (e.g. a saturated, mid-luminance
 * card that no tinted ink can clear), we fall back to whichever of pure black
 * (`#000000`) / pure white (`#ffffff`) MAXIMISES contrast against `card`. That
 * converts a silently unreadable result into the best achievable legible one.
 */
function ensureContrast(
  h: number,
  s: number,
  l: number,
  card: string,
  threshold: number,
  direction: number,
  step = 2,
  maxSteps = 40,
): string {
  let lightness = l;
  let hex = hslToHex(h, s, lightness);
  for (let i = 0; i < maxSteps; i++) {
    if (contrastRatio(hex, card) >= threshold) return hex;
    const next = clamp(lightness + direction * step, 0, 100);
    if (next === lightness) break; // hit the wall; can't improve further
    lightness = next;
    hex = hslToHex(h, s, lightness);
  }

  // The tinted walk met the threshold on the final step — keep the hue.
  if (contrastRatio(hex, card) >= threshold) return hex;

  // Tinted ink cannot clear the threshold; fall back to whichever pure
  // monochrome extreme is most legible against this card.
  const black = "#000000";
  const white = "#ffffff";
  return contrastRatio(white, card) >= contrastRatio(black, card) ? white : black;
}

/** Derive all 11 palette tokens from 3 seed colours. Never throws. */
export function derivePalette(seeds: ThemeSeeds): DerivedPalette {
  const raw = seeds ?? DEFAULT_THEME_SEEDS;

  const bg = normaliseHex(raw.bg, DEFAULT_THEME_SEEDS.bg);
  const primary = normaliseHex(raw.primary, DEFAULT_THEME_SEEDS.primary);
  const accent = normaliseHex(raw.accent, DEFAULT_THEME_SEEDS.accent);

  const bgHsl = hexToHsl(bg);
  const primaryHsl = hexToHsl(primary);

  const darkBg = bgHsl.l < 45;

  // card: a surface that sits on bg.
  //
  // For dark backgrounds we mirror the light branch in two ways:
  //  1. Cap saturation (a saturated, mid-luminance card is a contrast trap —
  //     neither pure white nor pure black ink can clear 7:1 against it).
  //  2. Cap lightness to a genuinely deep value. A mid-luminance card sits in a
  //     "dead zone" where no ink reaches 7:1; keeping the card dark (L <= 28 at
  //     this saturation) guarantees light ink clears the threshold for any hue,
  //     while still reading as an intentional raised panel above bg.
  const card = darkBg
    ? hslToHex(
        bgHsl.h,
        Math.min(bgHsl.s, 20),
        clamp(Math.min(bgHsl.l + 8, 28), 0, 100),
      )
    : hslToHex(bgHsl.h, Math.min(bgHsl.s, 12), 99);

  // primaryDeep: a darker, slightly richer primary.
  const primaryDeep = hslToHex(
    primaryHsl.h,
    clamp(primaryHsl.s + 4, 0, 100),
    clamp(primaryHsl.l - 14, 12, 100),
  );

  // primaryTint: a pale wash of primary.
  const primaryTint = darkBg
    ? hslToHex(primaryHsl.h, clamp(primaryHsl.s * 0.5, 20, 70), 22)
    : hslToHex(primaryHsl.h, clamp(primaryHsl.s * 0.45, 18, 60), 93);

  // Ink ramp: primary hue at low saturation, target lightnesses per mode.
  const inkS = clamp(primaryHsl.s * 0.35, 8, 30);
  const inkTargets = darkBg ? [96, 88, 72, 58] : [14, 24, 44, 62];
  const inkDirection = darkBg ? 1 : -1;

  const ink = ensureContrast(primaryHsl.h, inkS, inkTargets[0], card, 7.0, inkDirection);
  const inkSoft = ensureContrast(primaryHsl.h, inkS, inkTargets[1], card, 4.5, inkDirection);
  const inkMuted = ensureContrast(primaryHsl.h, inkS, inkTargets[2], card, 4.5, inkDirection);
  const inkFaint = hslToHex(primaryHsl.h, inkS, inkTargets[3]); // decorative, no guard

  // border: a quiet divider.
  const border = darkBg
    ? hslToHex(bgHsl.h, clamp(bgHsl.s, 6, 22), 30)
    : hslToHex(bgHsl.h, clamp(bgHsl.s, 6, 22), 86);

  return {
    bg,
    card,
    primary,
    primaryDeep,
    primaryTint,
    accent,
    ink,
    inkSoft,
    inkMuted,
    inkFaint,
    border,
  };
}
