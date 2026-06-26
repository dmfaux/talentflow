import * as React from "react";

/**
 * Badge / status pill — the soft-tint formula from DESIGN.md, in one place.
 *
 * Every badge is: tinted background + matching deep text + a thin matching-hue
 * border, and ALWAYS carries a text label (children) — so meaning is never
 * conveyed by colour alone (WCAG 2.2 AA; candidates are a broad public audience).
 * The optional `dot` is supplemental reinforcement, not the signal itself.
 *
 * Replaces the divergence where the same status rendered as a tinted pill on
 * detail pages but bare coloured text in tables, and the mid-tone status text
 * (text-warning ~2.9:1, text-vermillion ~1.6:1) that failed AA — here the text is
 * always the AA-safe `-deep` variant on its soft tint.
 */

export type BadgeTone = "neutral" | "cobalt" | "moss" | "saffron" | "red" | "teal";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-canvas-2 text-ink-muted border-rule",
  cobalt: "bg-cobalt-tint text-cobalt-deep border-cobalt/20",
  moss: "bg-moss-soft text-moss-deep border-moss/30",
  saffron: "bg-saffron-soft text-saffron-deep border-saffron/30",
  red: "bg-red-light text-red border-red/25",
  teal: "bg-vermillion-soft text-vermillion-deep border-vermillion/25",
};

const DOTS: Record<BadgeTone, string> = {
  neutral: "bg-ink-faint",
  cobalt: "bg-cobalt",
  moss: "bg-moss",
  saffron: "bg-saffron",
  red: "bg-red",
  teal: "bg-vermillion-deep",
};

interface BadgeProps {
  tone?: BadgeTone;
  /** Leading status dot — reinforces meaning beyond colour. */
  dot?: boolean;
  /** Uppercase tracked treatment, for tier badges and label-style chips. */
  uppercase?: boolean;
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}

export function Badge({
  tone = "neutral",
  dot = false,
  uppercase = false,
  size = "md",
  className = "",
  children,
}: BadgeProps) {
  const sizing = size === "sm" ? "px-2 py-0.5 text-[0.62rem]" : "px-2.5 py-0.5 text-[0.7rem]";
  const treatment = uppercase ? "uppercase tracking-[0.12em] font-semibold" : "font-medium";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${TONES[tone]} ${sizing} ${treatment} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}
