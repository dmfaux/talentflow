import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  invitations,
  organizations,
  users,
} from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const TIERS = ["standard", "premium", "enterprise"] as const;
type Tier = (typeof TIERS)[number];
const isTier = (v: unknown): v is Tier =>
  typeof v === "string" && (TIERS as readonly string[]).includes(v);

// GET /api/operator/organizations/[id] — org detail + derived counts.
//
// "Usage" in S7 is only the counts derivable today (brands/campaigns/
// candidates); AI/token metering is S10 (the UI shows a labelled placeholder).
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
    if (!org) return error("Organization not found", 404);

    // Onboarding status (S9): the accepted Owner vs the pending org-level Owner
    // invite, so the detail page can render "owner active" vs "invite / resend".
    const [[brands], [camps], [cands], owner, pendingInvite] = await Promise.all([
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
    ]);

    return success({
      ...org,
      counts: {
        brands: brands.total,
        campaigns: camps.total,
        candidates: cands.total,
      },
      owner: owner ?? null,
      pendingInvite: pendingInvite ?? null,
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
    if (!org) return error("Organization not found", 404);

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

    if (Object.keys(updates).length === 0) {
      return error("No editable fields supplied (tier, billing_email)");
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

    return success(row);
  } catch (err) {
    console.error("PATCH /api/operator/organizations/[id] error:", err);
    return error("Internal server error", 500);
  }
}
