import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";

// Operator catalogue admin for the public pricing page (no billing effect).
// public_visible hides a plan's card entirely; show_pricing keeps the card but
// redacts price/credits behind a "let's talk" CTA. Both are read by the home
// route, which is statically rendered — so a successful PATCH revalidates "/".

// Display order for the canonical tiers; unknown tiers sort last.
const TIER_ORDER: Record<string, number> = {
  standard: 0,
  premium: 1,
  enterprise: 2,
};

// GET /api/operator/plans — every plan + its commercials and visibility flags.
export async function GET() {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;
  void ctx;

  try {
    const rows = await db.select().from(plans);
    rows.sort(
      (a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
    );
    return success({ plans: rows });
  } catch (err) {
    console.error("GET /api/operator/plans error:", err);
    return error("Internal server error", 500);
  }
}

// PATCH /api/operator/plans — toggle a plan's public_visible / show_pricing.
// Each changed flag writes its own point-in-time audit row ({tier, field,
// from, to}); target_org_id stays null (global catalogue config).
export async function PATCH(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const body = await request.json();

    if (typeof body.tier !== "string") {
      return error("tier is required");
    }
    const plan = await db.query.plans.findFirst({
      where: eq(plans.tier, body.tier),
    });
    if (!plan) return error("Plan not found", 404);

    const updates: Partial<typeof plan> = {};
    for (const field of ["public_visible", "show_pricing"] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== "boolean") {
          return error(`${field} must be a boolean`);
        }
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return error("No editable fields supplied (public_visible, show_pricing)");
    }

    const [row] = await db
      .update(plans)
      .set({ ...updates, updated_at: new Date() })
      .where(eq(plans.tier, body.tier))
      .returning();

    // Audit each flag that actually changed.
    const now = new Date();
    const ip = clientIp(request);
    for (const field of ["public_visible", "show_pricing"] as const) {
      if (updates[field] !== undefined && updates[field] !== plan[field]) {
        await recordOperatorAudit({
          operatorUserId: ctx.userId,
          action: "set_plan_visibility",
          metadata: { tier: plan.tier, field, from: plan[field], to: updates[field] },
          ip,
          endedAt: now,
        });
      }
    }

    // The public pricing page is statically rendered off these flags — purge it
    // so the change is live without a redeploy.
    revalidatePath("/");

    return success(row);
  } catch (err) {
    console.error("PATCH /api/operator/plans error:", err);
    return error("Internal server error", 500);
  }
}
