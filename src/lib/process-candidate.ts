import { db } from "@/db";
import { candidates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { scoreCandidate } from "./ai-scoring";
import { downloadBlob, isStorageConfigured } from "./azure-storage";
import { extractTextFromCV } from "./cv-parser";

/** Grace window for deferred CV uploads before a missing CV becomes terminal. */
const MISSING_CV_GRACE_MS = 15 * 60 * 1000;

async function markManualReview(
  candidateId: string,
  type: string,
  message: string
): Promise<void> {
  await db
    .update(candidates)
    .set({
      status: "scored",
      ai_flags: [{ type, message }],
      ai_rationale: "Candidate could not be processed automatically. Manual review required.",
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));
}

export async function processNewCandidate(
  candidateId: string
): Promise<void> {
  // Fetch candidate with campaign
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, candidateId),
    with: { campaign: true },
  });

  if (!candidate) {
    console.error(`processNewCandidate: candidate ${candidateId} not found`);
    return;
  }

  // A recruiter-added (skip-path) candidate may arrive with pasted CV text and
  // no uploaded file. Score directly from the text we already hold rather than
  // treating the absent cv_url as a missing CV. Public applicants reach this
  // function with cv_text empty (it is populated by extraction below), so this
  // only short-circuits the paste path.
  if (candidate.cv_text && candidate.cv_text.trim()) {
    await db
      .update(candidates)
      .set({ status: "scoring", updated_at: new Date() })
      .where(eq(candidates.id, candidateId));
    await scoreCandidate(candidateId);
    return;
  }

  if (!candidate.cv_url) {
    // Storage being unconfigured (local dev, missing env) means CVs are
    // discarded at upload — flagging the candidate would be terminal and
    // wrong. Leave them untouched so they are processable once storage works.
    if (!isStorageConfigured()) {
      console.warn(
        `processNewCandidate: Azure Storage not configured — skipping CV processing for ${candidateId}`
      );
      return;
    }
    // A deferred upload may still be in flight — skip and let the worker
    // backstop requeue once the grace window has passed.
    const ageMs = Date.now() - candidate.created_at.getTime();
    if (ageMs < MISSING_CV_GRACE_MS) {
      console.warn(
        `processNewCandidate: candidate ${candidateId} has no CV yet — waiting for deferred upload`
      );
      return;
    }
    console.error(`processNewCandidate: candidate ${candidateId} has no CV`);
    await markManualReview(
      candidateId,
      "missing_cv",
      "No CV file was available when automatic processing ran."
    );
    return;
  }

  // Download CV from Azure
  let cvText: string;
  try {
    const blob = await downloadBlob(candidate.cv_url);
    if (!blob) {
      // downloadBlob returns null only when storage is unconfigured — a
      // recoverable deployment state, not a candidate problem. Leave the
      // candidate untouched so processing can resume once storage works.
      console.warn(
        `processNewCandidate: Azure Storage not configured — skipping CV processing for ${candidateId}`
      );
      return;
    }
    cvText = await extractTextFromCV(blob.buffer, blob.contentType);
  } catch (err) {
    console.error(`processNewCandidate: CV extraction failed for ${candidateId}:`, err);

    await markManualReview(
      candidateId,
      "extraction_failed",
      err instanceof Error ? err.message : "CV text extraction failed"
    );
    return;
  }

  // Save extracted text and update status
  await db
    .update(candidates)
    .set({
      cv_text: cvText,
      status: "scoring",
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));

  // Score candidate with AI
  await scoreCandidate(candidateId);
}
