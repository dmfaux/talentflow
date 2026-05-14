import { db } from "@/db";
import { candidates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { scoreCandidate } from "./ai-scoring";
import { downloadBlob } from "./azure-storage";
import { extractTextFromCV } from "./cv-parser";

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

  if (!candidate.cv_url) {
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
      console.warn(
        `processNewCandidate: Azure Storage not configured or CV unavailable for ${candidateId}`
      );
      await markManualReview(
        candidateId,
        "cv_unavailable",
        "The uploaded CV could not be retrieved from storage."
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
