"use client";

import type { BrandingValues } from "./branding-section";

interface Props {
  values: BrandingValues;
  clientName: string;
  clientSlug: string;
}

// ── Contrast helpers ──────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
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

function contrastRatio(fg: string, bg: string): number | null {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return null;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function hexOrFallback(hex: string, fallback: string): string {
  return hexToRgb(hex) ? hex : fallback;
}

// ── Preview component ────────────────────────────────────────────────

export function LiveCampaignPreview({ values, clientName, clientSlug }: Props) {
  const primary = hexOrFallback(values.brand_primary_color, "#0b0f1c");
  const secondary = hexOrFallback(values.brand_secondary_color, "#f3f0e8");
  const accent = values.brand_accent_color ? hexOrFallback(values.brand_accent_color, primary) : primary;
  const text = hexOrFallback(values.brand_text_color, "#0b0f1c");

  const displayName = clientName.trim() || "Client";
  const subdomain = clientSlug.trim() || "client";

  // Contrast checks — warn if text vs white page OR text vs secondary is poor
  const textOnWhiteContrast = contrastRatio(text, "#ffffff");
  const textOnSecondaryContrast = contrastRatio(text, secondary);
  const lowContrast =
    (textOnWhiteContrast !== null && textOnWhiteContrast < 4.5) ||
    (textOnSecondaryContrast !== null && textOnSecondaryContrast < 3.5);

  const primaryRgb = hexToRgb(primary);
  const primaryButtonText =
    primaryRgb && relativeLuminance(primaryRgb) > 0.55 ? "#0b0f1c" : "#ffffff";

  const logoJustify = values.logo_position === "top-centre" ? "justify-center" : "justify-start";
  const logoBg =
    values.logo_background === "light"
      ? "#ffffff"
      : values.logo_background === "dark"
        ? "#0b0f1c"
        : "transparent";

  const logoInitial = displayName.charAt(0).toUpperCase();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
          Live Preview
        </span>
        {lowContrast && (
          <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-saffron">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 1L11 10H1L6 1z" />
              <path d="M6 5v2M6 8.5v.1" />
            </svg>
            Low contrast detected — this may be hard for candidates to read
          </span>
        )}
      </div>

      {/* Browser chrome */}
      <div
        className="overflow-hidden rounded-xl border border-border bg-paper"
        style={{ boxShadow: "0 12px 32px -16px rgba(11, 15, 28, 0.18)" }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-3 border-b border-border bg-canvas-2 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#d9b8b0]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#dfc9a0]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#b4c7a8]" />
          </div>
          <div className="flex-1">
            <div className="flex h-6 items-center justify-center rounded-md border border-border bg-paper px-3">
              <span className="font-mono text-[0.65rem] text-ink-muted">
                {subdomain}.talentstream.co.za
              </span>
            </div>
          </div>
        </div>

        {/* Page content — scaled */}
        <div className="relative overflow-hidden bg-paper">
          <div
            className="origin-top-left"
            style={{
              transform: "scale(0.65)",
              width: "153.85%", // 100 / 0.65
              marginBottom: "-35%", // compensate for scale
            }}
          >
            <FakeCampaignPage
              primary={primary}
              secondary={secondary}
              accent={accent}
              text={text}
              primaryButtonText={primaryButtonText}
              logoUrl={values.logo_url}
              logoBg={logoBg}
              logoJustify={logoJustify}
              logoInitial={logoInitial}
              displayName={displayName}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Fake campaign page ────────────────────────────────────────────────

function FakeCampaignPage({
  primary,
  secondary,
  accent,
  text,
  primaryButtonText,
  logoUrl,
  logoBg,
  logoJustify,
  logoInitial,
  displayName,
}: {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  primaryButtonText: string;
  logoUrl: string | null;
  logoBg: string;
  logoJustify: string;
  logoInitial: string;
  displayName: string;
}) {
  const mutedText = text + "b3"; // ~70% opacity

  return (
    <div className="w-full bg-white" style={{ color: text, fontFamily: "var(--font-instrument-sans)" }}>
      {/* Logo header */}
      <div
        className={`flex items-center border-b px-10 py-6 ${logoJustify}`}
        style={{ backgroundColor: logoBg, borderColor: "rgba(0,0,0,0.08)" }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-10 max-w-[220px] object-contain" />
        ) : (
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-semibold"
            style={{ backgroundColor: primary, color: primaryButtonText, fontFamily: "var(--font-fraunces)" }}
          >
            {logoInitial}
          </div>
        )}
      </div>

      {/* Hero */}
      <div className="relative px-10 py-12">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em]"
          style={{
            backgroundColor: accent,
            color:
              hexToRgb(accent) && relativeLuminance(hexToRgb(accent)!) > 0.55
                ? "#0b0f1c"
                : "#ffffff",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />
          Now Hiring
        </span>

        <h1
          className="mt-5 text-5xl font-medium tracking-tight"
          style={{ fontFamily: "var(--font-fraunces)", color: primary }}
        >
          Senior Product Manager
        </h1>
        <p className="mt-3 text-base" style={{ color: mutedText }}>
          Join {displayName}&apos;s growing team
        </p>

        <p className="mt-6 max-w-2xl text-[0.95rem] leading-relaxed" style={{ color: text }}>
          We&apos;re looking for a senior product leader to help shape the roadmap of our
          flagship platform. You&apos;ll partner with engineering, design, and commercial
          teams to ship products that customers love and that move the needle for the business.
        </p>

        <button
          type="button"
          className="mt-8 inline-flex items-center gap-2 rounded-lg px-7 py-3.5 text-[0.95rem] font-medium transition-transform"
          style={{ backgroundColor: primary, color: primaryButtonText }}
        >
          Apply Now
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </button>
      </div>

      {/* Gating questions section (uses secondary colour) */}
      <div className="px-10 py-12" style={{ backgroundColor: secondary }}>
        <h2
          className="text-2xl font-medium"
          style={{ fontFamily: "var(--font-fraunces)", color: text }}
        >
          A few quick questions
        </h2>
        <p className="mt-2 text-sm" style={{ color: mutedText }}>
          Help us understand your fit for the role.
        </p>

        <div className="mt-6 grid grid-cols-3 gap-4">
          {[
            "Years of product management experience",
            "Have you led a cross-functional team before?",
            "Are you based in or willing to relocate to Cape Town?",
          ].map((q, i) => (
            <div
              key={i}
              className="rounded-xl border bg-white p-5"
              style={{ borderColor: "rgba(0,0,0,0.08)" }}
            >
              <div
                className="mb-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-[0.7rem] font-semibold"
                style={{ backgroundColor: accent, color: "#ffffff" }}
              >
                {i + 1}
              </div>
              <p className="text-sm leading-snug" style={{ color: text }}>
                {q}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-10 py-6" style={{ backgroundColor: "#ffffff" }}>
        <p className="font-mono text-[0.7rem]" style={{ color: mutedText }}>
          Powered by TalentStream · POPIA compliant
        </p>
      </div>
    </div>
  );
}
