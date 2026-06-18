import { db } from "@/db";
import { campaigns, events } from "@/db/schema";
import { error, getApiTenant, success } from "@/lib/api";
import { orgScope, resolveOwnedResource } from "@/lib/tenant";
import { sql } from "drizzle-orm";
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
  // S4: org-scope every events query. Was an UNSCOPED requireApiAuth read that
  // aggregated every org's visitor analytics. A scoped campaign_id is also
  // ownership-checked → 404 (no cross-org existence/aggregate disclosure).
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const range = parseRange(request.nextUrl.searchParams.get("range"));
    const campaignId = request.nextUrl.searchParams.get("campaign_id");
    const config = RANGE_CONFIG[range];

    // A supplied campaign_id must belong to the caller's org → 404 otherwise.
    if (campaignId) {
      const owned = await resolveOwnedResource(campaigns, campaignId, ctx);
      if (!owned) return error("Campaign not found", 404);
    }

    // Build filters
    const periodFilter = config.days !== null
      ? sql`${events.created_at} > now() - (${config.days} || ' days')::interval`
      : sql`true`;

    const campaignFilter = campaignId
      ? sql`${events.campaign_id} = ${campaignId}`
      : sql`true`;

    // Hard org boundary, AND-ed into every events query below.
    const orgEvents = orgScope(events, ctx);

    const baseFilter = sql`${periodFilter} and ${campaignFilter} and ${orgEvents}`;

    const [
      pageViewStats,
      funnelStats,
      abandonmentData,
      browserBreakdown,
      deviceBreakdown,
      timeSeries,
    ] = await Promise.all([
      // 1. Page view totals + unique visitors (visitor_id for true uniques, session_id for visits)
      db
        .select({
          total: sql<number>`count(*)::int`,
          unique: sql<number>`count(distinct coalesce(${events.visitor_id}, ${events.session_id}))::int`,
          sessions: sql<number>`count(distinct ${events.session_id})::int`,
        })
        .from(events)
        .where(sql`${events.event_type} = 'page_view' and ${baseFilter}`),

      // 2. Funnel: distinct visitors per event type
      db
        .select({
          event_type: events.event_type,
          sessions: sql<number>`count(distinct coalesce(${events.visitor_id}, ${events.session_id}))::int`,
        })
        .from(events)
        .where(sql`${events.event_type} in ('page_view', 'form_start', 'form_submit') and ${baseFilter}`)
        .groupBy(events.event_type),

      // 3. Form abandonment: last field from form_abandon events
      db
        .select({
          field: sql<string>`${events.metadata}->>'last_field'`,
          count: sql<number>`count(*)::int`,
        })
        .from(events)
        .where(sql`${events.event_type} = 'form_abandon' and ${events.metadata}->>'last_field' is not null and ${baseFilter}`)
        .groupBy(sql`${events.metadata}->>'last_field'`)
        .orderBy(sql`count(*) desc`),

      // 4. Browser breakdown (from page_view events for unique visitors)
      db
        .select({
          browser: events.browser,
          count: sql<number>`count(distinct coalesce(${events.visitor_id}, ${events.session_id}))::int`,
        })
        .from(events)
        .where(sql`${events.event_type} = 'page_view' and ${baseFilter}`)
        .groupBy(events.browser)
        .orderBy(sql`count(distinct coalesce(${events.visitor_id}, ${events.session_id})) desc`),

      // 5. Device breakdown (from page_view events for unique visitors)
      db
        .select({
          device_type: events.device_type,
          count: sql<number>`count(distinct coalesce(${events.visitor_id}, ${events.session_id}))::int`,
        })
        .from(events)
        .where(sql`${events.event_type} = 'page_view' and ${baseFilter}`)
        .groupBy(events.device_type)
        .orderBy(sql`count(distinct coalesce(${events.visitor_id}, ${events.session_id})) desc`),

      // 6. Page views time series
      (() => {
        const bucket = config.bucket;
        const bucketExpr = sql.raw(`date_trunc('${bucket}', "events"."created_at")`);
        const intervalExpr = sql.raw(`${config.periods - 1} ${bucket}s`);
        const tsFilter = config.days !== null
          ? sql`"events"."created_at" > date_trunc('${sql.raw(bucket)}', now()) - interval '${intervalExpr}'`
          : sql`"events"."created_at" > date_trunc('month', now()) - interval '23 months'`;

        const campaignCond = campaignId
          ? sql`${events.campaign_id} = ${campaignId}`
          : sql`true`;

        return db
          .select({
            period: sql<string>`to_char(${bucketExpr}, 'YYYY-MM-DD')`,
            views: sql<number>`count(*)::int`,
            unique: sql<number>`count(distinct coalesce(${events.visitor_id}, ${events.session_id}))::int`,
          })
          .from(events)
          .where(sql`${events.event_type} = 'page_view' and ${tsFilter} and ${campaignCond} and ${orgEvents}`)
          .groupBy(bucketExpr)
          .orderBy(bucketExpr);
      })(),
    ]);

    // Assemble funnel
    const funnelMap = new Map(funnelStats.map((r) => [r.event_type, r.sessions]));
    const pageViews = funnelMap.get("page_view") ?? 0;
    const formStarts = funnelMap.get("form_start") ?? 0;
    const formSubmits = funnelMap.get("form_submit") ?? 0;

    const pvStats = pageViewStats[0] ?? { total: 0, unique: 0, sessions: 0 };

    return success({
      range,
      granularity: config.bucket,
      visitors: {
        total: pvStats.total,
        unique: pvStats.unique,
        sessions: pvStats.sessions,
        time_series: timeSeries,
      },
      funnel: {
        page_views: pageViews,
        form_starts: formStarts,
        form_submits: formSubmits,
        view_to_start_pct: pageViews > 0
          ? Math.round((formStarts / pageViews) * 1000) / 10
          : 0,
        start_to_submit_pct: formStarts > 0
          ? Math.round((formSubmits / formStarts) * 1000) / 10
          : 0,
      },
      abandonment: {
        drop_off_by_field: abandonmentData,
      },
      browsers: browserBreakdown,
      devices: deviceBreakdown,
    });
  } catch (err) {
    console.error("GET /api/admin/analytics error:", err);
    return error("Internal server error", 500);
  }
}
