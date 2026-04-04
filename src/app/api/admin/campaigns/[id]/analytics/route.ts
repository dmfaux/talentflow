import { db } from "@/db";
import { campaigns, candidates, scoringLogs } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { eq, sql } from "drizzle-orm";

// TODO: Extend the campaign dashboard page with charts (e.g. recharts or
// chart.js) that consume this analytics data to visualise application
// volume over time, score distribution, and source breakdown.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const campaign = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, id),
      columns: { id: true },
    });

    if (!campaign) return error("Campaign not found", 404);

    // All queries run in parallel
    const [
      dailyVolume,
      gatingStats,
      scoreDistribution,
      sourceBreakdown,
      statusBreakdown,
      processingStats,
    ] = await Promise.all([
      // 1. Application volume over time
      db
        .select({
          date: sql<string>`to_char(${candidates.created_at}::date, 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(eq(candidates.campaign_id, id))
        .groupBy(sql`${candidates.created_at}::date`)
        .orderBy(sql`${candidates.created_at}::date`),

      // 2. Gating pass rate
      db
        .select({
          total: sql<number>`count(*)::int`,
          passed: sql<number>`count(*) filter (where ${candidates.gating_passed} = true)::int`,
          failed: sql<number>`count(*) filter (where ${candidates.gating_passed} = false)::int`,
        })
        .from(candidates)
        .where(eq(candidates.campaign_id, id)),

      // 3. Score distribution
      db
        .select({
          bucket: sql<string>`case
            when ${candidates.ai_score} < 2 then '0-2'
            when ${candidates.ai_score} < 4 then '2-4'
            when ${candidates.ai_score} < 6 then '4-6'
            when ${candidates.ai_score} < 8 then '6-8'
            else '8-10'
          end`,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(eq(candidates.campaign_id, id))
        .groupBy(sql`case
          when ${candidates.ai_score} < 2 then '0-2'
          when ${candidates.ai_score} < 4 then '2-4'
          when ${candidates.ai_score} < 6 then '4-6'
          when ${candidates.ai_score} < 8 then '6-8'
          else '8-10'
        end`),

      // 4. Source breakdown
      db
        .select({
          source: sql<string>`coalesce(${candidates.source}, 'direct')`,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(eq(candidates.campaign_id, id))
        .groupBy(sql`coalesce(${candidates.source}, 'direct')`)
        .orderBy(sql`count(*) desc`),

      // 5. Status breakdown
      db
        .select({
          status: candidates.status,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(eq(candidates.campaign_id, id))
        .groupBy(candidates.status),

      // 6. Average processing time
      db
        .select({
          mean: sql<number>`round(avg(${scoringLogs.processing_time_ms}))::int`,
          median: sql<number>`round(percentile_cont(0.5) within group (order by ${scoringLogs.processing_time_ms}))::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(scoringLogs)
        .innerJoin(candidates, eq(scoringLogs.candidate_id, candidates.id))
        .where(eq(candidates.campaign_id, id)),
    ]);

    const gating = gatingStats[0] ?? { total: 0, passed: 0, failed: 0 };
    const passRate = gating.total > 0
      ? Math.round((gating.passed / gating.total) * 1000) / 10
      : 0;

    // Normalise score distribution to include all buckets
    const bucketOrder = ["0-2", "2-4", "4-6", "6-8", "8-10"];
    const scoreMap = new Map(scoreDistribution.map((r) => [r.bucket, r.count]));
    const normalisedScores = bucketOrder.map((bucket) => ({
      bucket,
      count: scoreMap.get(bucket) ?? 0,
    }));

    const processing = processingStats[0] ?? { mean: null, median: null, count: 0 };

    return success({
      daily_volume: dailyVolume,
      gating: {
        total: gating.total,
        passed: gating.passed,
        failed: gating.failed,
        pass_rate: passRate,
      },
      score_distribution: normalisedScores,
      source_breakdown: sourceBreakdown,
      status_breakdown: statusBreakdown,
      processing_time: {
        mean_ms: processing.mean,
        median_ms: processing.median,
        scored_count: processing.count,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/campaigns/[id]/analytics error:", err);
    return error("Internal server error", 500);
  }
}
