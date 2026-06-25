import { db } from "@/db";
import { candidates } from "@/db/schema";
import { authorizeApiBrand, error, getApiTenant, success } from "@/lib/api";
import { orgScope } from "@/lib/tenant";
import { acceptRejection, dismissRejection } from "@/lib/rejection";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Human-in-the-loop rejection decision. The AI parks weak candidates in
// `pending_rejection` (see src/lib/ai-scoring.ts); this is where a human accepts
// that recommendation (→ rejected, email sent) or dismisses it (→ scored). Every
// decision is audited with the actor, timestamp, and optional reason.
//
// POST body: { decision: "accept" | "dismiss", reason?: string,
//              notify_candidate?: boolean }
// `notify_candidate` (accept only, off by default) appends the reason to the
// candidate's rejection email as verbatim feedback.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json();

    const decision = body.decision;
    if (decision !== "accept" && decision !== "dismiss") {
      return error("decision must be 'accept' or 'dismiss'", 400);
    }
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason
        : null;
    const notifyCandidate = body.notify_candidate === true;

    // Org-scoped load so a cross-org id → 404, indistinguishable from missing.
    const existing = await db.query.candidates.findFirst({
      where: and(eq(candidates.id, id), orgScope(candidates, ctx)),
      with: {
        campaign: { columns: { client_id: true, scoring_rubric: true } },
      },
    });
    if (!existing) return error("Candidate not found", 404);

    // RBAC: deciding a rejection requires recruiter+ on the candidate's brand —
    // the same gate as every other candidate mutation.
    const denied = await authorizeApiBrand(
      ctx,
      existing.campaign.client_id,
      "recruiter"
    );
    if (denied) return denied;

    if (existing.status !== "pending_rejection") {
      return error(
        `Candidate is not awaiting a rejection decision (status: ${existing.status})`,
        409
      );
    }

    const candidate = {
      id: existing.id,
      org_id: existing.org_id,
      status: existing.status,
      rejection_reason: existing.rejection_reason,
      ai_score: existing.ai_score,
      ai_rationale: existing.ai_rationale,
    };

    const result =
      decision === "accept"
        ? await acceptRejection({
            candidate,
            actorUserId: ctx.userId,
            reason,
            notifyCandidate,
            minScore:
              (existing.campaign.scoring_rubric as { min_score?: number } | null)
                ?.min_score ?? null,
          })
        : await dismissRejection({
            candidate,
            actorUserId: ctx.userId,
            reason,
          });

    // The race-safe guard in accept/dismissRejection no-ops if someone else
    // already actioned this candidate between our load and write.
    if (!result.ok) {
      return error("Candidate was already actioned by someone else", 409);
    }

    return success({ id: existing.id, status: result.status });
  } catch (err) {
    console.error("POST /api/admin/candidates/[id]/rejection error:", err);
    return error("Internal server error", 500);
  }
}
