import { db } from "@/db";
import { clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { slugify, validateSlug } from "@/lib/slug";
import { asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const rows = await db
      .select()
      .from(clients)
      .orderBy(asc(clients.name));
    return success(rows);
  } catch (err) {
    console.error("GET /api/admin/clients error:", err);
    return error("Internal server error", 500);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return error("name is required");
    }

    const slug = body.slug ? String(body.slug).trim() : slugify(body.name);
    const slugCheck = validateSlug(slug);
    if (!slugCheck.valid) return error(slugCheck.error!);

    const slugTaken = await db.query.clients.findFirst({
      where: eq(clients.slug, slug),
      columns: { id: true },
    });
    if (slugTaken) return error("This slug is already taken");

    const [row] = await db
      .insert(clients)
      .values({
        slug,
        name: body.name.trim(),
        contact_name: body.contact_name ?? null,
        contact_email: body.contact_email ?? null,
        contact_phone: body.contact_phone ?? null,
        billing_email: body.billing_email ?? null,
        branding_logo_url: body.branding_logo_url ?? null,
        notes: body.notes ?? null,
        is_active: body.is_active ?? true,
      })
      .returning();

    return success(row, 201);
  } catch (err) {
    console.error("POST /api/admin/clients error:", err);
    return error("Internal server error", 500);
  }
}
