import { db } from "@/db";
import { clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { eq } from "drizzle-orm";
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
      columns: { id: true },
    });
    if (!existing) return error("Client not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    const allowedFields = [
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
