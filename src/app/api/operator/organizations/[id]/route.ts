import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  invitations,
  organizations,
  plans,
  themes,
  usageEvents,
  users,
} from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { getOrgMargin } from "@/lib/pricing";
import { getCeilingStatus, resumeOrgIntake } from "@/lib/spend-ceiling";
import { isModelTier } from "@/lib/ai";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const USAGE_KINDS = [
  "ai_tokens",
  "campaign_created",
  "candidate_created",
  "chat_message",
  "email_sent",
] as const;

type UsageByKind = Record<
  (typeof USAGE_KINDS)[number],
  { count: number; inputTokens: number; outputTokens: number }
>;

const TIERS = ["standard", "premium", "enterprise"] as const;
type Tier = (typeof TIERS)[number];
const isTier = (v: unknown): v is Tier =>
  typeof v === "string" && (TIERS as readonly string[]).includes(v);

// GET /api/operator/organizations/[id] — org detail + derived counts + usage.
//
// Counts (brands/campaigns/candidates) plus the S10 per-org usage aggregate:
// last-30-day per-kind volume + token sums, with all-time token totals.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;
  void ctx;

  try {
    const { id } = await params;

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    if (!org) return error("Organisation not found", 404);

    // The tier's plan defaults — shown as placeholders next to the per-org
    // override inputs so an operator can see what each blank field inherits.
    const planDefaults = await db.query.plans.findFirst({
      where: eq(plans.tier, org.tier),
      columns: {
        base_fee_zar: true,
        included_credits: true,
        overage_discount_pct: true,
        hard_ceiling_credits: true,
      },
    });

    // Per-org usage aggregate (S10), windowed to the last 30 days, plus
    // all-time token totals for context. Uses usage_events_org_kind_idx /
    // usage_events_org_created_idx. Metering read — not an audited mutation.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Onboarding status (S9): the accepted Owner vs the pending org-level Owner
    // invite, so the detail page can render "owner active" vs "invite / resend".
    const [[brands], [camps], [cands], owner, pendingInvite, usageRows, [allTime], margin] =
      await Promise.all([
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(clients)
          .where(eq(clients.org_id, id)),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(eq(campaigns.org_id, id)),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(candidates)
          .where(eq(candidates.org_id, id)),
        db.query.users.findFirst({
          where: and(
            eq(users.org_id, id),
            eq(users.org_role, "owner"),
            eq(users.is_operator, false)
          ),
          columns: { id: true, email: true, first_name: true, last_name: true },
        }),
        db.query.invitations.findFirst({
          where: and(
            eq(invitations.org_id, id),
            eq(invitations.org_role, "owner"),
            isNull(invitations.accepted_at),
            gt(invitations.expires_at, new Date())
          ),
          columns: { email: true, expires_at: true },
        }),
        db
          .select({
            kind: usageEvents.kind,
            count: sql<number>`sum(${usageEvents.quantity})::int`,
            inputTokens: sql<number>`coalesce(sum(${usageEvents.input_tokens}), 0)::int`,
            outputTokens: sql<number>`coalesce(sum(${usageEvents.output_tokens}), 0)::int`,
          })
          .from(usageEvents)
          .where(and(eq(usageEvents.org_id, id), gt(usageEvents.created_at, since)))
          .groupBy(usageEvents.kind),
        db
          .select({
            inputTokens: sql<number>`coalesce(sum(${usageEvents.input_tokens}), 0)::int`,
            outputTokens: sql<number>`coalesce(sum(${usageEvents.output_tokens}), 0)::int`,
          })
          .from(usageEvents)
          .where(eq(usageEvents.org_id, id)),
        // Operator-only billed-vs-cost margin (last 30d). Raw cost never leaves
        // the operator shell — getOrgMargin takes a raw orgId by design.
        getOrgMargin(id, 30),
      ]);

    // Shape rows into a fixed-key map so the UI never has to guard on missing
    // kinds (an org with no events reports zeros, not an error).
    const byKind = Object.fromEntries(
      USAGE_KINDS.map((k) => [k, { count: 0, inputTokens: 0, outputTokens: 0 }])
    ) as UsageByKind;
    let periodInput = 0;
    let periodOutput = 0;
    for (const row of usageRows) {
      if (row.kind in byKind) {
        byKind[row.kind as keyof UsageByKind] = {
          count: row.count,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
        };
      }
      periodInput += row.inputTokens;
      periodOutput += row.outputTokens;
    }

    // The org's brands + each brand's current default theme (CT2) — the Themes
    // card on the org-detail page assigns defaults and links to bespoke builds.
    // Premium-gating is decided from org.tier (returned above), server-enforced.
    const brandRows = await db
      .select({
        id: clients.id,
        name: clients.name,
        slug: clients.slug,
        default_theme_id: clients.default_theme_id,
        default_theme_name: themes.name,
        default_theme_scope: themes.scope,
      })
      .from(clients)
      .leftJoin(themes, eq(clients.default_theme_id, themes.id))
      .where(eq(clients.org_id, id))
      .orderBy(asc(clients.name));

    return success({
      ...org,
      planDefaults: planDefaults ?? null,
      counts: {
        brands: brands.total,
        campaigns: camps.total,
        candidates: cands.total,
      },
      brands: brandRows,
      owner: owner ?? null,
      pendingInvite: pendingInvite ?? null,
      usage: {
        period: "30d",
        byKind,
        tokens: { input: periodInput, output: periodOutput },
        allTime: { input: allTime.inputTokens, output: allTime.outputTokens },
      },
      // Operator-only billed spend + raw cost + margin (last 30d).
      spend: {
        period: "30d",
        credits: margin.credits,
        billedExVat: margin.billedExVat,
        rawCostZar: margin.rawCostZar,
        marginZar: margin.marginZar,
        marginPct: margin.marginPct,
      },
    });
  } catch (err) {
    console.error("GET /api/operator/organizations/[id] error:", err);
    return error("Internal server error", 500);
  }
}

