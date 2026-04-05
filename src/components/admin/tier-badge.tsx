"use client";

export type Tier = "standard" | "premium" | "enterprise";

export const TIER_VALUES: Tier[] = ["standard", "premium", "enterprise"];

export function isValidTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIER_VALUES as string[]).includes(value);
}

const TIER_CLASSES: Record<Tier, string> = {
  standard: "bg-canvas-2 text-ink-muted",
  premium: "bg-cobalt-tint text-cobalt-deep",
  enterprise: "bg-vermillion-soft text-vermillion-deep",
};

const TIER_INLINE_STYLES: Record<Tier, React.CSSProperties> = {
  standard: {},
  premium: { backgroundColor: "#fff2c2", color: "#c29100" },
  enterprise: {},
};

interface TierBadgeProps {
  tier: Tier | string | null | undefined;
  size?: "sm" | "md";
}

export function TierBadge({ tier, size = "sm" }: TierBadgeProps) {
  const resolved: Tier = isValidTier(tier) ? tier : "standard";
  const label = resolved.toUpperCase();

  if (size === "md") {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] ${TIER_CLASSES[resolved]}`}
        style={TIER_INLINE_STYLES[resolved]}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] ${TIER_CLASSES[resolved]}`}
      style={TIER_INLINE_STYLES[resolved]}
    >
      {label}
    </span>
  );
}
