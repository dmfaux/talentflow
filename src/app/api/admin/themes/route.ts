import { db } from "@/db";
import { clients, themes } from "@/db/schema";
import { authorizeApiBrand, error, getApiTenant, success } from "@/lib/api";
import { resolveOwnedResource } from "@/lib/tenant";
import { and, desc, eq, or } from "drizzle-orm";
import { NextRequest } from "next/server";

// ── CT3 · Tenant theme availability feed ────────────────────────────
//
// The themes a tenant may pick for a campaign or set as a brand default: the
// shared GALLERY ∪ the addressed brand's own bespoke (decisions D-2/D-3), and
// only `is_active` ones. NEVER another org's or a sibling brand's bespoke — the
// `client_id = brandId` predicate is the cross-brand boundary. No tier filter is
// applied here: a Standard brand that still owns a custom theme (e.g. it was
// Premium and downgraded) sees it listed but the UI disables it and the write
// routes reject it (assertThemeAvailableForBrand). View-only, so any member of
// the addressed brand may read it.
//
// Brand selection: by default the active-brand context (`ctx.activeBrandId`).
// The brand-settings screen and the edit-mode wizard operate on a brand that may
// differ from the active one, so an explicit `?brand_id=` overrides it — gated by
// authorizeApiBrand so a caller can only request a brand they belong to.
export async function GET(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const requested = request.nextUrl.searchParams.get("brand_id");
    let brandId: string;
    if (requested) {
      // Org boundary first (authorizeApiBrand alone allows an owner/org_admin on
      // ANY brand id — it assumes the resource was already org-scoped), then the
      // membership/role check (a same-org non-member brand → 404).
      const owned = await resolveOwnedResource(clients, requested, ctx);
      if (!owned) return error("Brand not found", 404);
      const denied = await authorizeApiBrand(ctx, requested, "viewer");
      if (denied) return denied;
      brandId = requested;
    } else {
      if (!ctx.activeBrandId) {
        return error("Select a brand to view its themes", 400);
      }
      brandId = ctx.activeBrandId;
    }

    const rows = await db.query.themes.findMany({
      where: and(
        eq(themes.is_active, true),
        or(eq(themes.scope, "gallery"), eq(themes.client_id, brandId))
      ),
      columns: {
        id: true,
        name: true,
        scope: true,
        preview_image_url: true,
        show_powered_by: true,
      },
      orderBy: [desc(themes.created_at)],
    });

    return success(rows);
  } catch (err) {
    console.error("GET /api/admin/themes error:", err);
    return error("Internal server error", 500);
  }
}
