import { db } from "@/db";
import { clients, templates } from "@/db/schema";
import { error, getApiSession, requireApiAuth, success } from "@/lib/api";
import { validateHtmlTemplate } from "@/lib/templates/slots";
import { isTemplateStatus } from "@/lib/templates/transitions";
import { logTemplateStatusChange } from "@/lib/templates/log";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const KEY_REGEX = /^[a-z][a-z0-9_]*$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("client_id");
    const filter = searchParams.get("filter");
    const statusParam = searchParams.get("status");

    const conditions = [];

    if (clientId) {
      if (!UUID_REGEX.test(clientId)) {
        return error("client_id must be a valid uuid");
      }
      conditions.push(
        or(
          isNull(templates.owner_client_id),
          eq(templates.owner_client_id, clientId)
        )
      );
      conditions.push(eq(templates.status, "published"));
    } else if (filter === "shared") {
      conditions.push(isNull(templates.owner_client_id));
    } else if (filter === "bespoke") {
      conditions.push(sql`${templates.owner_client_id} IS NOT NULL`);
    }

    if (statusParam) {
      const wanted = statusParam.split(",").map((s) => s.trim());
      if (!wanted.every(isTemplateStatus)) {
        return error(
          "status must be one of: draft, pending, published, archived"
        );
      }
      conditions.push(inArray(templates.status, wanted));
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const rows = await db
      .select({
        id: templates.id,
        key: templates.key,
        name: templates.name,
        description: templates.description,
        thumbnail_url: templates.thumbnail_url,
        owner_client_id: templates.owner_client_id,
        owner_client_name: clients.name,
        status: templates.status,
        published_at: templates.published_at,
        created_at: templates.created_at,
        updated_at: templates.updated_at,
      })
      .from(templates)
      .leftJoin(clients, eq(templates.owner_client_id, clients.id))
      .where(whereClause)
      .orderBy(
        desc(sql`${templates.owner_client_id} IS NOT NULL`),
        asc(templates.name)
      );

    return success(rows);
  } catch (err) {
    console.error("GET /api/admin/templates error:", err);
    return error("Internal server error", 500);
  }
}

export async function POST(request: NextRequest) {
  const { session, response } = await getApiSession();
  if (response) return response;

  try {
    const body = await request.json();

    // Validate key
    if (!body.key || typeof body.key !== "string" || !body.key.trim()) {
      return error("key is required");
    }
    const key = body.key.trim();
    if (!KEY_REGEX.test(key)) {
      return error(
        "key must be lowercase letters, numbers, and underscores (starting with a letter)"
      );
    }
    const keyTaken = await db.query.templates.findFirst({
      where: eq(templates.key, key),
      columns: { id: true },
    });
    if (keyTaken) return error("A template with this key already exists");

    // Validate html_template
    let htmlTemplate: string | null = null;
    if (body.html_template !== undefined && body.html_template !== null) {
      if (typeof body.html_template !== "string") {
        return error("html_template must be a string");
      }
      const validated = validateHtmlTemplate(body.html_template);
      if (!validated.ok) {
        return error(
          `html_template validation failed: ${validated.errors.join("; ")}`
        );
      }
      htmlTemplate = body.html_template;
    }

    // Validate name
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return error("name is required");
    }

    // Validate owner_client_id if provided
    let ownerClientId: string | null = null;
    if (
      body.owner_client_id !== undefined &&
      body.owner_client_id !== null &&
      body.owner_client_id !== ""
    ) {
      if (
        typeof body.owner_client_id !== "string" ||
        !UUID_REGEX.test(body.owner_client_id)
      ) {
        return error("owner_client_id must be a valid uuid");
      }
      const clientExists = await db.query.clients.findFirst({
        where: eq(clients.id, body.owner_client_id),
        columns: { id: true },
      });
      if (!clientExists) return error("owner_client_id references unknown client");
      ownerClientId = body.owner_client_id;
    }

    const [row] = await db
      .insert(templates)
      .values({
        key,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        thumbnail_url: body.thumbnail_url?.trim() || null,
        owner_client_id: ownerClientId,
        html_template: htmlTemplate,
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
    console.error("POST /api/admin/templates error:", err);
    return error("Internal server error", 500);
  }
}
