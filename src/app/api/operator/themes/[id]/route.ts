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

    // CT7 seed/palette merge: when the body sends seeds, the seed-based path runs
    // and re-derives the palette. When it omits seeds, keep an unedited theme
    // stable by reconstructing seeds from the stored seed columns (a seed-authored
    // row), or — when this is a legacy row that never had seeds — feeding the
    // stored palette through the direct-palette path so derivation never silently
    // changes the saved colours. Passing seeds:null on the legacy path leaves
    // normaliseThemeFields free to validate the existing palette as before.
    let seeds: unknown;
    if (body.seeds !== undefined) {
      seeds = body.seeds;
    } else if (existing.seed_primary && existing.seed_accent && existing.seed_bg) {
      seeds = {
        primary: existing.seed_primary,
        accent: existing.seed_accent,
        bg: existing.seed_bg,
      };
    } else {
      seeds = null;
    }

    // CT7 font-key merge: send the stored keys (or the body's) through the
    // key-based path so an unedited row keeps its resolved stacks. Only fall back
    // to the legacy stack path when neither the body nor the row carries keys.
    const font_display_key = pick("font_display_key");
    const font_body_key = pick("font_body_key");

    const result = normaliseThemeFields({
      name: pick("name"),
      scope: pick("scope"),
      org_id: pick("org_id"),
      client_id: pick("client_id"),
      seeds,
      palette: pick("palette"),
      font_display_key,
      font_body_key,
      font_display: pick("font_display"),
      font_sans: pick("font_sans"),
      logo_url: pick("logo_url"),
      logo_background: pick("logo_background"),
      logo_position: pick("logo_position"),
      show_powered_by: pick("show_powered_by"),
      landing_html: pick("landing_html"),
      email_templates: pick("email_templates"),
      landing_copy: pick("landing_copy"),
      email_copy: pick("email_copy"),
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
        // CT7: the 3 author-chosen seeds that derive `palette` (null on the legacy
        // direct-palette path).
        seed_primary: values.seed_primary,
        seed_accent: values.seed_accent,
        seed_bg: values.seed_bg,
        font_display: values.font_display,
        font_sans: values.font_sans,
        // CT7: the chosen font-registry keys (null for legacy direct-stack input).
        font_display_key: values.font_display_key,
        font_body_key: values.font_body_key,
        logo_url: values.logo_url,
        logo_background: values.logo_background,
        logo_position: values.logo_position,
        show_powered_by: values.show_powered_by,
        landing_html: values.landing_html,
        // CT6: per-template bespoke email HTML (custom themes only; gallery rows
        // are forced to null by normaliseThemeFields).
        email_templates: values.email_templates,
        // CT7: structured landing + email copy (allowed on gallery too; null →
        // renderer defaults).
        landing_copy: values.landing_copy,
        email_copy: values.email_copy,
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
