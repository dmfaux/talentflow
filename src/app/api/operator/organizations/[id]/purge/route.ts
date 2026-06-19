import { db } from "@/db";
import { organizations } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { purgeOrganizationData } from "@/lib/popia";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// POST /api/operator/organizations/[id]/purge — the irreversible hard purge.
//
// Defence in depth beyond the UI modal: operator-only (requireApiOperator),
// allowed ONLY from 'deleted' (the soft-delete interlock — Decision C), and
// gated on a typed-slug confirmation in the body ({ confirm: "<org-slug>" }).
// Cascades every org-scoped row + wipes cvs/{orgId}/** and logos/{orgId}/**.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    // Already-purged (row gone) or never existed → 404 (idempotent for re-runs).
    if (!org) return error("Organisation not found", 404);

    // Interlock: a tenant must be soft-deleted first. An active/suspended org
    // cannot be hard-purged in one step.
    if (org.status !== "deleted") {
      return error(
        "An organisation must be soft-deleted before it can be purged",
        409
      );
    }

    // Typed-slug confirmation — the operator must echo the exact slug.
    if (typeof body?.confirm !== "string" || body.confirm !== org.slug) {
      return error(`Type the organisation slug ("${org.slug}") to confirm`, 422);
    }

    // Snapshot identity BEFORE the cascade — operator_audit.target_org_id is
    // SET NULL on the org delete, so durability lives in metadata (Decision C).
    const { counts } = await purgeOrganizationData(id);

    // Recorded after a successful purge. target_org_id is null (the org is
    // gone); metadata.slug/name/counts keep the row queryable.
    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: "purge_org",
      targetOrgId: null,
      metadata: {
        slug: org.slug,
        name: org.name,
        status_before: org.status,
        counts,
      },
      ip: clientIp(request),
      endedAt: new Date(),
    });

    return success({ purged: true, slug: org.slug, counts });
  } catch (err) {
    console.error("POST /api/operator/organizations/[id]/purge error:", err);
    return error("Internal server error", 500);
  }
}
