import { db } from "@/db";
import { clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { validateSlug } from "@/lib/slug";
import { isLogoBackground, isLogoPosition, normaliseHexColor } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const COLOR_FIELDS = [
  "brand_primary_color",
  "brand_secondary_color",
  "brand_accent_color",
  "brand_text_color",
] as const;

const VALID_TIERS = ["standard", "premium", "enterprise"] as const;
function isValidTier(value: unknown): value is (typeof VALID_TIERS)[number] {
  return typeof value === "string" && (VALID_TIERS as readonly string[]).includes(value);
}

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
      "tier",
    ] as const;

    if (body.tier !== undefined && !isValidTier(body.tier)) {
      return error("tier must be 'standard', 'premium', or 'enterprise'");
    }

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    // Validate + normalise brand colours
    for (const field of COLOR_FIELDS) {
      if (body[field] === undefined) continue;
      if (body[field] === null || body[field] === "") {
        updates[field] = null;
        continue;
      }
      const normalised = normaliseHexColor(body[field]);
      if (!normalised) return error(`${field} must be a valid hex colour`);
      updates[field] = normalised;
    }

    if (body.logo_background !== undefined) {
      if (body.logo_background !== null && !isLogoBackground(body.logo_background)) {
        return error("logo_background must be 'light', 'dark', or 'transparent'");
      }
      updates.logo_background = body.logo_background;
    }
    if (body.logo_position !== undefined) {
      if (body.logo_position !== null && !isLogoPosition(body.logo_position)) {
        return error("logo_position must be 'top-left' or 'top-centre'");
      }
      updates.logo_position = body.logo_position;
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
