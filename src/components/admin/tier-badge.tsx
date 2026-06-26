"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";

export type Tier = "standard" | "premium" | "enterprise";

export const TIER_VALUES: Tier[] = ["standard", "premium", "enterprise"];

export function isValidTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIER_VALUES as string[]).includes(value);
}

// Standard = neutral; Premium = Cobalt tint; Enterprise = Teal (the rare "notice"
// signal, here as a deliberate top-tier accent). Routed through the shared Badge
// so the soft-tint formula + border are consistent and there are no off-token
// hardcoded hex overrides.
const TIER_TONE: Record<Tier, BadgeTone> = {
  standard: "neutral",
  premium: "cobalt",
  enterprise: "teal",
};

interface TierBadgeProps {
  tier: Tier | string | null | undefined;
  size?: "sm" | "md";
}

export function TierBadge({ tier, size = "sm" }: TierBadgeProps) {
  const resolved: Tier = isValidTier(tier) ? tier : "standard";
  return (
    <Badge tone={TIER_TONE[resolved]} size={size} uppercase>
      {resolved.toUpperCase()}
    </Badge>
  );
}
