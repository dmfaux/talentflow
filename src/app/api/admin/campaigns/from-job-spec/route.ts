import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { extractTextFromCV } from "@/lib/cv-parser";
import { slugify, findAvailableCampaignSlug } from "@/lib/slug";
import {
  parseJobSpec,
  JobSpecQualityError,
} from "@/lib/ai/job-spec-schema";
import { AllProvidersFailedError } from "@/lib/ai/providers";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MIN_TEXT_LENGTH = 50;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function errorWithCode(
  message: string,
  errorCode: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: message, error_code: errorCode }, { status });
}

export async function POST(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const formData = await request.formData();

    // ── Validate inputs ─────────────────────────────────────────────

    const clientId = formData.get("client_id");
    if (!clientId || typeof clientId !== "string") {
      return error("client_id is required", 400);
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return error("A job spec file is required", 400);
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return error(
        "Unsupported file type. Please upload a PDF, DOC, or DOCX file.",
        400
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return error("File is too large. Maximum size is 10MB.", 400);
    }

    // ── Verify client exists ────────────────────────────────────────

    const client = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      columns: { id: true, name: true },
    });
    if (!client) return error("Client not found", 404);

    // ── Extract text ────────────────────────────────────────────────

    let extractedText: string;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      extractedText = await extractTextFromCV(buffer, file.type);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Text extraction failed";
      return errorWithCode(message, "extraction_failed", 422);
    }

    if (extractedText.trim().length < MIN_TEXT_LENGTH) {
      return errorWithCode(
        "The document appears to be empty or contains only images. Try a different file format.",
        "extraction_empty",
        422
      );
    }

    // ── AI processing ───────────────────────────────────────────────

    let aiResult: Awaited<ReturnType<typeof parseJobSpec>>;
    try {
      aiResult = await parseJobSpec(extractedText, client.name);
    } catch (err) {
      if (err instanceof AllProvidersFailedError) {
        console.error("Job spec AI: all providers failed", err.attempts);
        return errorWithCode(
          "AI processing failed after trying all available providers. Please try again.",
          "ai_providers_failed",
          502
        );
      }
      if (err instanceof JobSpecQualityError) {
        console.error("Job spec AI: quality validation failed", err.issues);
        return errorWithCode(
          "AI output didn't pass quality checks. Please try again.",
          "ai_quality_invalid",
          502
        );
      }
      // Schema validation or other unexpected error
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("validation failed")) {
        console.error("Job spec AI: schema validation failed", message);
        return errorWithCode(
          "AI returned an unexpected response structure. Please try again.",
          "ai_schema_invalid",
          502
        );
      }
      throw err; // re-throw unexpected errors
    }

    const result = aiResult.output;

    // ── Generate slug ───────────────────────────────────────────────

    const baseSlug = slugify(result.role_title);
    const slug = await findAvailableCampaignSlug(clientId, baseSlug);

    // ── Transform gating questions to wizard format ─────────────────

    const gatingConfig = result.gating_questions.map((q, i) => ({
      id: `import-${i + 1}`,
      label: q.label,
      type: "select" as const,
      options: q.options,
      pass_criteria: q.pass_criteria,
    }));

    // ── Save campaign as draft ──────────────────────────────────────

    const [row] = await db
      .insert(campaigns)
      .values({
        client_id: clientId,
        slug,
        role_title: result.role_title,
        role_description: result.role_description ?? null,
        department: result.department ?? null,
        location: result.location ?? null,
        employment_type: result.employment_type ?? null,
        status: "draft",
        design_brief: result.design_brief ?? null,
        gating_config: gatingConfig,
        scoring_rubric: {
          must_haves: result.must_haves,
          nice_to_haves: result.nice_to_haves,
          dealbreakers: result.dealbreakers,
          dimension_weights: result.dimension_weights,
        },
        salary_range_min: result.salary_range_min ?? null,
        salary_range_max: result.salary_range_max ?? null,
      })
      .returning();

    return success({ id: row.id }, 201);
  } catch (err) {
    console.error("POST /api/admin/campaigns/from-job-spec error:", err);
    return error("Internal server error", 500);
  }
}
