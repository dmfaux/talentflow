import { db } from "@/db";
import { candidates, chatMessages } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { getQueue } from "@/lib/queue";
import { closeChatWithRejection, getActiveConversation } from "@/lib/chat";
import { and, count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

/** Admin can't reject a follow_up candidate who hasn't yet had a chance to
 *  respond. Grace period runs from the moment the chat invitation was sent
 *  (conversation.created_at). Configurable in code — not per-campaign to
 *  keep the mental model simple. */
const GRACE_PERIOD_HOURS = 72;

/** When admin rejects a candidate who has actively sent chat messages, we
 *  delay the confirmation email so a late re-score can still cancel the
 *  rejection — and so the admin has a window to undo a misclick. */
const PENDING_REJECTION_DELAY_HOURS = 24;

type FollowUpRejectResult =
  | { blocked: true; message: string; availableAt: Date }
  | { blocked: false; tier: "B1" | "B2"; pending: boolean };

/** Determine the rejection tier for a candidate currently in follow_up,
 *  close the chat with a templated message, and queue the confirmation
 *  email with the appropriate delay. Returns an object describing the
 *  outcome so the caller can format the HTTP response and decide whether
 *  to set pending_rejection_at. */
async function handleFollowUpRejection(
  candidateId: string,
  roleTitle: string,
  clientName: string,
  adminReason: string | undefined
): Promise<FollowUpRejectResult> {
  // Grace period is anchored to the conversation, not the candidate row.
  // If somehow there's no active conversation, treat the candidate as a
  // ghost past grace and allow immediate reject.
  const conv = await getActiveConversation(candidateId);
  if (!conv) {
    return { blocked: false, tier: "B1", pending: false };
  }

  // Count the candidate's messages. Any user message means they've engaged
  // and earn the 24h delay; zero user messages means ghosting.
  const [{ userMessageCount }] = await db
    .select({ userMessageCount: count() })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversation_id, conv.id),
        eq(chatMessages.role, "user")
      )
    );

  const hasUserMessages = (userMessageCount ?? 0) > 0;
  const convAgeMs = Date.now() - new Date(conv.created_at).getTime();
  const graceMs = GRACE_PERIOD_HOURS * 60 * 60 * 1000;

  // Tier A: no engagement and still inside the grace window.
  if (!hasUserMessages && convAgeMs < graceMs) {
    const availableAt = new Date(
      new Date(conv.created_at).getTime() + graceMs
    );
    return {
      blocked: true,
      message: `Candidate was invited to chat but hasn't responded yet. Reject will be available after ${availableAt.toLocaleString("en-ZA")}.`,
      availableAt,
    };
  }

  // Tier B1/B2: proceed. Post the templated close message in the chat.
  await closeChatWithRejection(conv.id, roleTitle, clientName, adminReason);

  // B1 is a ghost past grace — no reason to delay. B2 has engaged messages
  // so delay the email to preserve an undo window and to self-check against
  // any late re-score.
  const tier: "B1" | "B2" = hasUserMessages ? "B2" : "B1";
  const deliverAt = hasUserMessages
    ? new Date(Date.now() + PENDING_REJECTION_DELAY_HOURS * 60 * 60 * 1000)
    : undefined;

  await getQueue().enqueue(
    {
      type: "send-email",
      candidateId,
      emailKind: "rejection_confirmation",
      adminReason,
    },
    { deliverAt, deduplicationId: `reject-confirm-${candidateId}` }
  );

  return { blocked: false, tier, pending: hasUserMessages };
}

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
      with: { campaign: { with: { client: true } } },
    });
    if (!existing) return error("Candidate not found", 404);

    // ── Tiered path: admin rejecting a follow_up candidate ──────────
    const isRejectingFollowUp =
      body.status === "rejected" && existing.status === "follow_up";

    let followUpResult: FollowUpRejectResult | null = null;
    if (isRejectingFollowUp) {
      followUpResult = await handleFollowUpRejection(
        existing.id,
        existing.campaign.role_title,
        existing.campaign.client?.name ?? "the company",
        typeof body.rejection_reason === "string" ? body.rejection_reason : undefined
      );

      if (followUpResult.blocked) {
        return NextResponse.json(
          {
            error: followUpResult.message,
            tier: "A",
            available_at: followUpResult.availableAt.toISOString(),
          },
          { status: 409 }
        );
      }
    }

    // ── Build the update patch ──────────────────────────────────────
    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (body.status !== undefined) updates.status = body.status;
    if (body.rejection_reason !== undefined) updates.rejection_reason = body.rejection_reason;
    if (body.shortlist_notes !== undefined) updates.shortlist_notes = body.shortlist_notes;

    // B2 rejections get a pending_rejection_at marker so downstream logic
    // (email worker self-check, admin undo) can tell the rejection is in
    // flight rather than final.
    if (followUpResult && !followUpResult.blocked && followUpResult.pending) {
      updates.pending_rejection_at = new Date();
    }

    // Any status change that moves the candidate OFF `rejected` clears any
    // pending rejection marker — admin un-rejecting should cancel the
    // queued confirmation email (which self-checks status at fire time).
    if (
      body.status !== undefined &&
      body.status !== "rejected" &&
      existing.status === "rejected"
    ) {
      updates.pending_rejection_at = null;
    }

    const [row] = await db
      .update(candidates)
      .set(updates)
      .where(eq(candidates.id, id))
      .returning();

    // Standard rejection email for non-follow_up rejects only. Follow_up
    // rejections use the rejection_confirmation flow instead, which was
    // already queued by handleFollowUpRejection with the correct delay.
    if (body.status === "rejected" && !isRejectingFollowUp) {
      await getQueue().enqueue(
        { type: "send-email", candidateId: id, emailKind: "rejected" },
        { deduplicationId: `rejected-${id}` }
      );
    }

    return success({
      ...row,
      ...(followUpResult && !followUpResult.blocked
        ? { tier: followUpResult.tier }
        : {}),
    });
  } catch (err) {
    console.error("PATCH /api/admin/candidates/[id] error:", err);
    return error("Internal server error", 500);
  }
}
