// Shared utility functions

/**
 * Validates a hex colour string (with or without leading #) and returns a
 * normalised value prefixed with "#". Accepts 3- or 6-digit hex values.
 * Returns null if the input is not a valid hex colour.
 */
export function normaliseHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(withoutHash)) return null;
  return `#${withoutHash.toLowerCase()}`;
}

const LOGO_BACKGROUNDS = ["light", "dark", "transparent"] as const;
const LOGO_POSITIONS = ["top-left", "top-centre"] as const;

export function isLogoBackground(v: unknown): v is (typeof LOGO_BACKGROUNDS)[number] {
  return typeof v === "string" && (LOGO_BACKGROUNDS as readonly string[]).includes(v);
}

export function isLogoPosition(v: unknown): v is (typeof LOGO_POSITIONS)[number] {
  return typeof v === "string" && (LOGO_POSITIONS as readonly string[]).includes(v);
}
