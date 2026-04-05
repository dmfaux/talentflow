import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { validateSlug } from "@/lib/slug";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const row = await db.query.clients.findFirst({
      where: eq(clients.id, id),
      with: { campaigns: true },
    });

    if (!row) return error("Client not found", 404);

    return success(row);
  } catch (err) {
    console.error("GET /api/admin/clients/[id] error:", err);
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

    const existing = await db.query.clients.findFirst({
      where: eq(clients.id, id),
      columns: { id: true, slug: true },
    });
    if (!existing) return error("Client not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    const allowedFields = [
      "slug",
      "name",
      "contact_name",
      "contact_email",
      "contact_phone",
      "billing_email",
      "branding_logo_url",
      "notes",
      "is_active",
    ] as const;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (updates.name !== undefined && (!updates.name || typeof updates.name !== "string" || !(updates.name as string).trim())) {
      return error("name cannot be empty");
    }

    // Validate slug change
    if (body.slug !== undefined && body.slug !== existing.slug) {
      const slugCheck = validateSlug(body.slug);
      if (!slugCheck.valid) return error(slugCheck.error!);

      const slugTaken = await db.query.clients.findFirst({
        where: eq(clients.slug, body.slug),
        columns: { id: true },
      });
      if (slugTaken && slugTaken.id !== id) return error("This slug is already taken");

      // Block slug change if client has campaigns with HTML templates
      const hasTemplates = await db.query.campaigns.findFirst({
        where: and(
          eq(campaigns.client_id, id),
          isNotNull(campaigns.html_template)
        ),
        columns: { id: true },
      });
      if (hasTemplates) {
        return error("Cannot change client slug while campaigns with generated HTML templates exist. The templates reference the current slug in their form action URLs.");
      }
    }

    const [row] = await db
      .update(clients)
      .set(updates)
      .where(eq(clients.id, id))
      .returning();

    return success(row);
  } catch (err) {
    console.error("PATCH /api/admin/clients/[id] error:", err);
    return error("Internal server error", 500);
  }
}
