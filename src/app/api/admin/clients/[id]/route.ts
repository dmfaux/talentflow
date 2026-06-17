import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  authorizeApiBrand,
  authorizeApiOrg,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { validateSlug } from "@/lib/slug";
import { isLogoBackground, isLogoPosition, normaliseHexColor } from "@/lib/utils";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const COLOR_FIELDS = [
  "brand_primary_color",
  "brand_secondary_color",
  "brand_accent_color",
  "brand_text_color",
] as const;

// Generic: never assert cross-org existence ("…taken" leaks that some other
// tenant owns the slug). Mirrors the POST route + S8's check-slug hardening.
const SLUG_UNAVAILABLE = "That slug isn't available";

// `tier` is operator-only (S5, Resolved Decision 4): a tenant editing a brand
// must not be able to self-escalate its tier, so it is excluded from the
// tenant-writable fields below and a body `tier` is ignored.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // S9: close the S4 read carry-over — was requireApiAuth() (signature-only),
  // resolving ANY brand by raw id. Now org-scoped: a cross-org/non-acting id → 404.
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    const row = await db.query.clients.findFirst({
      where: and(eq(clients.id, id), orgScope(clients, ctx)),
      with: { campaigns: true },
    });

    if (!row) return error("Brand not found", 404);

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

  try {
    const { id } = await params;
    const body = await request.json();

    // Resolve the brand WITHIN the actor's org — a cross-org id → 404.
    const existing = await resolveOwnedResource(clients, id, ctx);
    if (!existing) return error("Brand not found", 404);

    // ── Per-field RBAC split (S9 #5) ────────────────────────────────
    // The slug is the global careers namespace → org-level manage_brand
    // (org_admin+). Branding / careers / contact presentation → brand-level
    // brand_admin (a brand_admin manages THEIR brand; non-member → 404, slug → 403).
    const wantsSlugChange =
      body.slug !== undefined && body.slug !== existing.slug;
    if (wantsSlugChange) {
      const slugDenied = authorizeApiOrg(ctx, "manage_brand");
      if (slugDenied) return slugDenied;
    }
    const brandDenied = await authorizeApiBrand(ctx, existing.id, "brand_admin");
    if (brandDenied) return brandDenied;

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
    if (wantsSlugChange) {
      const slugCheck = validateSlug(body.slug);
      if (!slugCheck.valid) return error(slugCheck.error!);

      const slugTaken = await db.query.clients.findFirst({
        where: eq(clients.slug, body.slug),
        columns: { id: true },
      });
      if (slugTaken && slugTaken.id !== id) return error(SLUG_UNAVAILABLE);
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
