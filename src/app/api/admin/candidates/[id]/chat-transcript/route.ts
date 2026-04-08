import { db } from "@/db";
import { candidates, chatMessages, conversations } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const candidate = await db.query.candidates.findFirst({
      where: eq(candidates.id, id),
      columns: { id: true },
    });

    if (!candidate) return error("Candidate not found", 404);

    const convs = await db.query.conversations.findMany({
      where: eq(conversations.candidate_id, id),
      with: {
        chatMessages: {
          orderBy: [asc(chatMessages.created_at)],
        },
      },
      orderBy: (c, { desc }) => [desc(c.created_at)],
    });

    return success({ conversations: convs });
  } catch (err) {
    console.error(
      "GET /api/admin/candidates/[id]/chat-transcript error:",
      err
    );
    return error("Internal server error", 500);
  }
}
