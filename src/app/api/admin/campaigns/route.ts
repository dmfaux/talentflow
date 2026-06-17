import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import {
  authorizeApiBrand,
  error,
  getApiTenant,
  requireApiAuth,
  success,
} from "@/lib/api";
import { resolveOwnedResource } from "@/lib/tenant";
import { validateSlug } from "@/lib/slug";
import { validateHtmlTemplate } from "@/lib/slots";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;
    const statusFilter = searchParams.get("status");
    const clientIdFilter = searchParams.get("client_id");

    const conditions = [];
    if (statusFilter) conditions.push(eq(campaigns.status, statusFilter));
    if (clientIdFilter) conditions.push(eq(campaigns.client_id, clientIdFilter));

    const rows = await db
      .select({
        id: campaigns.id,
        client_id: campaigns.client_id,
        client_name: clients.name,
        client_slug: clients.slug,
        slug: campaigns.slug,
        role_title: campaigns.role_title,
        department: campaigns.department,
        location: campaigns.location,
        employment_type: campaigns.employment_type,
        status: campaigns.status,
        campaign_start: campaigns.campaign_start,
        campaign_end: campaigns.campaign_end,
        salary_range_min: campaigns.salary_range_min,
        salary_range_max: campaigns.salary_range_max,
        created_at: campaigns.created_at,
        updated_at: campaigns.updated_at,
      })
      .from(campaigns)
      .leftJoin(clients, eq(campaigns.client_id, clients.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(campaigns.created_at));

    return success(rows);
  } catch (err) {
    console.error("GET /api/admin/campaigns error:", err);
    return error("Internal server error", 500);
  }
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const body = await request.json();

    // Required fields
    if (!body.client_id) return error("client_id is required");
    if (!body.slug) return error("slug is required");
    if (!body.role_title) return error("role_title is required");
    if (body.gating_config === undefined) return error("gating_config is required");
    if (body.scoring_rubric === undefined) return error("scoring_rubric is required");

    // Slug validation
    const slugCheck = validateSlug(body.slug);
    if (!slugCheck.valid) return error(slugCheck.error!);

    // gating_config must be an array
    if (!Array.isArray(body.gating_config)) {
      return error("gating_config must be a JSON array");
    }

    // scoring_rubric must be a plain object
    if (
      typeof body.scoring_rubric !== "object" ||
      body.scoring_rubric === null ||
      Array.isArray(body.scoring_rubric)
    ) {
      return error("scoring_rubric must be a JSON object");
    }

    // Validate HTML template if provided
    if (body.html_template) {
      const htmlCheck = validateHtmlTemplate(body.html_template);
      if (!htmlCheck.ok) return error(htmlCheck.errors.join("; "));
    }

    // Resolve the target brand WITHIN the actor's org (never trust body
    // client_id to widen scope). A cross-org/non-existent id → 404.
    const brand = await resolveOwnedResource(clients, body.client_id, ctx);
    if (!brand) return error("Client not found", 404);

    // RBAC: creating a campaign (incl. publishing straight to active) requires
    // recruiter+ on the brand. A viewer/non-member is 403'd here, which also
    // closes the publish gate for status === "active".
    const denied = await authorizeApiBrand(ctx, brand.id, "recruiter");
    if (denied) return denied;

    // Check slug uniqueness per client
    const existing = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.client_id, brand.id), eq(campaigns.slug, body.slug)),
      columns: { id: true },
    });
    if (existing) return error("slug is already taken for this client");

    const [row] = await db
      .insert(campaigns)
      .values({
        org_id: ctx.effectiveOrgId!,
        client_id: brand.id,
        slug: body.slug,
        role_title: body.role_title,
        role_description: body.role_description ?? null,
        department: body.department ?? null,
        location: body.location ?? null,
        employment_type: body.employment_type ?? null,
        status: body.status ?? "draft",
        html_template: body.html_template ?? null,
        design_brief: body.design_brief ?? null,
        gating_config: body.gating_config,
        scoring_rubric: body.scoring_rubric,
        ...(typeof body.ghost_ttl_days === "number"
          ? { ghost_ttl_days: body.ghost_ttl_days }
          : {}),
        campaign_start: body.campaign_start
          ? new Date(body.campaign_start)
          : body.status === "active"
            ? new Date()
            : null,
        campaign_end: body.campaign_end ? new Date(body.campaign_end) : null,
        salary_range_min: body.salary_range_min ?? null,
        salary_range_max: body.salary_range_max ?? null,
      })
      .returning();

    return success(row, 201);
  } catch (err) {
    console.error("POST /api/admin/campaigns error:", err);
    return error("Internal server error", 500);
  }
}
