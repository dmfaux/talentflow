import { db } from "@/db";
import { clients, organizations, themes } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { assertThemeAssignable } from "@/lib/theme";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// POST /api/operator/clients/[id]/default-theme — set (or clear) a brand's
// default campaign theme. Body `{ theme_id: string | null }`.
//
// Guard: the target theme must be in the brand's availability set — a gallery
// theme, or the brand's OWN bespoke theme (never another brand's/org's) — AND, if
// custom, the brand's org must be Premium+ (assertThemeAssignable). `theme_id:
// null` clears the default, degrading the brand to gallery/default inheritance.
// Audited as set_brand_default_theme with {from, to} (RD-4). This is the ONLY
// CT2 path that writes clients.default_theme_id; the tenant write is CT3.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json();

    const brand = await db.query.clients.findFirst({
      where: eq(clients.id, id),
      columns: { id: true, org_id: true, slug: true, default_theme_id: true },
    });
    if (!brand) return error("Brand not found", 404);

    const writeDefault = async (themeId: string | null) => {
      const [row] = await db
        .update(clients)
        .set({ default_theme_id: themeId, updated_at: new Date() })
        .where(eq(clients.id, id))
        .returning();
      await recordOperatorAudit({
        operatorUserId: ctx.userId,
        action: "set_brand_default_theme",
        targetOrgId: brand.org_id,
        metadata: { from: brand.default_theme_id, to: themeId, brand: brand.slug },
        ip: clientIp(request),
        endedAt: new Date(),
      });
      return row;
    };

    // Clear the default → no availability check needed.
    if (body.theme_id === null) {
      return success(await writeDefault(null));
    }

    if (typeof body.theme_id !== "string" || !body.theme_id.trim()) {
      return error("theme_id must be a theme id or null");
    }
    const themeId = body.theme_id.trim();

    const theme = await db.query.themes.findFirst({
      where: eq(themes.id, themeId),
      columns: { id: true, scope: true, client_id: true },
    });
    if (!theme) return error("Theme not found", 404);

    // Premium+ gate reads the authoritative ORG tier (clients.tier is a legacy
    // mirror that is never written — see theme-fields.isPremiumTier).
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, brand.org_id),
      columns: { tier: true },
    });
    const verdict = assertThemeAssignable({
      theme: { scope: theme.scope, client_id: theme.client_id },
      brandId: brand.id,
      tier: org?.tier ?? null,
    });
    if (!verdict.ok) return error(verdict.message, verdict.status);

    return success(await writeDefault(themeId));
  } catch (err) {
    console.error("POST /api/operator/clients/[id]/default-theme error:", err);
    return error("Internal server error", 500);
  }
}
