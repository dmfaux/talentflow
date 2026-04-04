import { db } from "@/db";
import { candidates } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const row = await db.query.candidates.findFirst({
      where: eq(candidates.id, id),
      with: {
        scoringLogs: { orderBy: (logs, { desc }) => [desc(logs.created_at)] },
        messages: { orderBy: (msgs, { desc }) => [desc(msgs.created_at)] },
      },
    });

    if (!row) return error("Candidate not found", 404);

    return success(row);
  } catch (err) {
    console.error("GET /api/admin/candidates/[id] error:", err);
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

    const existing = await db.query.candidates.findFirst({
      where: eq(candidates.id, id),
      columns: { id: true },
    });
    if (!existing) return error("Candidate not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (body.status !== undefined) updates.status = body.status;
    if (body.shortlist_notes !== undefined) updates.shortlist_notes = body.shortlist_notes;
    if (body.follow_up_notes !== undefined) updates.follow_up_notes = body.follow_up_notes;

    const [row] = await db
      .update(candidates)
      .set(updates)
      .where(eq(candidates.id, id))
      .returning();

    return success(row);
  } catch (err) {
    console.error("PATCH /api/admin/candidates/[id] error:", err);
    return error("Internal server error", 500);
  }
}
