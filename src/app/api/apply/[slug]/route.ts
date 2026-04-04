import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import { evaluateGating, GatingQuestion } from "@/lib/gating";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Look up campaign
    const [campaign] = await db
      .select({
        id: campaigns.id,
        status: campaigns.status,
        gating_config: campaigns.gating_config,
      })
      .from(campaigns)
      .where(eq(campaigns.slug, slug))
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

    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      name = formData.get("name") as string | undefined;
      email = formData.get("email") as string | undefined;
      phone = (formData.get("phone") as string) || undefined;
      whatsappOptIn = formData.get("whatsapp_opt_in") === "true" || formData.get("whatsapp_opt_in") === "on";
      popiaConsent = formData.get("popia_consent") === "true" || formData.get("popia_consent") === "on";
      source = (formData.get("source") as string) || undefined;

      // Parse answers from form fields named "answer_[questionId]"
      const answersRaw = formData.get("answers");
      if (answersRaw && typeof answersRaw === "string") {
        try {
          answers = JSON.parse(answersRaw);
        } catch {
          // Fall through to field-by-field parsing
        }
      }
      if (Object.keys(answers).length === 0) {
        for (const [key, value] of formData.entries()) {
          if (key.startsWith("answer_")) {
            answers[key.replace("answer_", "")] = value as string;
          }
        }
      }
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
    if (!name || typeof name !== "string" || !name.trim()) {
      return json({ error: "Name is required" }, 400);
    }
    if (!email || typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      return json({ error: "A valid email address is required" }, 400);
    }
    if (!popiaConsent) {
      return json({ error: "POPIA consent is required to process your application" }, 400);
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Check for source from utm_source in referer if not already set
    if (!source) {
      const referer = request.headers.get("referer");
      if (referer) {
        try {
          const refUrl = new URL(referer);
          source = refUrl.searchParams.get("utm_source") ?? undefined;
        } catch {
          // ignore malformed referer
        }
      }
    }

    // Check duplicate
    const existing = await db.query.candidates.findFirst({
      where: and(
        eq(candidates.campaign_id, campaign.id),
        eq(candidates.email, trimmedEmail)
      ),
      columns: { id: true },
    });

    if (existing) {
      return json({ error: "You have already applied for this role" }, 409);
    }

    // Evaluate gating
    const gatingConfig = campaign.gating_config as GatingQuestion[];
    const gatingPassed = evaluateGating(answers, gatingConfig);

    // Create candidate
    const now = new Date();
    const purgeAt = new Date(now);
    purgeAt.setMonth(purgeAt.getMonth() + 12);

    await db.insert(candidates).values({
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
    });

    if (gatingPassed) {
      return json({
        success: true,
        passed: true,
        message: "Thank you for applying! Your application has been received and will be reviewed shortly.",
      }, 201);
    }

    return json({
      success: true,
      passed: false,
      message: "Thank you for your interest. Unfortunately, your profile does not meet the minimum requirements for this role at this time.",
    }, 201);
  } catch (err) {
    console.error("POST /api/apply/[slug] error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
