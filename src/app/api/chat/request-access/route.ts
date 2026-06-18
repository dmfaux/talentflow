import { db } from "@/db";
import { campaigns, candidates, chatTokens, clients } from "@/db/schema";
import { generateMagicLinkToken } from "@/lib/chat-auth";
import { getActiveConversation } from "@/lib/chat";
import { chatAccessEmail, sendCandidateEmail } from "@/lib/email";
import { getOrgStatus } from "@/lib/org-status";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { email, clientSlug, campaignSlug } = await request.json();

    if (!email || !clientSlug || !campaignSlug) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({ success: true });

    const trimmedEmail = email.trim().toLowerCase();

    // Look up candidate by email + campaign
    const [candidate] = await db
      .select({
        id: candidates.id,
        org_id: candidates.org_id,
        name: candidates.name,
        role_title: campaigns.role_title,
      })
      .from(candidates)
      .innerJoin(campaigns, eq(candidates.campaign_id, campaigns.id))
      .innerJoin(clients, eq(campaigns.client_id, clients.id))
      .where(
        and(
          eq(candidates.email, trimmedEmail),
          eq(clients.slug, clientSlug),
          eq(campaigns.slug, campaignSlug)
        )
      )
      .limit(1);

    if (!candidate) return successResponse;

    // Suspended/deleted org (S11): return the SAME enumeration-safe success as
    // an unknown candidate — don't leak org state via this endpoint — but issue
    // no token and send no email.
    if ((await getOrgStatus(candidate.org_id)) !== "active") {
      return successResponse;
    }

    // Generate magic link token
    const token = generateMagicLinkToken();
    await db.insert(chatTokens).values({
      // Public write: stamp org_id explicitly from the resolved candidate.
      org_id: candidate.org_id,
      candidate_id: candidate.id,
      token_hash: token.hash,
      expires_at: token.expiresAt,
    });

    // Carry the active conversation id through the magic-link round-trip. The
    // invitation email links with ?t=<id>, but a candidate authenticating via
    // this fallback (new device / cleared storage) has no id in the URL — and
    // the chat page resolves the conversation only from ?t=, so without this
    // the verified candidate lands on "no active conversation".
    const conversation = await getActiveConversation(candidate.id);

    // Build magic link URL
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      request.nextUrl.origin;
    const redirect = conversation
      ? `/c/${clientSlug}/${campaignSlug}/chat?t=${conversation.id}`
      : `/c/${clientSlug}/${campaignSlug}/chat`;
    const magicLinkUrl = `${origin}/api/chat/verify?token=${token.raw}&redirect=${encodeURIComponent(redirect)}`;

    // Send email
    await sendCandidateEmail(
      trimmedEmail,
      `Verify your identity — ${candidate.role_title}`,
      chatAccessEmail(candidate.name, candidate.role_title, magicLinkUrl),
      candidate.id
    );

    return successResponse;
  } catch (err) {
    console.error("POST /api/chat/request-access error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
