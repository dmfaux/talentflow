import { db } from "@/db";
import { templates } from "@/db/schema";
import { error, getApiSession, success } from "@/lib/api";
import { logTemplateStatusChange } from "@/lib/templates/log";
import { eq, like } from "drizzle-orm";
import { NextRequest } from "next/server";

const KEY_REGEX = /^[a-z][a-z0-9_]*$/;

function slugifyToKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  // Ensure it starts with a letter.
  return base.match(/^[a-z]/) ? base : `t_${base}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getApiSession();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const source = await db.query.templates.findFirst({
      where: eq(templates.id, id),
      columns: {
        id: true,
        key: true,
        name: true,
        description: true,
        source: true,
        block_tree: true,
        published_block_tree: true,
        owner_client_id: true,
        thumbnail_url: true,
      },
    });
    if (!source) return error("Template not found", 404);

    // Phase 2 limitation: cloning a builtin means starting from an
    // empty block_tree, which isn't useful. Defer builtin→custom
    // materialisation to a later phase.
    if (source.source === "builtin") {
      return error(
        "Cannot clone a builtin template yet — builtins don't have an editable block_tree to copy from"
      );
    }

    // Prefer the published snapshot if present (the live version);
    // otherwise the in-progress draft.
    const treeToClone = source.published_block_tree ?? source.block_tree;
    if (!treeToClone) {
      return error("Source template has no block_tree to clone");
    }

    // New name/key. If user provided a name, use it; else append " (copy)".
    const rawName =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : `${source.name} (copy)`;
    if (rawName.length > 200) return error("name is too long");

    // Find an available key by suffixing _copy, _copy_2, _copy_3...
    const baseKey = slugifyToKey(rawName);
    if (!KEY_REGEX.test(baseKey) || baseKey.length > 63) {
      return error(
        "Could not derive a valid template key from the name — pass a different name"
      );
    }
    const existingKeys = await db
      .select({ key: templates.key })
      .from(templates)
      .where(like(templates.key, `${baseKey}%`));
    const used = new Set(existingKeys.map((r) => r.key));
    let newKey = baseKey;
    let n = 2;
    while (used.has(newKey)) {
      newKey = `${baseKey}_${n}`;
      n++;
    }

    // Deep-clone block_tree — structuredClone keeps the JSON shape intact.
    const clonedTree = structuredClone(treeToClone);

    const [row] = await db
      .insert(templates)
      .values({
        key: newKey,
        name: rawName,
        description: source.description,
        thumbnail_url: null, // will be regenerated on publish
        owner_client_id: source.owner_client_id,
        source: "custom",
        block_tree: clonedTree,
        status: "draft", // always starts as draft
      })
      .returning();

    await logTemplateStatusChange({
      templateId: row.id,
      fromStatus: null,
      toStatus: "draft",
      changedBy: session.userId,
    });

    return success(row, 201);
  } catch (err) {
    console.error("POST /api/admin/templates/[id]/clone error:", err);
    return error("Internal server error", 500);
  }
}
