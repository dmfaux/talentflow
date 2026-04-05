import { db } from "@/db";
import { clients, templates } from "@/db/schema";
import { error, getApiSession, success } from "@/lib/api";
import {
  computeTransition,
  isTemplateStatus,
  type TemplateStatus,
} from "@/lib/templates/transitions";
import { logTemplateStatusChange } from "@/lib/templates/log";
import { parseBlockTree } from "@/templates/blocks/schema";
import { generateThumbnailSvg } from "@/lib/thumbnails/generate";
import {
  deleteTemplateThumbnail,
  uploadTemplateThumbnail,
} from "@/lib/azure-storage";
import type {
  LogoBackground,
  LogoPosition,
  TemplateClient,
} from "@/templates/types";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getApiSession();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json();

    if (!isTemplateStatus(body.to)) {
      return error(
        "`to` must be one of: draft, pending, published, archived"
      );
    }
    const to = body.to as TemplateStatus;

    const existing = await db.query.templates.findFirst({
      where: eq(templates.id, id),
      columns: {
        id: true,
        name: true,
        status: true,
        source: true,
        block_tree: true,
        published_block_tree: true,
        thumbnail_url: true,
        owner_client_id: true,
      },
    });
    if (!existing) return error("Template not found", 404);

    const result = computeTransition(
      {
        status: existing.status as TemplateStatus,
        source: existing.source as "builtin" | "custom",
        name: existing.name,
        block_tree: existing.block_tree,
        published_block_tree: existing.published_block_tree,
      },
      to
    );
    if (!result.ok) return error(result.error);

    const [row] = await db
      .update(templates)
      .set(result.patch)
      .where(eq(templates.id, id))
      .returning();

    // Audit log. Non-blocking — any failure is logged server-side but
    // doesn't fail the request.
    await logTemplateStatusChange({
      templateId: id,
      fromStatus: existing.status,
      toStatus: to,
      changedBy: session.userId,
    });

    // Post-transition side-effect: regenerate thumbnail when a custom
    // template enters 'published'. Non-fatal — on any failure we log
    // and leave thumbnail_url unchanged (the transition itself has
    // already succeeded).
    if (
      to === "published" &&
      existing.source === "custom" &&
      existing.block_tree
    ) {
      try {
        const parsed = parseBlockTree(existing.block_tree);
        if (!parsed.ok) {
          throw new Error(
            `parseBlockTree failed: ${parsed.errors.join("; ")}`
          );
        }
        // Render with owner client's palette if this is a bespoke
        // template, else with demo defaults.
        let clientForPreview: TemplateClient | undefined;
        if (existing.owner_client_id) {
          const owner = await db.query.clients.findFirst({
            where: eq(clients.id, existing.owner_client_id),
          });
          if (owner) {
            clientForPreview = {
              slug: owner.slug,
              name: owner.name,
              logo_url: owner.branding_logo_url,
              logo_background: (owner.logo_background ?? "light") as LogoBackground,
              logo_position: (owner.logo_position ?? "top-left") as LogoPosition,
              brand_primary_color: owner.brand_primary_color ?? "#0b0f1c",
              brand_secondary_color: owner.brand_secondary_color ?? "#f3f0e8",
              brand_accent_color: owner.brand_accent_color,
              brand_text_color: owner.brand_text_color ?? "#0b0f1c",
            };
          }
        }

        const svg = await generateThumbnailSvg({
          tree: parsed.tree,
          client: clientForPreview,
        });
        const url = await uploadTemplateThumbnail(id, svg);
        if (url) {
          await db
            .update(templates)
            .set({ thumbnail_url: url })
            .where(eq(templates.id, id));
          row.thumbnail_url = url;
          if (existing.thumbnail_url) {
            // Best-effort delete of the previous thumbnail. Do not
            // block the response on this.
            deleteTemplateThumbnail(existing.thumbnail_url).catch((e) =>
              console.warn(
                "[transition] failed to delete old thumbnail:",
                e
              )
            );
          }
        }
      } catch (err) {
        console.error(
          `[transition] thumbnail generation failed for template ${id} (continuing):`,
          err
        );
      }
    }

    return success(row);
  } catch (err) {
    console.error("POST /api/admin/templates/[id]/transition error:", err);
    return error("Internal server error", 500);
  }
}
