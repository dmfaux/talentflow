import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { validateSlug } from "@/lib/slug";
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
  const authError = await requireApiAuth();
  if (authError) return authError;

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

    // Verify client exists
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, body.client_id),
      columns: { id: true },
    });
    if (!client) return error("Client not found", 404);

    // Check slug uniqueness per client
    const existing = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.client_id, body.client_id), eq(campaigns.slug, body.slug)),
      columns: { id: true },
    });
    if (existing) return error("slug is already taken for this client");

    const [row] = await db
      .insert(campaigns)
      .values({
        client_id: body.client_id,
        slug: body.slug,
        role_title: body.role_title,
        role_description: body.role_description ?? null,
        department: body.department ?? null,
        location: body.location ?? null,
        employment_type: body.employment_type ?? null,
        status: body.status ?? "draft",
        html_template: body.html_template ?? null,
        gating_config: body.gating_config,
        scoring_rubric: body.scoring_rubric,
        campaign_start: body.campaign_start ? new Date(body.campaign_start) : null,
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
