import { db } from "@/db";
import { clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const row = await db.query.clients.findFirst({
      where: eq(clients.id, id),
      with: { campaigns: true },
    });

    if (!row) return error("Client not found", 404);

    return success(row);
  } catch (err) {
    console.error("GET /api/admin/clients/[id] error:", err);
    return error("Internal server error", 500);
  }
}
