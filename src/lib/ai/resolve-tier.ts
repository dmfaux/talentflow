// ── Model-intelligence tier resolver ────────────────────────────────
//
// Turns a *requested* tier (the campaign's selected_model_tier) into the tier
// we actually bill + the concrete model id to run, applying two rules:
//   • Chat is HARD-PINNED to Essential — the cheapest model, always — regardless
//     of the campaign tier or caps (owner's decision; see docs/pricing-model.md).
//   • Scoring clamps the request DOWN to min(operator cap, org cap). The campaign
//     tier is already chosen under the org cap in the UI, so this is defence in
//     depth against a stale Executive selection left behind by a lowered cap.
// Pure (no DB / IO) so it is cheap to unit-test; callers supply the caps.

import { TIERS, type ModelTier } from "@/lib/pricing";

export type CallType = "chat" | "scoring";

/** Intelligence rank — higher = more capable + more credits. */
const TIER_RANK: Record<ModelTier, number> = {
  essential: 0,
  professional: 1,
  executive: 2,
};

/** Type guard: is `value` one of the three valid model tiers? Keyed off the
 *  canonical `TIERS` map so there is one source of truth. */
export function isModelTier(value: string | null | undefined): value is ModelTier {
  return value != null && value in TIERS;
}

/**
 * Coerce a free-text / nullable tier string (DB column, request body) to a valid
 * ModelTier, defaulting to Professional — the same fallback `tierForModel` uses,
 * so an unknown value always prices to a tier and never crashes.
 */
export function asModelTier(value: string | null | undefined): ModelTier {
  return isModelTier(value) ? value : "professional";
}

/** Clamp `requested` down to the most restrictive of the supplied caps. */
export function clampTier(requested: ModelTier, ...caps: ModelTier[]): ModelTier {
  return caps.reduce(
    (acc, cap) => (TIER_RANK[cap] < TIER_RANK[acc] ? cap : acc),
    requested,
  );
}

export interface TierCaps {
  /** organizations.operator_max_model_tier — the vendor cap. */
  operatorMax: ModelTier;
  /** organizations.max_model_tier — the owner's cap (expected ≤ the operator cap). */
  orgMax: ModelTier;
}

/** No-clamp default — used by chat (which ignores caps) and as a safety net. */
const NO_CAP: TierCaps = { operatorMax: "executive", orgMax: "executive" };

/**
 * Resolve the billed tier + concrete model id for an AI call. Scoring callers
 * MUST pass real `caps`; chat callers may omit them (chat ignores caps entirely).
 */
export function resolveModelForTier(
  requested: ModelTier,
  callType: CallType,
  caps: TierCaps = NO_CAP,
): { tier: ModelTier; model: string } {
  const tier =
    callType === "chat"
      ? "essential"
      : clampTier(requested, caps.operatorMax, caps.orgMax);
  return { tier, model: TIERS[tier].model };
}
