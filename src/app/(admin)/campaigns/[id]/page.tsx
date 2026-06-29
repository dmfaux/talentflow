import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { and, desc, asc, eq, sql } from "drizzle-orm";
import { CampaignActions } from "@/components/admin/campaign-actions";
import { CampaignTabs } from "@/components/admin/campaign-tabs";
import { CampaignUrl } from "@/components/admin/campaign-url";
import { AddCandidateModal } from "@/components/admin/add-candidate-modal";
import { CandidateTable } from "@/components/admin/candidate-table";
import { ShortlistTab } from "@/components/admin/shortlist-tab";
import type { GatingQuestion } from "@/lib/gating";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/card";
import { canAccessBrand, orgScope, requireTenant } from "@/lib/tenant";
import { getCampaignSpend } from "@/lib/pricing";
import { Suspense } from "react";

const zarFmt = (n: number) => "R" + Math.round(n).toLocaleString("en-ZA");
// Distinct AA-safe hues per tier (gold token is the teal misnomer — too faint as
// a bar fill on light, so the top tier reads in saffron).
const TIER_BAR: Record<string, string> = {
  essential: "bg-moss",
  professional: "bg-cobalt",
  executive: "bg-saffron",
};

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

// Shared with the dashboard + list so a status reads identically everywhere.
const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  active: "moss",
  paused: "saffron",
  closed: "red",
  archived: "neutral",
};

function daysAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Started today";
  if (diff === 1) return "Started 1 day ago";
  return `Started ${diff} days ago`;
}

