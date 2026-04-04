import { db } from "@/db";
import { candidates, campaigns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { scoreCandidate } from "./ai-scoring";
import { downloadBlob } from "./azure-storage";
import { extractTextFromCV } from "./cv-parser";

export async function processNewCandidate(
  candidateId: string
): Promise<void> {
  try {
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
      return;
    }

    // Download CV from Azure
    let cvText: string;
    try {
      const blob = await downloadBlob(candidate.cv_url);
      if (!blob) {
        console.warn(`processNewCandidate: Azure Storage not configured — skipping CV processing for ${candidateId}`);
        return;
      }
      cvText = await extractTextFromCV(blob.buffer, blob.contentType);
    } catch (err) {
      console.error(`processNewCandidate: CV extraction failed for ${candidateId}:`, err);

      await db
        .update(candidates)
        .set({
          status: "scored",
          ai_flags: [
            {
              type: "extraction_failed",
              message: err instanceof Error ? err.message : "CV text extraction failed",
            },
          ],
          ai_rationale: "CV could not be processed. Manual review required.",
          updated_at: new Date(),
        })
        .where(eq(candidates.id, candidateId));
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
  } catch (err) {
    console.error(`processNewCandidate: unexpected error for ${candidateId}:`, err);
  }
}
