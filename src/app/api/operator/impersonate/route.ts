import { db } from "@/db";
import { organizations } from "@/db/schema";
import {
  ACT_AS_COOKIE,
  ACT_AS_MAX_AGE,
  signActAsToken,
} from "@/lib/auth";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { closeOpenActAsSessions, recordOperatorAudit } from "@/lib/operator-audit";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// POST /api/operator/impersonate — begin acting as an org.
//
// Mints the short-lived act-as cookie (read by the seam → effectiveOrgId =
// orgId, so all S4/S5 scoping transparently applies) and audits the start.
// Any org status is allowed — operators must support suspended / soft-deleted
// tenants (Resolved Decision 5); a hard-purged org's row is gone → natural 404.
export async function POST(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const body = await request.json().catch(() => ({}));
    const orgId = body?.orgId;
    if (typeof orgId !== "string" || !orgId) {
      return error("orgId is required");
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { id: true, slug: true, name: true, status: true },
    });
    if (!org) return error("Organization not found", 404);

    // Switching target: close any open session first so they never overlap.
    await closeOpenActAsSessions(ctx.userId);
    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: "impersonate",
      targetOrgId: org.id,
      metadata: { slug: org.slug, name: org.name, status: org.status },
      ip: clientIp(request),
      // ended_at stays null — closed on exit / re-impersonate.
    });

    const token = await signActAsToken(ctx.userId, org.id);
    const res = success({ orgId: org.id, slug: org.slug, name: org.name });
    res.cookies.set(ACT_AS_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ACT_AS_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error("POST /api/operator/impersonate error:", err);
    return error("Internal server error", 500);
  }
}
