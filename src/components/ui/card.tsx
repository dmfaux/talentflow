import * as React from "react";

/**
 * Layout primitives — Card, SectionHeading, Stat, Skeleton.
 *
 * Card: flat at rest (1px rule border, NO ambient shadow — depth comes from tone:
 * navy frame → slate canvas → white surface). One padding scale. Never nest Cards.
 *
 * SectionHeading: a real semantic heading in Instrument Sans — replaces the
 * `.eyebrow` (tracked-uppercase micro-label) being misused AS section headings.
 *
 * Stat: a deliberately RESTRAINED metric (label + mono value + one evidence line).
 * The antidote to the hero-metric template — small, not a giant number, meant for
 * a compact row inside a decision-led layout, never a 4-up KPI wall.
 *
 * Skeleton: tone-based loading block (canvas-2) mirroring candidates/loading.tsx —
 * skeletons, not spinners.
 */

const PADDING = { none: "", sm: "p-5", md: "p-6", lg: "p-8" } as const;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: keyof typeof PADDING;
}
export function Card({ padding = "md", className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-rule bg-surface ${PADDING[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  /** Optional leading icon — inherits Ink Muted via currentColor; use stroke="currentColor". */
  icon?: React.ReactNode;
  /** Trailing action — a link or Button, e.g. "View all". */
  action?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
}
export function SectionHeading({
  title,
  subtitle,
  icon,
  action,
  as: Tag = "h2",
  className = "",
}: SectionHeadingProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="shrink-0 text-ink-muted">{icon}</span>}
        <div>
          <Tag className="text-sm font-semibold text-ink">{title}</Tag>
          {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  /** Supporting evidence — the "why", not another headline number. */
  sub?: string;
  className?: string;
}
export function Stat({ label, value, sub, className = "" }: StatProps) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-medium tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;
export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-canvas-2 ${className}`} aria-hidden="true" {...props} />;
}
