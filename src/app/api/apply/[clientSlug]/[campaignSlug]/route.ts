import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import { uploadCV } from "@/lib/azure-storage";
import { generateChatToken } from "@/lib/chat-auth";
import {
  applicationReceivedEmail,
  brandEmailIdentity,
  sendCandidateEmail,
} from "@/lib/email";
import { evaluateGating, GatingQuestion } from "@/lib/gating";
import { getQueue } from "@/lib/queue";
import { recordUsageEvent } from "@/lib/usage";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CV_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_CV_EXTENSIONS = [".pdf", ".doc", ".docx"];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientSlug: string; campaignSlug: string }> }
) {
  try {
    const { clientSlug, campaignSlug } = await params;

    // Look up campaign via client slug + campaign slug
    const [campaign] = await db
      .select({
        id: campaigns.id,
        org_id: campaigns.org_id,
        client_id: campaigns.client_id,
        status: campaigns.status,
        role_title: campaigns.role_title,
        gating_config: campaigns.gating_config,
        client_name: clients.name,
        brand_from_name: clients.from_name,
        brand_reply_to: clients.reply_to_email,
      })
      .from(campaigns)
      .innerJoin(clients, eq(campaigns.client_id, clients.id))
      .where(and(eq(clients.slug, clientSlug), eq(campaigns.slug, campaignSlug)))
      .limit(1);

    if (!campaign || campaign.status !== "active") {
      return json({ error: "Campaign not found or not active" }, 404);
    }

    // Parse body (JSON or FormData)
    const contentType = request.headers.get("content-type") ?? "";
    let name: string | undefined;
    let email: string | undefined;
    let phone: string | undefined;
    let whatsappOptIn = false;
    let popiaConsent = false;
    let answers: Record<string, string> = {};
    let source: string | undefined;
    let cvFile: File | null = null;

    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      name = formData.get("name") as string | undefined;
      email = formData.get("email") as string | undefined;
      phone = (formData.get("phone") as string) || undefined;
      whatsappOptIn = formData.get("whatsapp_opt_in") === "true" || formData.get("whatsapp_opt_in") === "on";
      popiaConsent = formData.get("popia_consent") === "true" || formData.get("popia_consent") === "on";
      source = (formData.get("source") as string) || undefined;

      const answersRaw = formData.get("answers");
      if (answersRaw && typeof answersRaw === "string") {
        try { answers = JSON.parse(answersRaw); } catch { /* field-by-field fallback */ }
      }
      if (Object.keys(answers).length === 0) {
        for (const [key, value] of formData.entries()) {
          if (key.startsWith("answer_")) answers[key.replace("answer_", "")] = value as string;
        }
      }

      const file = formData.get("cv");
      if (file && file instanceof File && file.size > 0) cvFile = file;
    } else {
      const body = await request.json();
      name = body.name;
      email = body.email;
      phone = body.phone || undefined;
      whatsappOptIn = !!body.whatsapp_opt_in;
      popiaConsent = !!body.popia_consent;
      answers = body.answers ?? {};
      source = body.source || undefined;
    }

    // Validation
    if (!name || typeof name !== "string" || !name.trim()) return json({ error: "Name is required" }, 400);
    if (!email || typeof email !== "string" || !EMAIL_RE.test(email.trim())) return json({ error: "A valid email address is required" }, 400);
    if (!popiaConsent) return json({ error: "POPIA consent is required to process your application" }, 400);

    if (cvFile) {
      if (cvFile.size > MAX_CV_SIZE) return json({ error: "CV file must be under 10MB" }, 400);
      const ext = cvFile.name.lastIndexOf(".") >= 0 ? cvFile.name.slice(cvFile.name.lastIndexOf(".")).toLowerCase() : "";
      if (!ALLOWED_CV_EXTENSIONS.includes(ext)) return json({ error: "CV must be a PDF, DOC, or DOCX file" }, 400);
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!source) {
      const referer = request.headers.get("referer");
      if (referer) {
        try { source = new URL(referer).searchParams.get("utm_source") ?? undefined; } catch { /* ignore */ }
      }
    }

    const existing = await db.query.candidates.findFirst({
      where: and(eq(candidates.campaign_id, campaign.id), eq(candidates.email, trimmedEmail)),
      columns: { id: true },
    });
    if (existing) return json({ error: "You have already applied for this role" }, 409);

    const gatingConfig = campaign.gating_config as GatingQuestion[];
    const gatingPassed = evaluateGating(answers, gatingConfig);

    const now = new Date();
    const purgeAt = new Date(now);
    purgeAt.setMonth(purgeAt.getMonth() + 12);

    const [newCandidate] = await db.insert(candidates).values({
      // Public write: stamp org_id explicitly from the resolved campaign
      // rather than relying on the DB trigger (dropped in S13).
      org_id: campaign.org_id,
      campaign_id: campaign.id,
      name: name.trim(),
      email: trimmedEmail,
      phone: phone?.trim() || null,
      whatsapp_opted_in: whatsappOptIn,
      gating_answers: answers,
      gating_passed: gatingPassed,
      status: gatingPassed ? "gating_passed" : "gating_failed",
      source: source || null,
      popia_consent_at: now,
      data_purge_at: purgeAt,
    }).returning({ id: candidates.id });

    const candidateName = name.trim();
    const roleTitle = campaign.role_title;
    const clientName = campaign.client_name ?? "the company";
    const candidateId = newCandidate.id;

    // Volume counter — one candidate_created per application (S10, best-effort).
    recordUsageEvent({
      orgId: campaign.org_id,
      brandId: campaign.client_id,
      kind: "candidate_created",
      campaignId: campaign.id,
      candidateId,
    });

    // Generate persistent chat token for in-app chat authentication
    const chatToken = generateChatToken();
    await db
      .update(candidates)
      .set({ chat_token_hash: chatToken.hash })
      .where(eq(candidates.id, candidateId));

    let cvStored = false;
    if (cvFile) {
      const buffer = Buffer.from(await cvFile.arrayBuffer());
      // Org-prefixed path: cvs/{orgId}/{brandSlug}/{candidateId}/… — org_id comes
      // from the resolved campaign (stamped non-null), brandSlug == clientSlug.
      const blobPath = await uploadCV(campaign.org_id, clientSlug, candidateId, buffer, cvFile.name);
      if (blobPath) {
        await db.update(candidates).set({ cv_url: blobPath, updated_at: new Date() }).where(eq(candidates.id, candidateId));
        cvStored = true;
      }
    }

    // Immediate confirmation email (fire-and-forget is acceptable here)
    sendCandidateEmail(
      trimmedEmail,
      `Application received — ${roleTitle}`,
      applicationReceivedEmail(candidateName, roleTitle, clientName),
      candidateId,
      brandEmailIdentity({
        from_name: campaign.brand_from_name,
        reply_to_email: campaign.brand_reply_to,
      })
    ).catch((err) => console.error("Email send failed:", err));

    const queue = getQueue();

    if (gatingPassed) {
      // Queue CV processing only once a CV is actually stored. Candidates
      // who upload via the separate upload endpoint are enqueued there, and
      // the worker backstop picks up anyone whose upload never arrives. The
      // candidate stays in 'gating_passed' until the worker starts — the
      // worker owns the move to 'scoring'.
      if (cvStored) {
        await queue.enqueue(
          { type: "candidate-processing", candidateId },
          { orgId: campaign.org_id, deduplicationId: `process-${candidateId}` }
        );
      }
    } else {
      // Queue soft rejection email — delivered after 24 hours
      const deliverAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await queue.enqueue(
        { type: "send-email", candidateId, emailKind: "gating_failed" },
        { orgId: campaign.org_id, deliverAt, deduplicationId: `reject-email-${candidateId}` }
      );
    }

    return json({ success: true, candidate_id: candidateId, chat_token: chatToken.raw, message: "Thank you for applying! Your application has been received and will be reviewed shortly." }, 201);
  } catch (err) {
    console.error("POST /api/apply error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
