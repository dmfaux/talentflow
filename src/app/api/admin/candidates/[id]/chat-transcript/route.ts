import { db } from "@/db";
import { candidates, chatMessages, conversations } from "@/db/schema";
import { error, getApiTenant, success } from "@/lib/api";
import { resolveOwnedResource } from "@/lib/tenant";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // S4: resolve the candidate WITHIN the caller's org → cross-org id 404s before
  // any chat transcript (candidate PII) is read. Was an UNSCOPED requireApiAuth
  // read resolving any candidate's conversations by raw UUID.
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    const candidate = await resolveOwnedResource(candidates, id, ctx);

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
