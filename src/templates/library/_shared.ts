// ── Shared helpers for library templates ────────────────────────────
// Contrast + logo helpers used across editorial / corporate / modern.

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const v = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v)) return null;
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Pick a high-contrast foreground (near-black or white) for the given hex bg.
 */
export function contrastText(bg: string): string {
  const rgb = hexToRgb(bg);
  if (!rgb) return "#ffffff";
  return relativeLuminance(rgb) > 0.55 ? "#0b0f1c" : "#ffffff";
}

/**
 * Produce an rgba() string from a hex + alpha (0..1). Falls back to
 * `rgba(11, 15, 28, alpha)` if the hex cannot be parsed.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(11, 15, 28, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// ── Metadata strip helper ──────────────────────────────────────────
export function joinMeta(parts: Array<string | null | undefined>): string[] {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

// ── Salary formatter ───────────────────────────────────────────────
export function formatSalary(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => {
    // Format as e.g. "R450 000" — ZAR with thin spaces, no decimals.
    return "R" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  };
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)} · per annum`;
  if (min != null) return `From ${fmt(min)} · per annum`;
  if (max != null) return `Up to ${fmt(max)} · per annum`;
  return null;
}

// ── Logo helpers ───────────────────────────────────────────────────

export type LogoBg = "light" | "dark" | "transparent";

export interface LogoConfig {
  url: string | null;
  name: string;
  background: LogoBg;
  size?: number;
}

/**
 * Wrapper style for the logo badge based on its background preference.
 * "light" = white tile, "dark" = near-black tile, "transparent" = subtle
 * tinted tile so the image still reads on unfamiliar backdrops.
 */
export function logoWrapperStyle(background: LogoBg, size: number): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "0.625rem",
    overflow: "hidden",
    flexShrink: 0,
  };
  if (background === "light") {
    return {
      ...base,
      backgroundColor: "#ffffff",
      border: "1px solid rgba(11, 15, 28, 0.08)",
      boxShadow: "0 2px 6px -2px rgba(11, 15, 28, 0.08)",
    };
  }
  if (background === "dark") {
    return {
      ...base,
      backgroundColor: "#0b0f1c",
      border: "1px solid rgba(255, 255, 255, 0.08)",
    };
  }
  // transparent — use a very subtle tint so the image never floats alone
  return {
    ...base,
    backgroundColor: "transparent",
    border: "1px solid rgba(11, 15, 28, 0.06)",
  };
}

/**
 * Initial-circle fallback for clients without a logo_url. Uses their
 * primary brand colour as the disc and pairs with a contrast-safe letter.
 */
export function initialCircleStyle(
  primary: string,
  size: number,
): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    backgroundColor: primary,
    color: contrastText(primary),
    fontFamily: "var(--font-fraunces), Georgia, serif",
    fontWeight: 500,
    fontSize: `${Math.round(size * 0.42)}px`,
    letterSpacing: "-0.01em",
    flexShrink: 0,
  };
}

export function firstInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}
