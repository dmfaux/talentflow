import { db } from "@/db";
import { clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { slugify, validateSlug } from "@/lib/slug";
import { isLogoBackground, isLogoPosition, normaliseHexColor } from "@/lib/utils";
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

const COLOR_FIELDS = [
  "brand_primary_color",
  "brand_secondary_color",
  "brand_accent_color",
  "brand_text_color",
] as const;

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

    // Validate + normalise brand colours
    const normalisedColors: Record<string, string | null> = {};
    for (const field of COLOR_FIELDS) {
      const raw = body[field];
      if (raw === undefined || raw === null || raw === "") {
        normalisedColors[field] = null;
        continue;
      }
      const normalised = normaliseHexColor(raw);
      if (!normalised) return error(`${field} must be a valid hex colour`);
      normalisedColors[field] = normalised;
    }

    if (body.logo_background !== undefined && body.logo_background !== null && !isLogoBackground(body.logo_background)) {
      return error("logo_background must be 'light', 'dark', or 'transparent'");
    }
    if (body.logo_position !== undefined && body.logo_position !== null && !isLogoPosition(body.logo_position)) {
      return error("logo_position must be 'top-left' or 'top-centre'");
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const providedId = typeof body.id === "string" && UUID_REGEX.test(body.id) ? body.id : undefined;

    const [row] = await db
      .insert(clients)
      .values({
        ...(providedId ? { id: providedId } : {}),
        slug,
        name: body.name.trim(),
        contact_name: body.contact_name ?? null,
        contact_email: body.contact_email ?? null,
        contact_phone: body.contact_phone ?? null,
        billing_email: body.billing_email ?? null,
        branding_logo_url: body.branding_logo_url ?? null,
        brand_primary_color: normalisedColors.brand_primary_color,
        brand_secondary_color: normalisedColors.brand_secondary_color,
        brand_accent_color: normalisedColors.brand_accent_color,
        brand_text_color: normalisedColors.brand_text_color ?? "#0b0f1c",
        logo_background: body.logo_background ?? "light",
        logo_position: body.logo_position ?? "top-left",
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