export default async function CampaignDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const activeTab = sp.tab ?? "candidates";

  // S4: requireTenant() (the cached layout guard) resolves first so its ctx
  // org-scopes the read — a cross-org campaign id notFound()s instead of
  // rendering another tenant's pipeline.
  const ctx = await requireTenant();

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, id), orgScope(campaigns, ctx)),
    with: { client: true },
  });

  if (!campaign) notFound();

  // AI spend for this campaign (only when the Spend tab is open — one extra query).
  const campaignSpend =
    activeTab === "spend" ? await getCampaignSpend(ctx, id) : null;

  // Role-gate the mutation controls (recruiter+ on this brand). Cosmetic only —
  // the campaign routes enforce the same check server-side.
  const canManageCampaign = await canAccessBrand(ctx, campaign.client_id, "recruiter");

  // Candidate counts by status
  const statusCounts = await db
    .select({
      status: candidates.status,
      count: sql<number>`count(*)::int`,
    })
    .from(candidates)
    .where(and(eq(candidates.campaign_id, id), orgScope(candidates, ctx)))
    .groupBy(candidates.status);

  const counts: Record<string, number> = {};
  for (const row of statusCounts) counts[row.status] = row.count;

  const totalApplied = Object.values(counts).reduce((a, b) => a + b, 0);
  const passedGating =
    (counts.gating_passed ?? 0) + (counts.scoring ?? 0) + (counts.scored ?? 0) +
    (counts.shortlisted ?? 0) + (counts.follow_up ?? 0) + (counts.rejected ?? 0) +
    (counts.no_response ?? 0) + (counts.withdrawn ?? 0);
  const aiScored =
    (counts.scored ?? 0) + (counts.shortlisted ?? 0) + (counts.rejected ?? 0) +
    (counts.follow_up ?? 0);
  const shortlisted = counts.shortlisted ?? 0;
  const awaitingReview = (counts.scored ?? 0) + (counts.follow_up ?? 0);

  const [scoreAgg] = await db
    .select({
      top: sql<number>`max(${candidates.ai_score})`,
      avg: sql<number>`avg(${candidates.ai_score})`,
    })
    .from(candidates)
    .where(and(eq(candidates.campaign_id, id), orgScope(candidates, ctx)));
  const topScore = scoreAgg?.top ?? null;
  const avgScore = scoreAgg?.avg ?? null;

  // Top scorer (for the quality rail)
  const [topScorer] = topScore != null
    ? await db
        .select({ name: candidates.name, confidence: candidates.ai_confidence })
        .from(candidates)
        .where(and(eq(candidates.campaign_id, id), eq(candidates.ai_score, topScore), orgScope(candidates, ctx)))
        .limit(1)
    : [undefined];

  // Flagged = scored candidates with non-empty ai_flags array
  const [flaggedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(candidates)
    .where(
      and(
        eq(candidates.campaign_id, id),
        sql`jsonb_array_length(coalesce(${candidates.ai_flags}, '[]'::jsonb)) > 0`,
        orgScope(candidates, ctx),
      ),
    );
  const flagged = flaggedRow?.count ?? 0;

  // Candidate table data
  const limit = 20;
  const offset = parseInt(sp.offset ?? "0", 10);
  const statusFilter = sp.status;
  const confidenceFilter = sp.confidence;
  const sort = sp.sort ?? "score_desc";

  const conditions = [eq(candidates.campaign_id, id), orgScope(candidates, ctx)];
  if (statusFilter) conditions.push(eq(candidates.status, statusFilter));
  if (confidenceFilter) conditions.push(eq(candidates.ai_confidence, confidenceFilter));

  const where = and(...conditions);
  // Unscored candidates have a null ai_score; Postgres sorts nulls first for
  // DESC by default, which would float not-yet-scored candidates above the top
  // scorers in the default view. Force them to the bottom.
  const orderBy =
    sort === "score_asc" ? [sql`${candidates.ai_score} asc nulls last`]
    : sort === "date_desc" ? [desc(candidates.created_at)]
    : sort === "date_asc" ? [asc(candidates.created_at)]
    : [sql`${candidates.ai_score} desc nulls last`];

  const [candidateRows, countResult] = await Promise.all([
    db.select().from(candidates).where(where).orderBy(...orderBy).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(candidates).where(where),
  ]);

  const candidateTotal = countResult[0]?.total ?? 0;

  // Shortlist data
  const shortlistRows = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.campaign_id, id), eq(candidates.status, "shortlisted"), orgScope(candidates, ctx)))
    .orderBy(desc(candidates.ai_score));

  const pctOf = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 100) : 0;

  const pipeline = [
    { label: "Applied", value: totalApplied, barClass: "bg-ink/85" },
    { label: "Passed gating", value: passedGating, barClass: "bg-cobalt/80" },
    { label: "AI scored", value: aiScored, barClass: "bg-saffron/80" },
    { label: "Shortlisted", value: shortlisted, barClass: "bg-moss/85" },
  ];
  const maxPipeline = Math.max(totalApplied, 1);
  const conversions = [
    pctOf(passedGating, totalApplied),
    pctOf(aiScored, passedGating),
    pctOf(shortlisted, aiScored),
  ];
  const shortlistRate = pctOf(shortlisted, totalApplied);
  const topScoreFormatted = topScore != null ? topScore.toFixed(1) : null;
  const avgScoreFormatted = avgScore != null ? Number(avgScore).toFixed(1) : null;
  const hasApplicants = totalApplied > 0;

  const isDev = process.env.NODE_ENV !== "production";
  const campaignUrl =
    !isDev && process.env.NEXT_PUBLIC_APP_DOMAIN
      ? `https://${campaign.client?.slug}.${process.env.NEXT_PUBLIC_APP_DOMAIN}/${campaign.slug}`
      : `/c/${campaign.client?.slug}/${campaign.slug}`;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/campaigns" className="hover:text-ink transition-colors">Campaigns</Link>
        <span>/</span>
        <span className="text-ink-soft">{campaign.role_title}</span>
      </div>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl italic text-ink">{campaign.role_title}</h1>
            <Badge tone={STATUS_TONE[campaign.status] ?? "neutral"} dot className="capitalize">
              {campaign.status}
            </Badge>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-soft">
            <span>{campaign.client?.name ?? "\u2014"}</span>
            <span className="text-ink-muted">&middot;</span>
            <span>
              {campaign.status === "draft"
                ? "Not started"
                : campaign.campaign_start
                  ? daysAgo(new Date(campaign.campaign_start))
                  : "\u2014"}
            </span>
            <span className="text-ink-muted">&middot;</span>
            <CampaignUrl url={campaignUrl} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AddCandidateModal
            campaignId={campaign.id}
            status={campaign.status}
            gatingConfig={(campaign.gating_config as GatingQuestion[]) ?? []}
            canManage={canManageCampaign}
          />
          <CampaignActions campaignId={campaign.id} status={campaign.status} canManage={canManageCampaign} />
        </div>
      </div>

      {/* Overview — pipeline funnel + quality rail */}
      <div className="mb-6 grid grid-cols-1 overflow-hidden rounded-2xl border border-rule bg-surface lg:grid-cols-[1.6fr_1fr]">
        {/* Funnel */}
        <div className="relative px-7 py-6 lg:border-r lg:border-rule">
          <div className="mb-5 flex items-baseline justify-between">
            <span className="eyebrow text-ink-muted">Pipeline</span>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
              {hasApplicants ? `${totalApplied} total` : "awaiting intake"}
            </span>
          </div>

          {hasApplicants ? (
            <div className="space-y-1.5">
              {pipeline.map((stage, i) => {
                const pct = (stage.value / maxPipeline) * 100;
                const prev = i === 0 ? null : pipeline[i - 1];
                const convoPct = prev ? conversions[i - 1] : null;
                const dropped = prev ? prev.value - stage.value : 0;
                return (
                  <div key={stage.label}>
                    {prev && (
                      <div className="flex items-center gap-3 py-1 pl-24">
                        <span className="h-3 w-px bg-rule-strong/60" />
                        <span className="font-mono text-[0.63rem] uppercase tracking-[0.12em] text-ink-muted">
                          {convoPct}% through
                          {dropped > 0 && (
                            <span className="ml-2 text-ink-muted/70">&middot; {dropped} dropped</span>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-4">
                      <span className="w-20 shrink-0 text-[0.78rem] font-medium text-ink-soft">
                        {stage.label}
                      </span>
                      <div className="relative flex-1 h-9 rounded-md bg-canvas/70">
                        <div
                          className={`h-full rounded-md ${stage.barClass} transition-[width] duration-700 ease-out`}
                          style={{ width: `${Math.max(pct, stage.value > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right font-mono text-sm font-semibold text-ink tabular-nums">
                        {stage.value}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="font-serif text-lg italic text-ink-soft">
                No applicants yet.
              </p>
              <p className="max-w-sm text-sm text-ink-muted">
                Once your campaign URL starts collecting responses, the funnel
                will chart each stage&rsquo;s volume and the conversion between them.
              </p>
              <a
                href={campaignUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-cobalt hover:underline"
              >
                Preview campaign <span aria-hidden>&rarr;</span>
              </a>
            </div>
          )}
        </div>

        {/* Quality rail */}
        <div className="relative flex flex-col justify-between gap-6 bg-gradient-to-br from-canvas/60 via-surface to-surface px-7 py-6">
          <div>
            <span className="eyebrow text-ink-muted">Top score</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[3.25rem] font-medium leading-none tracking-tight text-ink tabular-nums">
                {topScoreFormatted ?? (
                  <span className="text-ink-muted">&mdash;</span>
                )}
              </span>
              {topScoreFormatted && (
                <span className="font-mono text-xs text-ink-muted">/ 10</span>
              )}
            </div>
            {topScorer?.name ? (
              <p className="mt-1 truncate text-xs text-ink-soft">
                {topScorer.name}
                {topScorer.confidence && (
                  <span className="ml-1.5 font-mono uppercase tracking-[0.12em] text-ink-muted">
                    &middot; {topScorer.confidence} confidence
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">No scored candidates yet.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-rule/70 pt-5">
            <div>
              <span className="eyebrow text-ink-muted">Avg score</span>
              <p className="mt-1 font-mono text-xl font-semibold text-ink">
                {avgScoreFormatted ?? <span className="text-ink-muted">&mdash;</span>}
              </p>
              <p className="mt-0.5 text-[0.7rem] text-ink-muted">
                across {aiScored} scored
              </p>
            </div>
            <div>
              <span className="eyebrow text-ink-muted">Shortlist rate</span>
              <p className="mt-1 font-mono text-xl font-semibold text-ink">
                {hasApplicants ? `${shortlistRate}%` : <span className="text-ink-muted">&mdash;</span>}
              </p>
              <p className="mt-0.5 text-[0.7rem] text-ink-muted">
                of {totalApplied} applied
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Attention strip */}
      {(awaitingReview > 0 || flagged > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-rule bg-surface/60 px-5 py-3">
          <span className="eyebrow text-ink-muted">Needs a look</span>
          {awaitingReview > 0 && (
            <Link
              href={`/campaigns/${id}?status=scored`}
              className="group inline-flex items-baseline gap-2 text-xs text-ink-soft hover:text-ink"
            >
              <span className="font-mono text-base font-semibold text-cobalt">
                {awaitingReview}
              </span>
              <span>awaiting your review</span>
              <span className="arrow-slide text-cobalt" aria-hidden>&rarr;</span>
            </Link>
          )}
          {awaitingReview > 0 && flagged > 0 && (
            <span className="h-3 w-px bg-rule-strong/60" aria-hidden />
          )}
          {flagged > 0 && (
            <span className="inline-flex items-baseline gap-2 text-xs text-ink-soft">
              <span className="font-mono text-base font-semibold text-saffron-deep">
                {flagged}
              </span>
              <span>flagged by AI</span>
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <CampaignTabs activeTab={activeTab} shortlistCount={shortlisted} campaignId={id} />

      {/* Tab content */}
      {activeTab === "spend" && campaignSpend ? (
        <div className="rounded-xl border border-rule bg-surface p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">AI spend for this campaign</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                All-time, estimated from metered usage. Final amounts appear on the org invoice.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-canvas px-2.5 py-1 text-[0.72rem] text-ink-soft">
              Scoring tier:{" "}
              <span className="font-medium capitalize text-ink">
                {campaign.selected_model_tier}
              </span>
            </span>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-canvas/60 p-4">
              <p className="text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">Spend (incl. VAT)</p>
              <p className="mt-1.5 font-mono text-2xl font-medium tabular-nums text-ink">{zarFmt(campaignSpend.totalInclVat)}</p>
              <p className="mt-1 text-[0.72rem] text-ink-muted">
                {Math.round(campaignSpend.totalCredits).toLocaleString("en-ZA")} cr ·{" "}
                {zarFmt(campaignSpend.subtotalExVat)} + {zarFmt(campaignSpend.vat)} VAT
              </p>
            </div>
            <div className="rounded-lg bg-canvas/60 p-4">
              <p className="text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">≈ Candidates analysed</p>
              <p className="mt-1.5 font-mono text-2xl font-medium tabular-nums text-ink">
                {Math.round(campaignSpend.estCandidates).toLocaleString("en-ZA")}
              </p>
              <p className="mt-1 text-[0.72rem] text-ink-muted">≈ 3–18 credits each, by tier</p>
            </div>
          </div>

          {campaignSpend.totalCredits > 0 ? (
            <div className="space-y-3">
              {campaignSpend.byTier
                .filter((t) => t.credits > 0)
                .map((t) => {
                  const max = Math.max(1, ...campaignSpend.byTier.map((x) => x.zar));
                  return (
                    <div key={t.tier}>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-[0.85rem] text-ink-soft">{t.label}</span>
                        <span className="font-mono text-[0.85rem] text-ink">
                          {zarFmt(t.zar)}
                          <span className="ml-2 text-[0.74rem] text-ink-muted">
                            {Math.round(t.credits).toLocaleString("en-ZA")} cr
                          </span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-canvas">
                        <div
                          className={`h-full rounded-full ${TIER_BAR[t.tier] ?? "bg-cobalt"}`}
                          style={{ width: `${(t.zar / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              <p className="mt-4 border-t border-rule pt-4 font-mono text-[0.68rem] uppercase tracking-wide text-ink-muted">
                Candidate chats always bill at Essential
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No AI spend recorded for this campaign yet.</p>
          )}
        </div>
      ) : activeTab === "shortlist" ? (
        <ShortlistTab
          campaignId={id}
          candidates={shortlistRows.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            ai_score: c.ai_score,
            ai_confidence: c.ai_confidence,
            ai_rationale: c.ai_rationale,
            ai_dimensions: c.ai_dimensions as Record<string, number> | null,
            shortlist_notes: c.shortlist_notes,
          }))}
        />
      ) : (
        <Suspense
          fallback={
            <div className="overflow-hidden rounded-xl border border-rule bg-surface">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-rule px-5 py-4 last:border-b-0"
                >
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-2.5 w-56" />
                  </div>
                  <Skeleton className="h-5 w-12" />
                </div>
              ))}
            </div>
          }
        >
          <CandidateTable
            campaignId={id}
            candidates={candidateRows.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email,
              ai_score: c.ai_score,
              ai_confidence: c.ai_confidence,
              ai_flags: c.ai_flags as unknown[] | null,
              status: c.status,
              source: c.source,
              invite_expires_at: c.invite_expires_at
                ? c.invite_expires_at.toISOString()
                : null,
              created_at: c.created_at.toISOString(),
            }))}
            total={candidateTotal}
            limit={limit}
            offset={offset}
          />
        </Suspense>
      )}
    </div>
  );
}
