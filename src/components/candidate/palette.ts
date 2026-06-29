/**
 * Brand-derived palette for candidate-facing surfaces (chat + application
 * status). Every candidate page resolves its look from the client's four brand
 * colours so the chat the candidate lands in and the status page they came from
 * read as one identity. Shared so the two surfaces can never drift apart.
 */

export interface BrandColours {
  primary: string;
  secondary: string;
  accent: string | null;
  text: string;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastText(bg: string): string {
  return luminance(bg) > 0.55 ? "#11123c" : "#fafaf7";
}

/** Mix a colour toward white by a fraction (0–1) */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) =>
    Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

/** Derive a full palette from brand colours */
export function buildPalette(brand: BrandColours) {
  const p = brand.primary;
  const isLightPrimary = luminance(p) > 0.55;
  const sidebarBase = isLightPrimary ? brand.text : p;
  const sidebarIsDark = luminance(sidebarBase) <= 0.55;

  return {
    // Page & surface
    pageBg: brand.secondary,
    surfaceBg: "#ffffff",
    // Primary shades
    primary: p,
    primaryText: contrastText(p),
    primaryTint: tint(p, 0.92),
    primaryMid: tint(p, 0.8),
    primarySoft: tint(p, 0.6),
    // Text hierarchy using brand text colour
    textStrong: brand.text,
    textBody: tint(brand.text, 0.2),
    textMuted: tint(brand.text, 0.5),
    textFaint: tint(brand.text, 0.65),
    // Borders derived from secondary
    border: isLightPrimary ? tint(brand.text, 0.82) : tint(p, 0.82),
    borderLight: isLightPrimary ? tint(brand.text, 0.88) : tint(p, 0.88),
    // Bot bubble — white with subtle border
    botBubbleBg: "#ffffff",
    botBubbleBorder: isLightPrimary ? tint(brand.text, 0.85) : tint(p, 0.85),
    // Spinner
    spinnerTrack: tint(p, 0.85),
    spinnerHead: p,

    // ── Sidebar panel ──
    sidebarFrom: sidebarBase,
    sidebarTo: tint(sidebarBase, 0.1),
    sidebarText: sidebarIsDark ? "#ffffff" : "#11123c",
    sidebarTextSoft: sidebarIsDark
      ? "rgba(255,255,255,0.72)"
      : "rgba(17,18,60,0.6)",
    sidebarTextFaint: sidebarIsDark
      ? "rgba(255,255,255,0.4)"
      : "rgba(17,18,60,0.35)",
    sidebarDivider: sidebarIsDark
      ? "rgba(255,255,255,0.1)"
      : "rgba(17,18,60,0.1)",
    sidebarGlow: tint(p, sidebarIsDark ? 0.4 : 0.15),

    // ── User messages ──
    userBubbleBg: p,
    userBubbleText: contrastText(p),

    // ── Chat area ──
    chatBg: tint(sidebarBase, 0.965),
  };
}