// PATCH /api/operator/organizations/[id] — operator sets tier / billing_email.
//
// tier lives on the org (the authoritative copy); clients.tier is a legacy
// mirror dropped in S13 and is NOT touched here. Each changed field writes its
// own point-in-time operator_audit row with {from,to} metadata.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json();

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    if (!org) return error("Organisation not found", 404);

    const updates: Record<string, unknown> = {};

    if (body.tier !== undefined) {
      if (!isTier(body.tier)) {
        return error("tier must be 'standard', 'premium', or 'enterprise'");
      }
      updates.tier = body.tier;
    }

    if (body.billing_email !== undefined) {
      if (body.billing_email !== null && typeof body.billing_email !== "string") {
        return error("billing_email must be a string or null");
      }
      const trimmed =
        typeof body.billing_email === "string"
          ? body.billing_email.trim() || null
          : null;
      updates.billing_email = trimmed;
    }

    // Usage-based pricing caps. operator_max_model_tier is the vendor ceiling on
    // model intelligence; hard_ceiling_credits is the per-period spend cap.
    if (body.operator_max_model_tier !== undefined) {
      if (!isModelTier(body.operator_max_model_tier)) {
        return error(
          "operator_max_model_tier must be essential, professional, or executive"
        );
      }
      updates.operator_max_model_tier = body.operator_max_model_tier;
    }

    if (body.hard_ceiling_credits !== undefined) {
      const hc = body.hard_ceiling_credits;
      if (
        hc !== null &&
        (typeof hc !== "number" || !Number.isInteger(hc) || hc < 0)
      ) {
        return error("hard_ceiling_credits must be a non-negative integer or null");
      }
      updates.hard_ceiling_credits = hc;
    }

    // Per-org negotiated plan overrides (null = inherit the tier's plan default).
    // base_fee_zar / included_credits are non-negative integers; the overage
    // discount is a 0–100 percentage. priceInvoice coalesces override ?? plan.
    for (const field of [
      "base_fee_zar",
      "included_credits",
      "overage_discount_pct",
    ] as const) {
      if (body[field] === undefined) continue;
      const v = body[field];
      const max = field === "overage_discount_pct" ? 100 : Number.MAX_SAFE_INTEGER;
      if (
        v !== null &&
        (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max)
      ) {
        return error(
          field === "overage_discount_pct"
            ? "overage_discount_pct must be an integer 0–100 or null"
            : `${field} must be a non-negative integer or null`
        );
      }
      updates[field] = v;
    }

    if (Object.keys(updates).length === 0) {
      return error(
        "No editable fields supplied (tier, billing_email, operator_max_model_tier, hard_ceiling_credits, base_fee_zar, included_credits, overage_discount_pct)"
      );
    }

    updates.updated_at = new Date();
    const [row] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, id))
      .returning();

    // Independently audit each changed field (point-in-time → ended_at = now).
    const now = new Date();
    const ip = clientIp(request);
    if (updates.tier !== undefined && updates.tier !== org.tier) {
      await recordOperatorAudit({
        operatorUserId: ctx.userId,
        action: "set_tier",
        targetOrgId: id,
        metadata: { from: org.tier, to: updates.tier, slug: org.slug },
        ip,
        endedAt: now,
      });
    }
    if (
      updates.billing_email !== undefined &&
      updates.billing_email !== org.billing_email
    ) {
      await recordOperatorAudit({
        operatorUserId: ctx.userId,
        action: "set_billing_email",
        targetOrgId: id,
        metadata: {
          from: org.billing_email,
          to: updates.billing_email,
          slug: org.slug,
        },
        ip,
        endedAt: now,
      });
    }
    if (
      updates.operator_max_model_tier !== undefined &&
      updates.operator_max_model_tier !== org.operator_max_model_tier
    ) {
      await recordOperatorAudit({
        operatorUserId: ctx.userId,
        action: "set_org_caps",
        targetOrgId: id,
        metadata: {
          field: "operator_max_model_tier",
          from: org.operator_max_model_tier,
          to: updates.operator_max_model_tier,
          slug: org.slug,
        },
        ip,
        endedAt: now,
      });
    }
    if (
      updates.hard_ceiling_credits !== undefined &&
      updates.hard_ceiling_credits !== org.hard_ceiling_credits
    ) {
      await recordOperatorAudit({
        operatorUserId: ctx.userId,
        action: "set_org_caps",
        targetOrgId: id,
        metadata: {
          field: "hard_ceiling_credits",
          from: org.hard_ceiling_credits,
          to: updates.hard_ceiling_credits,
          slug: org.slug,
        },
        ip,
        endedAt: now,
      });
    }
    for (const field of [
      "base_fee_zar",
      "included_credits",
      "overage_discount_pct",
    ] as const) {
      if (updates[field] !== undefined && updates[field] !== org[field]) {
        await recordOperatorAudit({
          operatorUserId: ctx.userId,
          action: "set_org_plan_override",
          targetOrgId: id,
          metadata: { field, from: org[field], to: updates[field], slug: org.slug },
          ip,
          endedAt: now,
        });
      }
    }

    // If the spend ceiling moved and the org is no longer over it, drain the
    // held backlog (Phase 4 resume).
    if (
      updates.hard_ceiling_credits !== undefined &&
      !(await getCeilingStatus(id)).over
    ) {
      await resumeOrgIntake(id);
    }

    return success(row);
  } catch (err) {
    console.error("PATCH /api/operator/organizations/[id] error:", err);
    return error("Internal server error", 500);
  }
}
