import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { uploadCV } from "@/lib/azure-storage";
import { processNewCandidate } from "@/lib/process-candidate";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Verify campaign
    const [campaign] = await db
      .select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.slug, slug))
      .limit(1);

    if (!campaign || campaign.status !== "active") {
      return json({ error: "Campaign not found or not active" }, 404);
    }

    const formData = await request.formData();
    const candidateId = formData.get("candidate_id") as string | null;
    const file = formData.get("cv") as File | null;

    if (!candidateId) {
      return json({ error: "candidate_id is required" }, 400);
    }

    if (!file || !(file instanceof File) || file.size === 0) {
      return json({ error: "CV file is required" }, 400);
    }

    // Validate file size
    if (file.size > MAX_SIZE) {
      return json({ error: "File must be under 10MB" }, 400);
    }

    // Validate file extension
    const ext = file.name.lastIndexOf(".") >= 0
      ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
      : "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return json({ error: "Only PDF, DOC, and DOCX files are accepted" }, 400);
    }

    // Verify candidate belongs to this campaign
    const candidate = await db.query.candidates.findFirst({
      where: and(
        eq(candidates.id, candidateId),
        eq(candidates.campaign_id, campaign.id)
      ),
      columns: { id: true },
    });

    if (!candidate) {
      return json({ error: "Candidate not found" }, 404);
    }

    // Upload to Azure
    const buffer = Buffer.from(await file.arrayBuffer());
    const blobUrl = await uploadCV(slug, candidateId, buffer, file.name);

    // Update candidate record
    await db
      .update(candidates)
      .set({ cv_url: blobUrl, updated_at: new Date() })
      .where(eq(candidates.id, candidateId));

    // Fire-and-forget: extract text and queue scoring
    processNewCandidate(candidateId).catch((err) =>
      console.error("Background processing failed:", err)
    );

    return json({ success: true, url: blobUrl }, 201);
  } catch (err) {
    console.error("POST /api/apply/[slug]/upload error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
