import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { and, eq, ne } from "drizzle-orm";
import { NextRequest } from "next/server";

const SECURITY_GROUPS = ["admin", "manager", "user"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const [row] = await db
      .select({
        id: users.id,
        first_name: users.first_name,
        last_name: users.last_name,
        email: users.email,
        security_group: users.security_group,
        client_id: users.client_id,
        client_name: clients.name,
        is_active: users.is_active,
        created_at: users.created_at,
        updated_at: users.updated_at,
      })
      .from(users)
      .leftJoin(clients, eq(users.client_id, clients.id))
      .where(eq(users.id, id))
      .limit(1);

    if (!row) return error("User not found", 404);

    return success(row);
  } catch (err) {
    console.error("GET /api/admin/users/[id] error:", err);
    return error("Internal server error", 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true },
    });
    if (!existing) return error("User not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (body.firstName !== undefined) {
      const v = typeof body.firstName === "string" ? body.firstName.trim() : "";
      if (!v) return error("First name cannot be empty");
      updates.first_name = v;
    }

    if (body.lastName !== undefined) {
      const v = typeof body.lastName === "string" ? body.lastName.trim() : "";
      if (!v) return error("Last name cannot be empty");
      updates.last_name = v;
    }

    if (body.email !== undefined) {
      const v = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!v || !EMAIL_RE.test(v)) return error("A valid email is required");

      const taken = await db.query.users.findFirst({
        where: and(eq(users.email, v), ne(users.id, id)),
        columns: { id: true },
      });
      if (taken) return error("A user with this email already exists");
      updates.email = v;
    }

    if (body.securityGroup !== undefined) {
      if (!SECURITY_GROUPS.includes(body.securityGroup)) {
        return error("Security group must be admin, manager, or user");
      }
      updates.security_group = body.securityGroup;
    }

    if (body.clientId !== undefined) {
      const client = await db.query.clients.findFirst({
        where: eq(clients.id, body.clientId),
        columns: { id: true },
      });
      if (!client) return error("Selected client does not exist");
      updates.client_id = body.clientId;
    }

    if (body.isActive !== undefined) {
      updates.is_active = Boolean(body.isActive);
    }

    const [row] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        first_name: users.first_name,
        last_name: users.last_name,
        email: users.email,
        security_group: users.security_group,
        client_id: users.client_id,
        is_active: users.is_active,
        updated_at: users.updated_at,
      });

    return success(row);
  } catch (err) {
    console.error("PATCH /api/admin/users/[id] error:", err);
    return error("Internal server error", 500);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const existing = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true },
    });
    if (!existing) return error("User not found", 404);

    await db
      .update(users)
      .set({ is_active: false, updated_at: new Date() })
      .where(eq(users.id, id));

    return success({ id });
  } catch (err) {
    console.error("DELETE /api/admin/users/[id] error:", err);
    return error("Internal server error", 500);
  }
}
