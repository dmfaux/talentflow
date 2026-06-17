import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import { uploadCV } from "@/lib/azure-storage";
import { getQueue } from "@/lib/queue";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientSlug: string; campaignSlug: string }> }
) {
  try {
    const { clientSlug, campaignSlug } = await params;

    const [campaign] = await db
      // org_id is needed to build the org-prefixed CV path (S6); this route
      // writes a CV blob whereas the apply POST already selected it.
      .select({ id: campaigns.id, org_id: campaigns.org_id, status: campaigns.status })
      .from(campaigns)
      .innerJoin(clients, eq(campaigns.client_id, clients.id))
      .where(and(eq(clients.slug, clientSlug), eq(campaigns.slug, campaignSlug)))
      .limit(1);

    if (!campaign || campaign.status !== "active") {
      return json({ error: "Campaign not found or not active" }, 404);
    }

    const formData = await request.formData();
    const candidateId = formData.get("candidate_id") as string | null;
    const file = formData.get("cv") as File | null;

    if (!candidateId) return json({ error: "candidate_id is required" }, 400);
    if (!file || !(file instanceof File) || file.size === 0) return json({ error: "CV file is required" }, 400);
    if (file.size > MAX_SIZE) return json({ error: "File must be under 10MB" }, 400);

    const ext = file.name.lastIndexOf(".") >= 0 ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) return json({ error: "Only PDF, DOC, and DOCX files are accepted" }, 400);

    const candidate = await db.query.candidates.findFirst({
      where: and(eq(candidates.id, candidateId), eq(candidates.campaign_id, campaign.id)),
      columns: { id: true, gating_passed: true },
    });
    if (!candidate) return json({ error: "Candidate not found" }, 404);

    const buffer = Buffer.from(await file.arrayBuffer());
    const blobPath = await uploadCV(campaign.org_id, clientSlug, candidateId, buffer, file.name);

    if (blobPath) {
      await db.update(candidates).set({ cv_url: blobPath, updated_at: new Date() }).where(eq(candidates.id, candidateId));
      if (candidate.gating_passed) {
        // The worker owns the move to 'scoring' once it starts processing.
        await getQueue().enqueue(
          { type: "candidate-processing", candidateId },
          { deduplicationId: `process-${candidateId}` }
        );
      }
    }

    // Don't echo the internal blob path back to the public caller — the CV is
    // private and only retrievable via an authorised SAS.
    return json({ success: true, stored: !!blobPath }, 201);
  } catch (err) {
    console.error("POST /api/apply/upload error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
