import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { error, getApiTenant, success } from "@/lib/api";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // S4: resolve the campaign WITHIN the caller's org → cross-org id 404s before
  // any candidate is read. Was an UNSCOPED requireApiAuth read exposing every
  // org's applicants. orgScope on the candidate query is defence-in-depth.
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    // Verify campaign exists AND belongs to the caller's org.
    const campaign = await resolveOwnedResource(campaigns, id, ctx);
    if (!campaign) return error("Campaign not found", 404);

    const { searchParams } = request.nextUrl;
    const statusFilter = searchParams.get("status");
    const minScore = searchParams.get("min_score");
    const maxScore = searchParams.get("max_score");
    const confidenceFilter = searchParams.get("confidence");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const conditions = [eq(candidates.campaign_id, id), orgScope(candidates, ctx)];
    if (statusFilter) conditions.push(eq(candidates.status, statusFilter));
    if (minScore) conditions.push(gte(candidates.ai_score, parseFloat(minScore)));
    if (maxScore) conditions.push(lte(candidates.ai_score, parseFloat(maxScore)));
    if (confidenceFilter) conditions.push(eq(candidates.ai_confidence, confidenceFilter));

    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(candidates)
        .where(where)
        .orderBy(desc(candidates.ai_score))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(candidates)
        .where(where),
    ]);

    return success({
      candidates: rows,
      total: countResult[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("GET /api/admin/campaigns/[id]/candidates error:", err);
    return error("Internal server error", 500);
  }
}
