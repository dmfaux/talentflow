import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import {
  authorizeApiBrand,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import { uploadCV } from "@/lib/azure-storage";
import { validateConsent } from "@/lib/consent";
import {
  brandEmailIdentity,
  recruiterAddedNoticeEmail,
  recruiterInviteEmail,
  resolveEmailSubject,
  sendCandidateEmail,
} from "@/lib/email";
import type { GatingQuestion } from "@/lib/gating";
import { appHostOrigin } from "@/lib/host";
import {
  addCandidateByInvite,
  addCandidateBySkip,
  findCampaignCandidateByEmail,
  recordCandidateNotified,
} from "@/lib/manual-candidate";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { resolveCampaignTheme } from "@/lib/theme";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CV_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_CV_EXTENSIONS = [".pdf", ".doc", ".docx"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // S4: resolve the campaign WITHIN the caller's org → cross-org id 404s before
  // any candidate is read. Was an UNSCOPED requireApiAuth read exposing every
  // org's applicants. orgScope on the candidate query is defence-in-depth.
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    // Verify campaign exists AND belongs to the caller's org.
    const campaign = await resolveOwnedResource(campaigns, id, ctx);
    if (!campaign) return error("Campaign not found", 404);

    const { searchParams } = request.nextUrl;
    const statusFilter = searchParams.get("status");
    const minScore = searchParams.get("min_score");
    const maxScore = searchParams.get("max_score");
    const confidenceFilter = searchParams.get("confidence");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const conditions = [eq(candidates.campaign_id, id), orgScope(candidates, ctx)];
    if (statusFilter) conditions.push(eq(candidates.status, statusFilter));
    if (minScore) conditions.push(gte(candidates.ai_score, parseFloat(minScore)));
    if (maxScore) conditions.push(lte(candidates.ai_score, parseFloat(maxScore)));
    if (confidenceFilter) conditions.push(eq(candidates.ai_confidence, confidenceFilter));

    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(candidates)
        .where(where)
        .orderBy(desc(candidates.ai_score))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(candidates)
        .where(where),
    ]);

    return success({
      candidates: rows,
      total: countResult[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("GET /api/admin/campaigns/[id]/candidates error:", err);
    return error("Internal server error", 500);
  }
}

// Recruiter-added candidates. A recruiter (brand recruiter+) adds someone to a
// campaign by hand, choosing per candidate:
//   • invite — create a stub + email a magic link to the public form, OR
//   • skip   — vouch for them (CV + consent attestation) straight into scoring.
// The state, audit, and token logic lives in src/lib/manual-candidate.ts; this
// route owns auth, the campaign-status guard, dedup, CV upload, and email.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    // Org-scoped load (a cross-org id → 404) joined to the brand for slugs,
    // email identity, and theme resolution.
    const [campaign] = await db
      .select({
        id: campaigns.id,
        org_id: campaigns.org_id,
        client_id: campaigns.client_id,
        slug: campaigns.slug,
        status: campaigns.status,
        role_title: campaigns.role_title,
        gating_config: campaigns.gating_config,
        theme_id: campaigns.theme_id,
        theme_snapshot: campaigns.theme_snapshot,
        client_slug: clients.slug,
        client_name: clients.name,
        brand_from_name: clients.from_name,
        brand_reply_to: clients.reply_to_email,
        default_theme_id: clients.default_theme_id,
        branding_logo_url: clients.branding_logo_url,
        logo_background: clients.logo_background,
        logo_position: clients.logo_position,
      })
      .from(campaigns)
      .innerJoin(clients, eq(campaigns.client_id, clients.id))
      .where(and(eq(campaigns.id, id), orgScope(campaigns, ctx)))
      .limit(1);

    if (!campaign) return error("Campaign not found", 404);

    // RBAC: adding a candidate is a candidate mutation → recruiter+ on the brand.
    const denied = await authorizeApiBrand(ctx, campaign.client_id, "recruiter");
    if (denied) return denied;

    // Manual add is only allowed while the campaign is taking candidates.
    if (campaign.status !== "active" && campaign.status !== "paused") {
      return error(`Cannot add candidates to a ${campaign.status} campaign`, 409);
    }

    // ── Parse body (JSON or multipart when a CV file is attached) ──────
    const contentType = request.headers.get("content-type") ?? "";
    let path: string | undefined;
    let name: string | undefined;
    let email: string | undefined;
    let phone: string | undefined;
    let cvText: string | null = null;
    let cvFile: File | null = null;
    let gatingAnswers: Record<string, string> | null = null;
    let consentRaw: { version?: unknown; basis?: unknown; note?: unknown } = {};

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      path = form.get("path") as string | undefined;
      name = form.get("name") as string | undefined;
      email = form.get("email") as string | undefined;
      phone = (form.get("phone") as string) || undefined;
      cvText = ((form.get("cv_text") as string) || "").trim() || null;
      const file = form.get("cv");
      if (file && file instanceof File && file.size > 0) cvFile = file;
      const answersRaw = form.get("gating");
      if (answersRaw && typeof answersRaw === "string") {
        try {
          const parsed = JSON.parse(answersRaw);
          if (parsed && typeof parsed === "object") gatingAnswers = parsed;
        } catch {
          /* malformed → treated as override */
        }
      }
      const consentStr = form.get("consent");
      if (consentStr && typeof consentStr === "string") {
        try {
          consentRaw = JSON.parse(consentStr);
        } catch {
          /* validated below */
        }
      }
    } else {
      const body = await request.json();
      path = body.path;
      name = body.name;
      email = body.email;
      phone = body.phone || undefined;
      cvText =
        typeof body.cv_text === "string" ? body.cv_text.trim() || null : null;
      gatingAnswers =
        body.gating && typeof body.gating === "object" ? body.gating : null;
      consentRaw = body.consent ?? {};
    }

    // An empty answers object is "opened the expander but answered nothing" →
    // treat as an override (null), not a failed gating evaluation.
    if (gatingAnswers && Object.keys(gatingAnswers).length === 0) {
      gatingAnswers = null;
    }

    // ── Shared validation ─────────────────────────────────────────────
    if (path !== "invite" && path !== "skip") {
      return error("path must be 'invite' or 'skip'", 400);
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return error("Name is required", 400);
    }
    if (!email || typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      return error("A valid email address is required", 400);
    }

    // Dedup within this campaign (case-insensitive); never a second row.
    const existingId = await findCampaignCandidateByEmail(campaign.id, email);
    if (existingId) {
      return error(
        "A candidate with this email is already in this campaign",
        409
      );
    }

    const origin = appHostOrigin();
    const identity = brandEmailIdentity({
      from_name: campaign.brand_from_name,
      reply_to_email: campaign.brand_reply_to,
    });
    const emailTheme =
      campaign.theme_snapshot?.email ??
      (
        await resolveCampaignTheme({
          theme_id: campaign.theme_id,
          client: {
            default_theme_id: campaign.default_theme_id,
            branding_logo_url: campaign.branding_logo_url,
            logo_background: campaign.logo_background,
            logo_position: campaign.logo_position,
          },
        })
      ).email;

    // ── Invite path ───────────────────────────────────────────────────
    if (path === "invite") {
      const result = await addCandidateByInvite({
        orgId: campaign.org_id,
        campaignId: campaign.id,
        actorUserId: ctx.userId,
        name,
        email,
        phone,
      });

      const applyUrl = `${origin}/c/${campaign.client_slug}/${campaign.slug}?invite=${result.inviteTokenRaw}`;
      const messageId = await sendCandidateEmail(
        email.trim().toLowerCase(),
        resolveEmailSubject("recruiterInvite", {
          campaign: { role_title: campaign.role_title },
        }),
        recruiterInviteEmail(
          emailTheme,
          name.trim(),
          campaign.role_title,
          campaign.client_name ?? "the company",
          applyUrl
        ),
        result.candidateId,
        identity
      );
      await recordCandidateNotified({
        orgId: campaign.org_id,
        candidateId: result.candidateId,
        actorUserId: ctx.userId,
        kind: "invite",
        messageId,
      });

      return success(
        { candidate_id: result.candidateId, path: "invite", status: "invited" },
        201
      );
    }

    // ── Skip / vouch path ─────────────────────────────────────────────
    // A CV is required (file or pasted text); without it the recruiter must use
    // the invite path so the candidate supplies one.
    if (!cvFile && !cvText) {
      return error(
        "A CV (file or pasted text) is required to add a candidate directly",
        400
      );
    }

    const consent = validateConsent(consentRaw);
    if (!consent.ok) {
      const messages: Record<string, string> = {
        unknown_attestation_version: "Invalid consent attestation",
        unknown_basis: "A valid consent basis is required",
        note_required_for_other: "A note is required when the basis is 'other'",
      };
      return error(messages[consent.error] ?? "Invalid consent", 400);
    }

    let uploadCv: ((candidateId: string) => Promise<string | null>) | undefined;
    let cvProvenance: "file" | "paste" = "paste";
    let cvFilename: string | null = null;
    if (cvFile) {
      if (cvFile.size > MAX_CV_SIZE) {
        return error("CV file must be under 10MB", 400);
      }
      const dot = cvFile.name.lastIndexOf(".");
      const ext = dot >= 0 ? cvFile.name.slice(dot).toLowerCase() : "";
      if (!ALLOWED_CV_EXTENSIONS.includes(ext)) {
        return error("CV must be a PDF, DOC, or DOCX file", 400);
      }
      const buffer = Buffer.from(await cvFile.arrayBuffer());
      const filename = cvFile.name;
      cvProvenance = "file";
      cvFilename = filename;
      uploadCv = (candidateId) =>
        uploadCV(
          campaign.org_id,
          campaign.client_slug,
          candidateId,
          buffer,
          filename
        );
    }

    const result = await addCandidateBySkip({
      orgId: campaign.org_id,
      campaignId: campaign.id,
      actorUserId: ctx.userId,
      name,
      email,
      phone,
      cvText,
      uploadCv,
      cvFilename,
      cvProvenance,
      gatingAnswers,
      gatingConfig: (campaign.gating_config as GatingQuestion[]) ?? [],
      consent: consent.value,
    });

    // The persistent chat token authenticates the candidate's own surfaces: the
    // "view application" link lands on the status portal (which fires the
    // consent-confirmation CTA before any chat exists), and the opt-out link is
    // their POPIA objection. The portal — not the chat — is the right target:
    // a recruiter-added candidate has no conversation until scoring flags them
    // for follow-up, at which point the normal chat-invitation email is sent.
    const viewUrl = `${origin}/c/${campaign.client_slug}/${campaign.slug}/application#chat_token=${result.chatTokenRaw}`;
    const optOutUrl = `${origin}/api/candidates/opt-out?t=${result.chatTokenRaw}`;
    const messageId = await sendCandidateEmail(
      email.trim().toLowerCase(),
      resolveEmailSubject("recruiterAddedNotice", {
        campaign: { role_title: campaign.role_title },
      }),
      recruiterAddedNoticeEmail(
        emailTheme,
        name.trim(),
        campaign.role_title,
        campaign.client_name ?? "the company",
        viewUrl,
        optOutUrl
      ),
      result.candidateId,
      identity
    );
    await recordCandidateNotified({
      orgId: campaign.org_id,
      candidateId: result.candidateId,
      actorUserId: ctx.userId,
      kind: "added_notice",
      messageId,
    });

    return success(
      {
        candidate_id: result.candidateId,
        path: "skip",
        status: result.status,
        gating_passed: result.gatingPassed,
      },
      201
    );
  } catch (err) {
    console.error("POST /api/admin/campaigns/[id]/candidates error:", err);
    return error("Internal server error", 500);
  }
}
