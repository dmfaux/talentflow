import type { BrandColours } from "./ApplicationForm";

interface Props {
  message: string;
  brandColours: BrandColours;
  retryable: boolean;
  onRetry?: () => void;
}

export function ApplicationFormError({ message, brandColours, retryable, onRetry }: Props) {
  const primary = brandColours.primary || "#0b0f1c";
  const text = brandColours.text || "#0b0f1c";
  const errorRed = "#c02616";

  return (
    <div
      role="alert"
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
          backgroundColor: "#ffe0da",
          marginBottom: "1.25rem",
        }}
        aria-hidden="true"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={errorRed} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </svg>
      </div>

      <h2
        style={{
          fontFamily: "var(--font-fraunces), Georgia, serif",
          fontSize: "1.5rem",
          fontWeight: 500,
          color: primary,
          marginBottom: "0.625rem",
          letterSpacing: "-0.01em",
        }}
      >
        Something went wrong
      </h2>

      <p
        style={{
          fontSize: "0.95rem",
          lineHeight: 1.6,
          color: "rgba(11, 15, 28, 0.72)",
          maxWidth: "28rem",
          margin: "0 auto 1.25rem",
        }}
      >
        {message}
      </p>

      {retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.625rem 1.25rem",
            border: `1px solid ${primary}`,
            borderRadius: "0.5rem",
            backgroundColor: "#ffffff",
            color: primary,
            fontSize: "0.88rem",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "var(--font-instrument-sans), system-ui, sans-serif",
            transition: "background-color 150ms ease",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" />
            <path d="M13 3v3h-3" />
          </svg>
          Try again
        </button>
      )}
    </div>
  );
}

export default ApplicationFormError;
