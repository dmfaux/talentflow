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
        html_template: true,
        published_html_template: true,
        owner_client_id: true,
        thumbnail_url: true,
      },
    });
    if (!source) return error("Template not found", 404);

    // Prefer the published snapshot if present; otherwise the draft.
    const htmlToClone = source.published_html_template ?? source.html_template;
    if (!htmlToClone) {
      return error("Source template has no html_template to clone");
    }

    const rawName =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : `${source.name} (copy)`;
    if (rawName.length > 200) return error("name is too long");

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

    const [row] = await db
      .insert(templates)
      .values({
        key: newKey,
        name: rawName,
        description: source.description,
        thumbnail_url: null,
        owner_client_id: source.owner_client_id,
        html_template: htmlToClone,
        status: "draft",
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
