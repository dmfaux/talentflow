import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { spendAlertSubscriptions } from "@/db/schema";
import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";

// Self-service spend-alert subscription (usage-based pricing, Phase 5). A user
// manages ONLY their own row for the current org: keyed (user_id, org_id). Gated
// by view_spend (org_admin+) — the same floor as the Usage & Spend page. The
// public unsubscribe route (token-only) lives at /api/spend-alert/unsubscribe.

type SubRow = typeof spendAlertSubscriptions.$inferSelect;

const DEFAULTS = {
  alert_on_threshold: false,
  threshold_pct: 80,
  alert_on_summary: false,
  summary_cadence: "monthly" as const,
  alert_on_hardcap: true,
  enabled: true,
};

function view(row: SubRow | null) {
  if (!row) return DEFAULTS;
  return {
    alert_on_threshold: row.alert_on_threshold,
    threshold_pct: row.threshold_pct ?? DEFAULTS.threshold_pct,
    alert_on_summary: row.alert_on_summary,
    summary_cadence: row.summary_cadence ?? DEFAULTS.summary_cadence,
    alert_on_hardcap: row.alert_on_hardcap,
    enabled: row.enabled,
  };
}

export async function GET() {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const denied = authorizeApiOrg(ctx, "view_spend");
  if (denied) return denied;
  if (!ctx.effectiveOrgId) return error("No organisation in context", 400);

  try {
    const row = await db.query.spendAlertSubscriptions.findFirst({
      where: and(
        eq(spendAlertSubscriptions.user_id, ctx.userId),
        eq(spendAlertSubscriptions.org_id, ctx.effectiveOrgId),
      ),
    });
    return success(view(row ?? null));
  } catch (err) {
    console.error("GET /api/admin/spend-subscription error:", err);
    return error("Internal server error", 500);
  }
}

export async function PUT(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const denied = authorizeApiOrg(ctx, "view_spend");
  if (denied) return denied;
  if (!ctx.effectiveOrgId) return error("No organisation in context", 400);

  try {
    const body = await request.json();

    const alertOnThreshold = !!body.alert_on_threshold;
    const alertOnSummary = !!body.alert_on_summary;
    const alertOnHardcap = !!body.alert_on_hardcap;
    const enabled = body.enabled === undefined ? true : !!body.enabled;

    let thresholdPct: number | null = null;
    if (alertOnThreshold) {
      const p = body.threshold_pct;
      if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > 100) {
        return error("threshold_pct must be an integer 1–100 when threshold alerts are on");
      }
      thresholdPct = p;
    }

    let summaryCadence: "weekly" | "monthly" | null = null;
    if (alertOnSummary) {
      if (body.summary_cadence !== "weekly" && body.summary_cadence !== "monthly") {
        return error("summary_cadence must be 'weekly' or 'monthly' when summaries are on");
      }
      summaryCadence = body.summary_cadence;
    }

    const [row] = await db
      .insert(spendAlertSubscriptions)
      .values({
        user_id: ctx.userId,
        org_id: ctx.effectiveOrgId,
        alert_on_threshold: alertOnThreshold,
        threshold_pct: thresholdPct,
        alert_on_summary: alertOnSummary,
        summary_cadence: summaryCadence,
        alert_on_hardcap: alertOnHardcap,
        enabled,
        unsubscribe_token: crypto.randomUUID(),
      })
      .onConflictDoUpdate({
        target: [spendAlertSubscriptions.user_id, spendAlertSubscriptions.org_id],
        set: {
          alert_on_threshold: alertOnThreshold,
          threshold_pct: thresholdPct,
          alert_on_summary: alertOnSummary,
          summary_cadence: summaryCadence,
          alert_on_hardcap: alertOnHardcap,
          enabled,
          updated_at: new Date(),
        },
      })
      .returning();

    return success(view(row));
  } catch (err) {
    console.error("PUT /api/admin/spend-subscription error:", err);
    return error("Internal server error", 500);
  }
}
