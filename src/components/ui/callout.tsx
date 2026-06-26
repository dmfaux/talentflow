import * as React from "react";

/**
 * Callout — a block-level status message in the soft-tint formula (tinted bg +
 * matching deep text + thin matching-hue border). The block-level companion to
 * Badge: use it for inline result/error/success messages instead of flat
 * `bg-cream` boxes or bare coloured text (both of which recur across surfaces and
 * fail the status-as-callout rule).
 */

type Tone = "info" | "success" | "warning" | "error";

const TONES: Record<Tone, string> = {
  info: "bg-cobalt-tint text-cobalt-deep border-cobalt/20",
  success: "bg-moss-soft text-moss-deep border-moss/30",
  warning: "bg-saffron-soft text-saffron-deep border-saffron/30",
  error: "bg-red-light text-red border-red/25",
};

interface CalloutProps {
  tone?: Tone;
  /** Optional leading icon (use stroke="currentColor" to inherit the tone). */
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Callout({ tone = "info", icon, className = "", children }: CalloutProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-lg border px-4 py-2.5 text-sm ${TONES[tone]} ${className}`}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
