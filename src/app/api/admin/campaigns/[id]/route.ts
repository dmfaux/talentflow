import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import {
  authorizeApiBrand,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { validateSlug } from "@/lib/slug";
import { validateHtmlTemplate } from "@/lib/slots";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // S4: org-scope the read (keeps the client relation) → cross-org id 404s.
  // Was an UNSCOPED requireApiAuth read resolving any campaign by raw UUID.
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    const campaign = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, id), orgScope(campaigns, ctx)),
      with: { client: true },
    });

    if (!campaign) return error("Campaign not found", 404);

    // Get candidate counts by status (defence-in-depth org filter; the campaign
    // is already ownership-checked above).
    const statusCounts = await db
      .select({
        status: candidates.status,
        count: sql<number>`count(*)::int`,
      })
      .from(candidates)
      .where(and(eq(candidates.campaign_id, id), orgScope(candidates, ctx)))
      .groupBy(candidates.status);

    const candidate_counts: Record<string, number> = {};
    for (const row of statusCounts) {
      candidate_counts[row.status] = row.count;
    }

    return success({ ...campaign, candidate_counts });
  } catch (err) {
    console.error("GET /api/admin/campaigns/[id] error:", err);
    return error("Internal server error", 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json();

    // Resolve the campaign WITHIN the actor's org — a cross-org id → 404.
    const existing = await resolveOwnedResource(campaigns, id, ctx);
    if (!existing) return error("Campaign not found", 404);

    // RBAC: editing (incl. publishing draft → active) requires recruiter+ on
    // the campaign's brand. The publish_campaign min-role is also recruiter,
    // so a viewer/non-member is 403'd here before any status flip.
    const denied = await authorizeApiBrand(ctx, existing.client_id, "recruiter");
    if (denied) return denied;

    // Validate HTML template if provided
    if (body.html_template !== undefined && body.html_template) {
      const htmlCheck = validateHtmlTemplate(body.html_template);
      if (!htmlCheck.ok) return error(htmlCheck.errors.join("; "));
    }

    // Validate slug if provided
    if (body.slug !== undefined) {
      const slugCheck = validateSlug(body.slug);
      if (!slugCheck.valid) return error(slugCheck.error!);

      const slugTaken = await db.query.campaigns.findFirst({
        where: and(eq(campaigns.client_id, existing.client_id), eq(campaigns.slug, body.slug)),
        columns: { id: true },
      });
      if (slugTaken && slugTaken.id !== id) {
        return error("slug is already taken for this client");
      }
    }

    if (body.gating_config !== undefined && !Array.isArray(body.gating_config)) {
      return error("gating_config must be a JSON array");
    }

    if (
      body.scoring_rubric !== undefined &&
      (typeof body.scoring_rubric !== "object" ||
        body.scoring_rubric === null ||
        Array.isArray(body.scoring_rubric))
    ) {
      return error("scoring_rubric must be a JSON object");
    }

    // Build update payload
    const updates: Record<string, unknown> = { updated_at: new Date() };

    const allowedFields = [
      "slug",
      "role_title",
      "role_description",
      "department",
      "location",
      "employment_type",
      "status",
      "html_template",
      "design_brief",
      "gating_config",
      "scoring_rubric",
      "salary_range_min",
      "salary_range_max",
      "ghost_ttl_days",
    ] as const;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    // Auto-set timestamps on status transitions
    if (body.status && body.status !== existing.status) {
      if (body.status === "active") updates.campaign_start = new Date();
      if (body.status === "closed") updates.campaign_end = new Date();
    }

    const [row] = await db
      .update(campaigns)
      .set(updates)
      .where(eq(campaigns.id, id))
      .returning();

    return success(row);
  } catch (err) {
    console.error("PATCH /api/admin/campaigns/[id] error:", err);
    return error("Internal server error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    const existing = await resolveOwnedResource(campaigns, id, ctx);
    if (!existing) return error("Campaign not found", 404);

    const denied = await authorizeApiBrand(ctx, existing.client_id, "recruiter");
    if (denied) return denied;

    const [row] = await db
      .update(campaigns)
      .set({ status: "archived", updated_at: new Date() })
      .where(eq(campaigns.id, id))
      .returning();

    return success(row);
  } catch (err) {
    console.error("DELETE /api/admin/campaigns/[id] error:", err);
    return error("Internal server error", 500);
  }
}
