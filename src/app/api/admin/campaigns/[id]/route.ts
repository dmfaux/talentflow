import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { validateSlug } from "@/lib/slug";
import { validateHtmlTemplate } from "@/lib/slots";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const campaign = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, id),
      with: { client: true },
    });

    if (!campaign) return error("Campaign not found", 404);

    // Get candidate counts by status
    const statusCounts = await db
      .select({
        status: candidates.status,
        count: sql<number>`count(*)::int`,
      })
      .from(candidates)
      .where(eq(candidates.campaign_id, id))
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
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    // Check campaign exists
    const existing = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, id),
      columns: { id: true, slug: true, status: true, client_id: true },
    });
    if (!existing) return error("Campaign not found", 404);

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
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const existing = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, id),
      columns: { id: true },
    });
    if (!existing) return error("Campaign not found", 404);

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
