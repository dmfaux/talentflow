import { db } from "@/db";
import { themes } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { normaliseThemeFields } from "@/lib/theme-fields";
import { guardCustomThemeBrand } from "@/lib/theme";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// PATCH /api/operator/themes/[id] — edit a gallery or bespoke theme.
//
// The existing row is merged with the supplied fields and the WHOLE result is
// re-validated, so a scope flip re-runs the gallery/custom invariants: flipping
// to custom re-asserts org/client/tier, and flipping to gallery re-nulls
// org/client and re-forces show_powered_by=true. (normaliseThemeFields does the
// forcing; guardCustomThemeBrand does the DB-backed integrity + tier check.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id } = await params;

    const existing = await db.query.themes.findFirst({
      where: eq(themes.id, id),
    });
    if (!existing) return error("Theme not found", 404);

    const body = await request.json();

    // Merge: a field absent from the body keeps the stored value, so the merged
    // result is always a complete, re-validatable theme.
    const pick = <K extends string>(key: K): unknown =>
      body[key] !== undefined
        ? body[key]
        : (existing as Record<string, unknown>)[key];

    const result = normaliseThemeFields({
      name: pick("name"),
      scope: pick("scope"),
      org_id: pick("org_id"),
      client_id: pick("client_id"),
      palette: pick("palette"),
      font_display: pick("font_display"),
      font_sans: pick("font_sans"),
      logo_url: pick("logo_url"),
      logo_background: pick("logo_background"),
      logo_position: pick("logo_position"),
      show_powered_by: pick("show_powered_by"),
      landing_html: pick("landing_html"),
      preview_image_url: pick("preview_image_url"),
    });
    if (!result.ok) return error(result.message, result.status);
    const values = result.values;

    if (values.scope === "custom") {
      const guard = await guardCustomThemeBrand(values.org_id!, values.client_id!);
      if (guard) return error(guard.message, guard.status);
    }

    const [row] = await db
      .update(themes)
      .set({
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
        updated_at: new Date(),
      })
      .where(eq(themes.id, id))
      .returning();

    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: "theme_update",
      targetOrgId: values.org_id,
      metadata: { name: values.name, scope: values.scope },
      ip: clientIp(request),
      endedAt: new Date(),
    });

    return success(row);
  } catch (err) {
    console.error("PATCH /api/operator/themes/[id] error:", err);
    return error("Internal server error", 500);
  }
}
