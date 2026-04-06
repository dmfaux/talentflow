import { db } from "@/db";
import { campaigns, clients, templates } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { validateHtmlTemplate } from "@/lib/templates/slots";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const [row] = await db
      .select({
        id: templates.id,
        key: templates.key,
        name: templates.name,
        description: templates.description,
        thumbnail_url: templates.thumbnail_url,
        owner_client_id: templates.owner_client_id,
        owner_client_name: clients.name,
        owner_client_slug: clients.slug,
        status: templates.status,
        html_template: templates.html_template,
        published_html_template: templates.published_html_template,
        published_at: templates.published_at,
        preview_token: templates.preview_token,
        preview_token_expires_at: templates.preview_token_expires_at,
        created_at: templates.created_at,
        updated_at: templates.updated_at,
      })
      .from(templates)
      .leftJoin(clients, eq(templates.owner_client_id, clients.id))
      .where(eq(templates.id, id))
      .limit(1);

    if (!row) return error("Template not found", 404);

    const [counts] = await db
      .select({
        active: sql<number>`count(*) filter (where ${campaigns.status} = 'active')`.as("active"),
        total: sql<number>`count(*)`.as("total"),
      })
      .from(campaigns)
      .where(eq(campaigns.template_id, id));

    return success({
      ...row,
      active_campaign_count: Number(counts?.active ?? 0),
      total_campaign_count: Number(counts?.total ?? 0),
    });
  } catch (err) {
    console.error("GET /api/admin/templates/[id] error:", err);
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

    if (body.key !== undefined) {
      return error("key cannot be changed after creation");
    }
    if (body.status !== undefined) {
      return error(
        "status cannot be changed here — use POST /api/admin/templates/[id]/transition"
      );
    }

    const existing = await db.query.templates.findFirst({
      where: eq(templates.id, id),
      columns: { id: true, status: true },
    });
    if (!existing) return error("Template not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (body.html_template !== undefined) {
      if (existing.status !== "draft") {
        return error(
          `html_template can only be edited when status='draft' (current: '${existing.status}'). Transition to draft first.`
        );
      }
      if (body.html_template === null) {
        return error("html_template cannot be cleared");
      }
      if (typeof body.html_template !== "string") {
        return error("html_template must be a string");
      }
      const validated = validateHtmlTemplate(body.html_template);
      if (!validated.ok) {
        return error(
          `html_template validation failed: ${validated.errors.join("; ")}`
        );
      }
      updates.html_template = body.html_template;
    }

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return error("name cannot be empty");
      }
      updates.name = body.name.trim();
    }

    if (body.description !== undefined) {
      if (body.description === null || body.description === "") {
        updates.description = null;
      } else if (typeof body.description !== "string") {
        return error("description must be a string");
      } else {
        updates.description = body.description.trim() || null;
      }
    }

    if (body.thumbnail_url !== undefined) {
      if (body.thumbnail_url === null || body.thumbnail_url === "") {
        updates.thumbnail_url = null;
      } else if (typeof body.thumbnail_url !== "string") {
        return error("thumbnail_url must be a string");
      } else {
        updates.thumbnail_url = body.thumbnail_url.trim() || null;
      }
    }

    if (body.owner_client_id !== undefined) {
      if (body.owner_client_id === null || body.owner_client_id === "") {
        updates.owner_client_id = null;
      } else {
        if (
          typeof body.owner_client_id !== "string" ||
          !UUID_REGEX.test(body.owner_client_id)
        ) {
          return error("owner_client_id must be a valid uuid");
        }
        const clientExists = await db.query.clients.findFirst({
          where: eq(clients.id, body.owner_client_id),
          columns: { id: true },
        });
        if (!clientExists) return error("owner_client_id references unknown client");
        updates.owner_client_id = body.owner_client_id;
      }
    }

    const [row] = await db
      .update(templates)
      .set(updates)
      .where(eq(templates.id, id))
      .returning();

    return success(row);
  } catch (err) {
    console.error("PATCH /api/admin/templates/[id] error:", err);
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

    const existing = await db.query.templates.findFirst({
      where: eq(templates.id, id),
      columns: { id: true },
    });
    if (!existing) return error("Template not found", 404);

    const [row] = await db
      .update(templates)
      .set({
        status: "archived",
        preview_token: null,
        preview_token_expires_at: null,
        updated_at: new Date(),
      })
      .where(eq(templates.id, id))
      .returning();

    return success(row);
  } catch (err) {
    console.error("DELETE /api/admin/templates/[id] error:", err);
    return error("Internal server error", 500);
  }
}
