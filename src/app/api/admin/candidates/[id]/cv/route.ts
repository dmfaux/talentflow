import { candidates } from "@/db/schema";
import { error, getApiTenant, success } from "@/lib/api";
import { generateSasUrl } from "@/lib/azure-storage";
import { resolveOwnedResource } from "@/lib/tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    // Resolve the candidate WITHIN the caller's org. A cross-tenant (or
    // missing) id returns null → 404 BEFORE generateSasUrl is reached, so no
    // SAS is ever minted for another org's CV (the headline S6 acceptance).
    // Any in-org member may download — org-scoped, not role-gated (Decision 3).
    const candidate = await resolveOwnedResource(candidates, id, ctx);

    if (!candidate) return error("Candidate not found", 404);
    if (!candidate.cv_url) return error("No CV uploaded", 404);

    const sasUrl = generateSasUrl(candidate.cv_url, 1);
    if (!sasUrl) return error("Azure Storage not configured", 503);
    return success({ url: sasUrl });
  } catch (err) {
    console.error("GET /api/admin/candidates/[id]/cv error:", err);
    return error("Internal server error", 500);
  }
}
