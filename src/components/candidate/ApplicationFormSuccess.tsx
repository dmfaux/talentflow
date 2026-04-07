import type { BrandColours } from "./ApplicationForm";

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

interface Props {
  message: string;
  brandColours: BrandColours;
  clientName?: string;
}

export function ApplicationFormSuccess({ message, brandColours, clientName }: Props) {
  const primary = brandColours.primary || "#11123c";
  const text = brandColours.text || "#11123c";

  const iconColour = "#067340";
  const iconBg = "#d3ecd9";

  const primaryRgb = hexToRgb(primary);
  const primaryButtonText = primaryRgb && relativeLuminance(primaryRgb) > 0.55 ? "#11123c" : "#ffffff";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        fontFamily: "var(--font-instrument-sans), system-ui, sans-serif",
        color: text,
        textAlign: "center",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "3.5rem",
          height: "3.5rem",
          borderRadius: "999px",
          backgroundColor: iconBg,
          marginBottom: "1.25rem",
        }}
        aria-hidden="true"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={iconColour} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2
        style={{
          fontFamily: "var(--font-fraunces), Georgia, serif",
          fontSize: "1.75rem",
          fontWeight: 500,
          color: primary,
          marginBottom: "0.625rem",
          letterSpacing: "-0.01em",
        }}
      >
        Application received
      </h2>

      <p
        style={{
          fontSize: "0.95rem",
          lineHeight: 1.6,
          color: "rgba(17, 18, 60, 0.72)",
          maxWidth: "28rem",
          margin: "0 auto 1.25rem",
        }}
      >
        {message}
      </p>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.875rem",
          borderRadius: "999px",
          backgroundColor: "#d3ecd9",
          color: "#04562f",
          fontSize: "0.78rem",
          fontWeight: 500,
          fontFamily: "var(--font-jetbrains-mono), monospace",
          letterSpacing: "0.02em",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M2.5 6.5L5 9l4.5-6" />
        </svg>
        CV uploaded successfully
      </div>

      {clientName && (
        <p
          style={{
            marginTop: "1.75rem",
            fontSize: "0.78rem",
            color: "rgba(17, 18, 60, 0.45)",
            fontFamily: "var(--font-jetbrains-mono), monospace",
            letterSpacing: "0.03em",
          }}
        >
          {clientName} · POPIA compliant
        </p>
      )}

      {/* Keep primary-color reference visually available */}
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 0,
          height: 0,
          color: primaryButtonText,
        }}
      />
    </div>
  );
}

export default ApplicationFormSuccess;
