import { db } from "@/db";
import { candidates } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { generateSasUrl } from "@/lib/azure-storage";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const candidate = await db.query.candidates.findFirst({
      where: eq(candidates.id, id),
      columns: { cv_url: true },
    });

    if (!candidate) return error("Candidate not found", 404);
    if (!candidate.cv_url) return error("No CV uploaded", 404);

    const sasUrl = generateSasUrl(candidate.cv_url, 1);
    return success({ url: sasUrl });
  } catch (err) {
    console.error("GET /api/admin/candidates/[id]/cv error:", err);
    return error("Internal server error", 500);
  }
}
