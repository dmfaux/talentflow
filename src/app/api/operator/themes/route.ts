import { db } from "@/db";
import { themes } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { normaliseThemeFields } from "@/lib/theme-fields";
import { guardCustomThemeBrand } from "@/lib/theme";
import { desc, eq, or } from "drizzle-orm";
import { NextRequest } from "next/server";

// ── CT2 · Operator theme authoring console — create + list ──────────
//
// Operators (TalentStream staff) hand-build the shared GALLERY and per-brand
// CUSTOM themes (the managed/services model, decision 3). All mutations follow
// the operator precedent: requireApiOperator() → validate → mutate → audit.

// POST /api/operator/themes — create a gallery or bespoke theme.
export async function POST(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const body = await request.json();

    const result = normaliseThemeFields(body);
    if (!result.ok) return error(result.message, result.status);
    const values = result.values;

    // CUSTOM: assert the brand exists, belongs to org_id, and is Premium+.
    if (values.scope === "custom") {
      const guard = await guardCustomThemeBrand(values.org_id!, values.client_id!);
      if (guard) return error(guard.message, guard.status);
    }

    const [row] = await db
      .insert(themes)
      .values({
        org_id: values.org_id,
        client_id: values.client_id,
        name: values.name,
        scope: values.scope,
        palette: values.palette,
        font_display: values.font_display,
        font_sans: values.font_sans,
        logo_url: values.logo_url,
        logo_background: values.logo_background,
        logo_position: values.logo_position,
        show_powered_by: values.show_powered_by,
        landing_html: values.landing_html,
        preview_image_url: values.preview_image_url,
        created_by: ctx.userId,
      })
      .returning();

    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: "theme_create",
      targetOrgId: values.org_id,
      metadata: { name: values.name, scope: values.scope },
      ip: clientIp(request),
      endedAt: new Date(),
    });

    return success(row, 201);
  } catch (err) {
    console.error("POST /api/operator/themes error:", err);
    return error("Internal server error", 500);
  }
}

// GET /api/operator/themes?org_id=&client_id= — the console listing.
//
// Always returns the global gallery; when a brand (client_id) is supplied, adds
// that brand's bespoke themes; when only an org is supplied, adds every bespoke
// theme across that org's brands. This is the operator-only console feed — the
// tenant-facing availability query (GET /api/admin/themes) is CT3.
export async function GET(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;
  void ctx;

  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("org_id");
    const clientId = searchParams.get("client_id");

    const conditions = [eq(themes.scope, "gallery")];
    if (clientId) conditions.push(eq(themes.client_id, clientId));
    else if (orgId) conditions.push(eq(themes.org_id, orgId));

    const rows = await db.query.themes.findMany({
      where: or(...conditions),
      with: {
        client: { columns: { id: true, name: true, slug: true } },
        organization: { columns: { id: true, name: true, slug: true } },
      },
      orderBy: [desc(themes.created_at)],
    });

    return success(rows);
  } catch (err) {
    console.error("GET /api/operator/themes error:", err);
    return error("Internal server error", 500);
  }
}
