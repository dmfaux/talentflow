import { db } from "@/db";
import { templateStatusLog, users } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { desc, eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const rows = await db
      .select({
        id: templateStatusLog.id,
        from_status: templateStatusLog.from_status,
        to_status: templateStatusLog.to_status,
        changed_at: templateStatusLog.changed_at,
        changed_by_id: templateStatusLog.changed_by,
        changed_by_first_name: users.first_name,
        changed_by_last_name: users.last_name,
        changed_by_email: users.email,
      })
      .from(templateStatusLog)
      .leftJoin(users, eq(templateStatusLog.changed_by, users.id))
      .where(eq(templateStatusLog.template_id, id))
      .orderBy(desc(templateStatusLog.changed_at))
      .limit(50);

    return success(rows);
  } catch (err) {
    console.error("GET /api/admin/templates/[id]/history error:", err);
    return error("Internal server error", 500);
  }
}
