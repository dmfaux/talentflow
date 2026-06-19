import { db } from "@/db";
import { organizations } from "@/db/schema";
import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Tenant org settings (S9). The org boundary is ctx.effectiveOrgId — there is NO
// path param: an owner/org_admin edits THEIR OWN org (an acting operator edits
// the acted org via effectiveOrgId). tier/billing_email stay operator-only (set
// via the operator [id] PATCH); slug/status are not editable here.

function orgView(org: typeof organizations.$inferSelect) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    tier: org.tier, // read-only display (operator-owned)
    billing_email: org.billing_email, // read-only display (operator-owned)
    contact_name: org.contact_name,
    contact_email: org.contact_email,
    status: org.status,
  };
}

export async function GET() {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const denied = authorizeApiOrg(ctx, "manage_org_settings");
  if (denied) return denied;

  if (!ctx.effectiveOrgId) return error("No organisation in context", 400);

  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.effectiveOrgId),
    });
    if (!org) return error("Organisation not found", 404);
    return success(orgView(org));
  } catch (err) {
    console.error("GET /api/admin/organization error:", err);
    return error("Internal server error", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const denied = authorizeApiOrg(ctx, "manage_org_settings");
  if (denied) return denied;

  if (!ctx.effectiveOrgId) return error("No organisation in context", 400);

  try {
    const body = await request.json();

    // Writable allow-list ONLY. A body tier/billing_email/slug/status is silently
    // ignored (operator-only / not editable here) — prevents tenant self-escalation.
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return error("name cannot be empty");
      }
      updates.name = body.name.trim();
    }
    for (const field of ["contact_name", "contact_email"] as const) {
      if (body[field] !== undefined) {
        if (body[field] !== null && typeof body[field] !== "string") {
          return error(`${field} must be a string or null`);
        }
        const trimmed =
          typeof body[field] === "string" ? body[field].trim() || null : null;
        updates[field] = trimmed;
      }
    }

    if (Object.keys(updates).length === 0) {
      return error("No editable fields supplied (name, contact_name, contact_email)");
    }

    updates.updated_at = new Date();
    const [row] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, ctx.effectiveOrgId))
      .returning();

    return success(orgView(row));
  } catch (err) {
    console.error("PATCH /api/admin/organization error:", err);
    return error("Internal server error", 500);
  }
}
