import { verifyChatAuth } from "@/lib/chat-auth";
import { getActiveConversation } from "@/lib/chat";
import {
  recordConsentConfirmed,
  RECRUITER_MANUAL_SOURCE,
} from "@/lib/manual-candidate";
import { getOrgStatus } from "@/lib/org-status";
import { NextRequest, NextResponse } from "next/server";

// Candidate "view application" status surface (recruiter-added portal). The
// "you've been added" notice points here behind the persistent chat token. This
// is the first authenticated candidate surface for a recruiter-added candidate,
// so following the CTA here is what upgrades the recruiter's attested consent to
// the candidate's own confirmation — before they ever reach a chat.
export async function GET(request: NextRequest) {
  const candidate = await verifyChatAuth(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Refuse a suspended/deleted org (S11) — mirror the chat route: the public
  // path skips the tenant seam, so gate on the resolved org here.
  const orgStatus = await getOrgStatus(candidate.org_id);
  if (orgStatus !== "active") {
    return NextResponse.json(
      { error: orgStatus === "suspended" ? "unavailable" : "closed" },
      { status: orgStatus === "suspended" ? 503 : 410 }
    );
  }

  // POPIA: a skip-path candidate's consent was attested by the recruiter, not
  // given by the candidate, so popia_consent_at stayed null. Them personally
  // opening their own status page upgrades that to real consent. Idempotent —
  // recordConsentConfirmed no-ops once the timestamp is set.
  if (candidate.source === RECRUITER_MANUAL_SOURCE && !candidate.popia_consent_at) {
    await recordConsentConfirmed({
      orgId: candidate.org_id,
      candidateId: candidate.id,
    });
  }

  if (candidate.status === "withdrawn" || candidate.purged_at) {
    return NextResponse.json({ state: "withdrawn" });
  }

  // A live conversation means the team has follow-up questions waiting — point
  // the candidate into it. Otherwise their profile is simply under review.
  const conversation = await getActiveConversation(
    candidate.id,
    candidate.org_id
  );
  if (conversation) {
    return NextResponse.json({
      state: "chat_ready",
      conversationId: conversation.id,
    });
  }

  return NextResponse.json({ state: "in_review" });
}
