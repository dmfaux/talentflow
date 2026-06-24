import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import {
  authorizeApiBrand,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { validateSlug } from "@/lib/slug";
import { assertThemeAvailableForBrand, freezeCampaignTheme } from "@/lib/theme";
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

    // Campaign-level theme override (CT3). `null` inherits the brand default at
    // render; a non-null id must be in THIS campaign's brand availability set.
    // Validated here (not via allowedFields) and resolved before the freeze below
    // so a publish-with-theme PATCH freezes the new override.
    if (body.theme_id !== undefined) {
      if (body.theme_id === null) {
        updates.theme_id = null;
      } else if (typeof body.theme_id !== "string" || !body.theme_id.trim()) {
        return error("theme_id must be a theme id or null");
      } else {
        const themeId = body.theme_id.trim();
        const verdict = await assertThemeAvailableForBrand(themeId, {
          id: existing.client_id,
          org_id: existing.org_id,
        });
        if (verdict) return error(verdict.message, verdict.status);
        updates.theme_id = themeId;
      }
    }

    // Auto-set timestamps on status transitions
    if (body.status && body.status !== existing.status) {
      if (body.status === "active") {
        updates.campaign_start = new Date();
        // Freeze the resolved theme on the draft→active transition (CT1, RD-1).
        // Keyed on the transition (not on any active edit), so editing an
        // already-active campaign never re-freezes; a genuine active→draft→active
        // republish re-freezes the then-current theme. resolveOwnedResource did
        // NOT eager-load the client, so load the theming columns separately.
        const client = await db.query.clients.findFirst({
          where: eq(clients.id, existing.client_id),
          columns: {
            default_theme_id: true,
            branding_logo_url: true,
            logo_background: true,
            logo_position: true,
          },
        });
        updates.theme_snapshot = await freezeCampaignTheme({
          // A publish PATCH may set theme_id in the same request — prefer the
          // in-request value (incl. an explicit null) over the stored one.
          theme_id:
            "theme_id" in updates
              ? (updates.theme_id as string | null)
              : existing.theme_id,
          client: client ?? null,
        });
      }
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
