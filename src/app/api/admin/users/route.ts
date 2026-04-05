import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const SECURITY_GROUPS = ["admin", "manager", "user"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const rows = await db
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
      .orderBy(desc(users.created_at));
    return success(rows);
  } catch (err) {
    console.error("GET /api/admin/users error:", err);
    return error("Internal server error", 500);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const securityGroup = typeof body.securityGroup === "string" ? body.securityGroup : "";
    const clientId = typeof body.clientId === "string" ? body.clientId : "";

    if (!firstName) return error("First name is required");
    if (!lastName) return error("Last name is required");
    if (!emailRaw || !EMAIL_RE.test(emailRaw)) return error("A valid email is required");
    if (password.length < 8) return error("Password must be at least 8 characters");
    if (!SECURITY_GROUPS.includes(securityGroup as (typeof SECURITY_GROUPS)[number])) {
      return error("Security group must be admin, manager, or user");
    }
    if (!clientId) return error("Client is required");

    const client = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      columns: { id: true },
    });
    if (!client) return error("Selected client does not exist");

    const existing = await db.query.users.findFirst({
      where: eq(users.email, emailRaw),
      columns: { id: true },
    });
    if (existing) return error("A user with this email already exists");

    const passwordHash = await hashPassword(password);

    const [row] = await db
      .insert(users)
      .values({
        client_id: clientId,
        first_name: firstName,
        last_name: lastName,
        email: emailRaw,
        password_hash: passwordHash,
        security_group: securityGroup,
      })
      .returning({
        id: users.id,
        first_name: users.first_name,
        last_name: users.last_name,
        email: users.email,
        security_group: users.security_group,
        client_id: users.client_id,
        is_active: users.is_active,
        created_at: users.created_at,
      });

    return success(row, 201);
  } catch (err) {
    console.error("POST /api/admin/users error:", err);
    return error("Internal server error", 500);
  }
}
