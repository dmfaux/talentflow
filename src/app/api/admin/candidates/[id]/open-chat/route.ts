import { db } from "@/db";
import { candidates } from "@/db/schema";
import { authorizeApiBrand, error, getApiTenant, success } from "@/lib/api";
import { orgScope } from "@/lib/tenant";
import { generateChatToken } from "@/lib/chat-auth";
import { createConversation, getActiveConversation } from "@/lib/chat";
import { getQueue } from "@/lib/queue";
import { and, eq } from "drizzle-orm";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    const candidate = await db.query.candidates.findFirst({
      where: and(eq(candidates.id, id), orgScope(candidates, ctx)),
      with: { campaign: { with: { client: true } } },
    });

    if (!candidate) return error("Candidate not found", 404);

    // RBAC: opening a follow-up chat requires recruiter+ on the brand.
    const denied = await authorizeApiBrand(
      ctx,
      candidate.campaign.client_id,
      "recruiter"
    );
    if (denied) return denied;

    // Ensure candidate has a chat token
    if (!candidate.chat_token_hash) {
      const token = generateChatToken();
      await db
        .update(candidates)
        .set({ chat_token_hash: token.hash, updated_at: new Date() })
        .where(eq(candidates.id, id));
    }

    // Check for existing active/dormant conversation
    const existing = await getActiveConversation(id, candidate.org_id);
    if (existing) {
      return success({ conversationId: existing.id, existing: true });
    }

    // Create new conversation
    const flags = (candidate.ai_flags ?? []) as string[];
    const lifecycle = candidate.campaign.chat_lifecycle ?? "dormant";
    const clientName = candidate.campaign.client?.name ?? "the company";

    const conversationId = await createConversation(
      candidate.org_id,
      id,
      candidate.name,
      candidate.campaign.role_title,
      clientName,
      lifecycle,
      flags
    );

    // Send invitation email via queue
    await getQueue().enqueue(
      { type: "send-chat-invitation", candidateId: id },
      { orgId: candidate.org_id, deduplicationId: `chat-invite-${id}` }
    );

    return success({ conversationId, existing: false });
  } catch (err) {
    console.error("POST /api/admin/candidates/[id]/open-chat error:", err);
    return error("Internal server error", 500);
  }
}
