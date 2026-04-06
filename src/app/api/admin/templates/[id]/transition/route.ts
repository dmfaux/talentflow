import { db } from "@/db";
import { templates } from "@/db/schema";
import { error, getApiSession, success } from "@/lib/api";
import {
  computeTransition,
  isTemplateStatus,
  type TemplateStatus,
} from "@/lib/templates/transitions";
import { logTemplateStatusChange } from "@/lib/templates/log";
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
        html_template: true,
        published_html_template: true,
        thumbnail_url: true,
        owner_client_id: true,
      },
    });
    if (!existing) return error("Template not found", 404);

    const result = computeTransition(
      {
        status: existing.status as TemplateStatus,
        name: existing.name,
        html_template: existing.html_template,
        published_html_template: existing.published_html_template,
      },
      to
    );
    if (!result.ok) return error(result.error);

    const [row] = await db
      .update(templates)
      .set(result.patch)
      .where(eq(templates.id, id))
      .returning();

    await logTemplateStatusChange({
      templateId: id,
      fromStatus: existing.status,
      toStatus: to,
      changedBy: session.userId,
    });

    return success(row);
  } catch (err) {
    console.error("POST /api/admin/templates/[id]/transition error:", err);
    return error("Internal server error", 500);
  }
}
