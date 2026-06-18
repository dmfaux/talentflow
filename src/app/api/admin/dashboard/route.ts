import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import { error, getApiTenant, success } from "@/lib/api";
import { orgScope } from "@/lib/tenant";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

type Range = "week" | "month" | "quarter" | "year" | "all";

const RANGE_CONFIG: Record<Range, { days: number | null; bucket: "day" | "week" | "month"; periods: number }> = {
  week: { days: 7, bucket: "day", periods: 7 },
  month: { days: 30, bucket: "day", periods: 30 },
  quarter: { days: 91, bucket: "week", periods: 13 },
  year: { days: 365, bucket: "month", periods: 12 },
  all: { days: null, bucket: "month", periods: 24 },
};

function parseRange(param: string | null): Range {
  if (param === "week" || param === "month" || param === "quarter" || param === "year" || param === "all") {
    return param;
  }
  return "month";
}

export async function GET(request: NextRequest) {
  // S4: org-scope every sub-query. Was an UNSCOPED requireApiAuth read that
  // aggregated/listed every org's campaigns + candidates (the cross-tenant
  // dashboard leak). org_id is the hard boundary; a non-acting operator's
  // orgScope is FALSE → all-zero dashboard.
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const range = parseRange(request.nextUrl.searchParams.get("range"));
    const config = RANGE_CONFIG[range];

    // Build the period filter SQL fragment
    const periodFilter = config.days !== null
      ? sql`${candidates.created_at} > now() - (${config.days} || ' days')::interval`
      : sql`true`;

    // The hard org boundary, AND-ed into every candidate/campaign sub-query.
    const orgCampaigns = orgScope(campaigns, ctx);
    const orgCandidates = orgScope(candidates, ctx);

    const [
      campaignStats,
      candidateOverview,
      gatingStats,
      statusBreakdown,
      scoreDistribution,
      recentCampaigns,
      timeSeries,
    ] = await Promise.all([
      // 1. Campaign counts by status (not filtered — campaign lifecycle is independent of period)
      db
        .select({
          status: campaigns.status,
          count: sql<number>`count(*)::int`,
        })
        .from(campaigns)
        .where(orgCampaigns)
        .groupBy(campaigns.status),

      // 2. Overall candidate totals (filtered by period)
      db
        .select({
          total: sql<number>`count(*)::int`,
          scored: sql<number>`count(*) filter (where ${candidates.ai_score} is not null)::int`,
          shortlisted: sql<number>`count(*) filter (where ${candidates.status} = 'shortlisted')::int`,
          avg_score: sql<number>`round(avg(${candidates.ai_score})::numeric, 1)`,
        })
        .from(candidates)
        .where(and(periodFilter, orgCandidates)),

      // 3. Gating funnel (filtered by period)
      db
        .select({
          total: sql<number>`count(*)::int`,
          passed: sql<number>`count(*) filter (where ${candidates.gating_passed} = true)::int`,
          failed: sql<number>`count(*) filter (where ${candidates.gating_passed} = false)::int`,
          pending: sql<number>`count(*) filter (where ${candidates.gating_passed} is null)::int`,
        })
        .from(candidates)
        .where(and(periodFilter, orgCandidates)),

      // 4. Candidate status breakdown (filtered by period)
      db
        .select({
          status: candidates.status,
          count: sql<number>`count(*)::int`,
        })
        .from(candidates)
        .where(and(periodFilter, orgCandidates))
        .groupBy(candidates.status)
        .orderBy(sql`count(*) desc`),

      // 5. Score distribution (filtered by period)
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
        .where(and(sql`${candidates.ai_score} is not null and ${periodFilter}`, orgCandidates))
        .groupBy(sql`case
          when ${candidates.ai_score} < 2 then '0-2'
          when ${candidates.ai_score} < 4 then '2-4'
          when ${candidates.ai_score} < 6 then '4-6'
          when ${candidates.ai_score} < 8 then '6-8'
          else '8-10'
        end`),

      // 6. Recent/active campaigns — unfiltered
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
        .where(orgCampaigns)
        .groupBy(campaigns.id, clients.name)
        .orderBy(sql`case when ${campaigns.status} = 'active' then 0 else 1 end, ${campaigns.created_at} desc`)
        .limit(8),

      // 7. Time-series application volume — adapts range + granularity to selected period
      (() => {
        const bucket = config.bucket; // 'day' | 'week' | 'month'
        // Shared expression for both SELECT and GROUP BY to satisfy Postgres's
        // structural equality check — bucket is injected via sql.raw so it becomes
        // a literal rather than a bind parameter.
        const bucketExpr = sql.raw(`date_trunc('${bucket}', "candidates"."created_at")`);
        const intervalExpr = sql.raw(`${config.periods - 1} ${bucket}s`);
        const tsFilter = config.days !== null
          ? sql`"candidates"."created_at" > date_trunc('${sql.raw(bucket)}', now()) - interval '${intervalExpr}'`
          : sql`"candidates"."created_at" > date_trunc('month', now()) - interval '23 months'`;

        return db
          .select({
            period: sql<string>`to_char(${bucketExpr}, 'YYYY-MM-DD')`,
            count: sql<number>`count(*)::int`,
          })
          .from(candidates)
          .where(and(tsFilter, orgCandidates))
          .groupBy(bucketExpr)
          .orderBy(bucketExpr);
      })(),
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

    const bucketOrder = ["0-2", "2-4", "4-6", "6-8", "8-10"];
    const scoreMap = new Map(scoreDistribution.map((r) => [r.bucket, r.count]));
    const normalisedScores = bucketOrder.map((bucket) => ({
      bucket,
      count: scoreMap.get(bucket) ?? 0,
    }));

    return success({
      range,
      granularity: config.bucket,
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
      time_series: timeSeries,
    });
  } catch (err) {
    console.error("GET /api/admin/dashboard error:", err);
    return error("Internal server error", 500);
  }
}
