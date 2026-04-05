import { db } from "@/db";
import { clients, templates } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { eq } from "drizzle-orm";
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
        is_active: templates.is_active,
        created_at: templates.created_at,
        updated_at: templates.updated_at,
      })
      .from(templates)
      .leftJoin(clients, eq(templates.owner_client_id, clients.id))
      .where(eq(templates.id, id))
      .limit(1);

    if (!row) return error("Template not found", 404);

    return success(row);
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

    const existing = await db.query.templates.findFirst({
      where: eq(templates.id, id),
      columns: { id: true },
    });
    if (!existing) return error("Template not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };

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

    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return error("is_active must be a boolean");
      }
      updates.is_active = body.is_active;
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
      .set({ is_active: false, updated_at: new Date() })
      .where(eq(templates.id, id))
      .returning();

    return success(row);
  } catch (err) {
    console.error("DELETE /api/admin/templates/[id] error:", err);
    return error("Internal server error", 500);
  }
}
