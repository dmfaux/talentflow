import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  authorizeApiOrg,
  error,
  getApiTenant,
  requireApiAuth,
  success,
} from "@/lib/api";
import { resolveOwnedResource } from "@/lib/tenant";
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

// `tier` is operator-only (S5, Resolved Decision 4): a tenant editing a brand
// must not be able to self-escalate its tier, so it is excluded from the
// tenant-writable fields below and a body `tier` is ignored.

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
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may edit a brand.
  const denied = authorizeApiOrg(ctx, "manage_brand");
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await request.json();

    // Resolve the brand WITHIN the actor's org — a cross-org id → 404.
    const existing = await resolveOwnedResource(clients, id, ctx);
    if (!existing) return error("Client not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    // `tier` intentionally excluded — operator-only (see header note).
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
