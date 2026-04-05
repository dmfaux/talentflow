import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import { error, requireApiAuth, success } from "@/lib/api";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const [
      campaignStats,
      candidateOverview,
      gatingStats,
      statusBreakdown,
      scoreDistribution,
      recentCampaigns,
      weeklyVolume,
    ] = await Promise.all([
      // 1. Campaign counts by status
      db
        .select({
          status: campaigns.status,
          count: sql<number>`count(*)::int`,
        })
        .from(campaigns)
        .groupBy(campaigns.status),

      // 2. Overall candidate totals
      db
        .select({
          total: sql<number>`count(*)::int`,
          scored: sql<number>`count(*) filter (where ${candidates.ai_score} is not null)::int`,
          shortlisted: sql<number>`count(*) filter (where ${candidates.status} = 'shortlisted')::int`,
          avg_score: sql<number>`round(avg(${candidates.ai_score})::numeric, 1)`,
        })
        .from(candidates),

      // 3. Gating funnel
      db
        .select({
          total: sql<number>`count(*)::int`,
          passed: sql<number>`count(*) filter (where ${candidates.gating_passed} = true)::int`,
          failed: sql<number>`count(*) filter (where ${candidates.gating_passed} = false)::int`,
          pending: sql<number>`count(*) filter (where ${candidates.gating_passed} is null)::int`,
        })
        .from(candidates),

      // 4. Candidate status breakdown
      db
        .select({
          status: candidates.status,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .groupBy(candidates.status)
        .orderBy(sql`count(*) desc`),

      // 5. Score distribution across all campaigns
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
        .where(sql`${candidates.ai_score} is not null`)
        .groupBy(sql`case
          when ${candidates.ai_score} < 2 then '0-2'
          when ${candidates.ai_score} < 4 then '2-4'
          when ${candidates.ai_score} < 6 then '4-6'
          when ${candidates.ai_score} < 8 then '6-8'
          else '8-10'
        end`),

      // 6. Recent/active campaigns with candidate counts
      db
        .select({
          id: campaigns.id,
          role_title: campaigns.role_title,
          client_name: clients.name,
          status: campaigns.status,
          campaign_start: campaigns.campaign_start,
          campaign_end: campaigns.campaign_end,
          total_candidates: sql<number>`count(${candidates.id})::int`,
          shortlisted: sql<number>`count(*) filter (where ${candidates.status} = 'shortlisted')::int`,
          avg_score: sql<number>`round(avg(${candidates.ai_score})::numeric, 1)`,
        })
        .from(campaigns)
        .leftJoin(clients, eq(campaigns.client_id, clients.id))
        .leftJoin(candidates, eq(candidates.campaign_id, campaigns.id))
        .groupBy(campaigns.id, clients.name)
        .orderBy(sql`case when ${campaigns.status} = 'active' then 0 else 1 end, ${campaigns.created_at} desc`)
        .limit(8),

      // 7. Weekly application volume (last 8 weeks)
      db
        .select({
          week: sql<string>`to_char(date_trunc('week', ${candidates.created_at}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(sql`${candidates.created_at} > now() - interval '8 weeks'`)
        .groupBy(sql`date_trunc('week', ${candidates.created_at})`)
        .orderBy(sql`date_trunc('week', ${candidates.created_at})`),
    ]);

    // Normalise campaign stats into an object
    const campaignsByStatus: Record<string, number> = {};
    let totalCampaigns = 0;
    for (const row of campaignStats) {
      campaignsByStatus[row.status] = row.count;
      totalCampaigns += row.count;
    }

    const overview = candidateOverview[0] ?? { total: 0, scored: 0, shortlisted: 0, avg_score: null };
    const gating = gatingStats[0] ?? { total: 0, passed: 0, failed: 0, pending: 0 };

    // Normalise score distribution
    const bucketOrder = ["0-2", "2-4", "4-6", "6-8", "8-10"];
    const scoreMap = new Map(scoreDistribution.map((r) => [r.bucket, r.count]));
    const normalisedScores = bucketOrder.map((bucket) => ({
      bucket,
      count: scoreMap.get(bucket) ?? 0,
    }));

    return success({
      campaigns: {
        total: totalCampaigns,
        by_status: campaignsByStatus,
      },
      candidates: {
        total: overview.total,
        scored: overview.scored,
        shortlisted: overview.shortlisted,
        avg_score: overview.avg_score,
      },
      gating: {
        total: gating.total,
        passed: gating.passed,
        failed: gating.failed,
        pending: gating.pending,
        pass_rate: gating.total > 0
          ? Math.round((gating.passed / gating.total) * 1000) / 10
          : 0,
      },
      status_breakdown: statusBreakdown,
      score_distribution: normalisedScores,
      recent_campaigns: recentCampaigns,
      weekly_volume: weeklyVolume,
    });
  } catch (err) {
    console.error("GET /api/admin/dashboard error:", err);
    return error("Internal server error", 500);
  }
}
