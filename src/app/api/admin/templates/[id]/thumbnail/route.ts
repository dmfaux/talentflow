// Manual thumbnail regeneration. Mostly useful during development,
// when tweaking the renderer, or to recover from a failed generation
// during the publish transition.

import { db } from "@/db";
import { clients, templates } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import {
  deleteTemplateThumbnail,
  uploadTemplateThumbnail,
} from "@/lib/azure-storage";
import { generateThumbnailSvg } from "@/lib/thumbnails/generate";
import { parseBlockTree } from "@/templates/blocks/schema";
import type {
  LogoBackground,
  LogoPosition,
  TemplateClient,
} from "@/templates/types";
import { eq } from "drizzle-orm";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const existing = await db.query.templates.findFirst({
      where: eq(templates.id, id),
      columns: {
        id: true,
        source: true,
        status: true,
        block_tree: true,
        published_block_tree: true,
        thumbnail_url: true,
        owner_client_id: true,
      },
    });
    if (!existing) return error("Template not found", 404);
    if (existing.source !== "custom") {
      return error(
        "Thumbnails are only generated for custom templates. Builtins use static SVGs in /public/templates."
      );
    }

    // For published templates use the snapshot (matches what live
    // campaigns render). Otherwise use the working copy.
    const treeRaw =
      existing.status === "published"
        ? existing.published_block_tree
        : existing.block_tree;
    if (!treeRaw) {
      return error(
        "Template has no block_tree to render — edit the template first."
      );
    }

    const parsed = parseBlockTree(treeRaw);
    if (!parsed.ok) {
      return error(
        `block_tree failed validation: ${parsed.errors.join("; ")}`
      );
    }

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
    if (!url) {
      return error(
        "Azure Storage is not configured — thumbnail could not be uploaded",
        500
      );
    }

    await db
      .update(templates)
      .set({ thumbnail_url: url, updated_at: new Date() })
      .where(eq(templates.id, id));

    // Best-effort delete of old thumbnail (don't block the response).
    if (existing.thumbnail_url) {
      deleteTemplateThumbnail(existing.thumbnail_url).catch((e) =>
        console.warn("[thumbnail] failed to delete old:", e)
      );
    }

    return success({ thumbnail_url: url });
  } catch (err) {
    console.error("POST /api/admin/templates/[id]/thumbnail error:", err);
    return error("Internal server error", 500);
  }
}
