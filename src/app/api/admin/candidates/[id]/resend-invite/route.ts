import { db } from "@/db";
import { candidates } from "@/db/schema";
import { authorizeApiBrand, error, getApiTenant, success } from "@/lib/api";
import {
  brandEmailIdentity,
  recruiterInviteEmail,
  resolveEmailSubject,
  sendCandidateEmail,
} from "@/lib/email";
import { appHostOrigin } from "@/lib/host";
import {
  INVITED_STATUS,
  issueInviteToken,
  recordCandidateNotified,
} from "@/lib/manual-candidate";
import { orgScope } from "@/lib/tenant";
import { resolveCampaignTheme } from "@/lib/theme";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Re-issue a recruiter invite-to-apply link for a candidate still sitting in the
// `invited` holding state (the recruiter's "invite pending / resend" control).
// A fresh 14-day token is minted and a new invite email sent.
export async function POST(
  request: NextRequest,
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

    const denied = await authorizeApiBrand(
      ctx,
      candidate.campaign.client_id,
      "recruiter"
    );
    if (denied) return denied;

    if (candidate.status !== INVITED_STATUS) {
      return error(
        `Only an invited candidate can be re-invited (status: ${candidate.status})`,
        409
      );
    }

    const campaign = candidate.campaign;
    const client = campaign.client;

    const invite = await issueInviteToken(candidate.org_id, candidate.id);
    const applyUrl = `${appHostOrigin()}/c/${client.slug}/${campaign.slug}?invite=${invite.raw}`;

    const emailTheme =
      campaign.theme_snapshot?.email ??
      (
        await resolveCampaignTheme({
          theme_id: campaign.theme_id,
          client: {
            default_theme_id: client.default_theme_id,
            branding_logo_url: client.branding_logo_url,
            logo_background: client.logo_background,
            logo_position: client.logo_position,
          },
        })
      ).email;

    const messageId = await sendCandidateEmail(
      candidate.email,
      resolveEmailSubject("recruiterInvite", {
        campaign: { role_title: campaign.role_title },
      }),
      recruiterInviteEmail(
        emailTheme,
        candidate.name,
        campaign.role_title,
        client.name ?? "the company",
        applyUrl
      ),
      candidate.id,
      brandEmailIdentity({
        from_name: client.from_name,
        reply_to_email: client.reply_to_email,
      })
    );
    await recordCandidateNotified({
      orgId: candidate.org_id,
      candidateId: candidate.id,
      actorUserId: ctx.userId,
      kind: "invite",
      messageId,
    });

    return success({
      candidate_id: candidate.id,
      invite_expires_at: invite.expiresAt,
    });
  } catch (err) {
    console.error("POST /api/admin/candidates/[id]/resend-invite error:", err);
    return error("Internal server error", 500);
  }
}
