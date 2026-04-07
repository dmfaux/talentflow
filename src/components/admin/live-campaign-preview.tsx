"use client";

import { useState } from "react";
import type { BrandingValues } from "./branding-section";

interface Props {
  values: BrandingValues;
  clientName: string;
  clientSlug: string;
}

type ViewMode = "desktop" | "mobile";

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
  const [viewMode, setViewMode] = useState<ViewMode>("desktop");

  const primary = hexOrFallback(values.brand_primary_color, "#11123c");
  const secondary = hexOrFallback(values.brand_secondary_color, "#f0f3f7");
  const accent = values.brand_accent_color ? hexOrFallback(values.brand_accent_color, primary) : primary;
  const text = hexOrFallback(values.brand_text_color, "#11123c");

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
    primaryRgb && relativeLuminance(primaryRgb) > 0.55 ? "#11123c" : "#ffffff";

  const logoJustify = values.logo_position === "top-centre" ? "justify-center" : "justify-start";
  const logoBg =
    values.logo_background === "light"
      ? "#ffffff"
      : values.logo_background === "dark"
        ? "#11123c"
        : "transparent";

  const logoInitial = displayName.charAt(0).toUpperCase();

  const isMobile = viewMode === "mobile";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
          Live Preview
        </span>
        <div className="flex items-center gap-2">
          {lowContrast && (
            <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-saffron">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 1L11 10H1L6 1z" />
                <path d="M6 5v2M6 8.5v.1" />
              </svg>
              Low contrast
            </span>
          )}
          <div
            className="inline-flex items-center rounded-md border border-border bg-canvas-2 p-0.5"
            role="group"
            aria-label="Preview device"
          >
            <button
              type="button"
              onClick={() => setViewMode("desktop")}
              aria-pressed={viewMode === "desktop"}
              aria-label="Desktop preview"
              title="Desktop"
              className={`inline-flex h-6 w-7 items-center justify-center rounded transition-colors ${
                viewMode === "desktop"
                  ? "bg-paper text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
                <path d="M6 14h4M8 11.5V14" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("mobile")}
              aria-pressed={viewMode === "mobile"}
              aria-label="Mobile preview"
              title="Mobile"
              className={`inline-flex h-6 w-7 items-center justify-center rounded transition-colors ${
                viewMode === "mobile"
                  ? "bg-paper text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="1.5" width="8" height="13" rx="1.5" />
                <path d="M7 12.5h2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isMobile ? (
        <div className="flex justify-center rounded-xl border border-border bg-canvas-2 px-6 py-6">
          {/* Phone frame */}
          <div
            className="overflow-hidden rounded-[1.75rem] border-[6px] border-[#11123c] bg-paper"
            style={{ width: "280px", boxShadow: "0 12px 32px -16px rgba(17, 18, 60, 0.35)" }}
          >
            {/* Status bar */}
            <div className="relative flex items-center justify-between bg-white px-5 pb-1 pt-1.5">
              <span className="font-mono text-[0.6rem] font-semibold text-[#11123c]">9:41</span>
              {/* Notch */}
              <div className="absolute left-1/2 top-0 h-3 w-14 -translate-x-1/2 rounded-b-xl bg-[#11123c]" />
              <div className="flex items-center gap-1">
                <svg width="10" height="7" viewBox="0 0 10 7" fill="currentColor" className="text-[#11123c]">
                  <rect x="0" y="5" width="1.5" height="2" rx="0.3" />
                  <rect x="2.2" y="3.5" width="1.5" height="3.5" rx="0.3" />
                  <rect x="4.4" y="2" width="1.5" height="5" rx="0.3" />
                  <rect x="6.6" y="0.5" width="1.5" height="6.5" rx="0.3" />
                </svg>
                <svg width="12" height="7" viewBox="0 0 12 7" fill="none" stroke="currentColor" strokeWidth="0.8" className="text-[#11123c]">
                  <rect x="0.4" y="0.9" width="9.5" height="5.2" rx="1" />
                  <rect x="1.6" y="2.1" width="7.1" height="2.8" rx="0.3" fill="currentColor" />
                  <path d="M10.6 2.4v2.2" strokeLinecap="round" />
                </svg>
              </div>
            </div>
            {/* Page content — scaled to fit mobile frame */}
            <div className="relative overflow-hidden bg-paper">
              <div
                className="origin-top-left"
                style={{
                  transform: "scale(0.715)",
                  width: "139.86%", // 100 / 0.715
                  marginBottom: "-40%",
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
                  isMobile
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Browser chrome */
        <div
          className="overflow-hidden rounded-xl border border-border bg-paper"
          style={{ boxShadow: "0 12px 32px -16px rgba(17, 18, 60, 0.18)" }}
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
      )}
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
  isMobile = false,
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
  isMobile?: boolean;
}) {
  const mutedText = text + "b3"; // ~70% opacity

  // Responsive sizing — mobile uses tighter padding, smaller type, stacked grid
  const headerPadding = isMobile ? "px-5 py-5" : "px-10 py-6";
  const sectionPadding = isMobile ? "px-5 py-8" : "px-10 py-12";
  const footerPadding = isMobile ? "px-5 py-5" : "px-10 py-6";
  const heroTitleSize = isMobile ? "text-3xl" : "text-5xl";
  const heroCopySize = isMobile ? "text-sm" : "text-[0.95rem]";
  const subheadSize = isMobile ? "text-xl" : "text-2xl";
  const logoSize = isMobile ? "h-8 max-w-[180px]" : "h-10 max-w-[220px]";
  const logoInitialSize = isMobile ? "h-9 w-9 text-base" : "h-11 w-11 text-lg";
  const questionsGrid = isMobile ? "grid-cols-1 gap-3" : "grid-cols-3 gap-4";
  const questionCardPadding = isMobile ? "p-4" : "p-5";

  return (
    <div className="w-full bg-white" style={{ color: text, fontFamily: "var(--font-instrument-sans)" }}>
      {/* Logo header */}
      <div
        className={`flex items-center border-b ${headerPadding} ${logoJustify}`}
        style={{ backgroundColor: logoBg, borderColor: "rgba(0,0,0,0.08)" }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className={`${logoSize} object-contain`} />
        ) : (
          <div
            className={`flex items-center justify-center rounded-full font-semibold ${logoInitialSize}`}
            style={{ backgroundColor: primary, color: primaryButtonText, fontFamily: "var(--font-fraunces)" }}
          >
            {logoInitial}
          </div>
        )}
      </div>

      {/* Hero */}
      <div className={`relative ${sectionPadding}`}>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em]"
          style={{
            backgroundColor: accent,
            color:
              hexToRgb(accent) && relativeLuminance(hexToRgb(accent)!) > 0.55
                ? "#11123c"
                : "#ffffff",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />
          Now Hiring
        </span>

        <h1
          className={`mt-5 font-medium tracking-tight ${heroTitleSize}`}
          style={{ fontFamily: "var(--font-fraunces)", color: primary }}
        >
          Senior Product Manager
        </h1>
        <p className="mt-3 text-base" style={{ color: mutedText }}>
          Join {displayName}&apos;s growing team
        </p>

        <p className={`mt-6 max-w-2xl leading-relaxed ${heroCopySize}`} style={{ color: text }}>
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
      <div className={sectionPadding} style={{ backgroundColor: secondary }}>
        <h2
          className={`font-medium ${subheadSize}`}
          style={{ fontFamily: "var(--font-fraunces)", color: text }}
        >
          A few quick questions
        </h2>
        <p className="mt-2 text-sm" style={{ color: mutedText }}>
          Help us understand your fit for the role.
        </p>

        <div className={`mt-6 grid ${questionsGrid}`}>
          {[
            "Years of product management experience",
            "Have you led a cross-functional team before?",
            "Are you based in or willing to relocate to Cape Town?",
          ].map((q, i) => (
            <div
              key={i}
              className={`rounded-xl border bg-white ${questionCardPadding}`}
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
      <div className={footerPadding} style={{ backgroundColor: "#ffffff" }}>
        <p className="font-mono text-[0.7rem]" style={{ color: mutedText }}>
          Powered by TalentStream · POPIA compliant
        </p>
      </div>
    </div>
  );
}
