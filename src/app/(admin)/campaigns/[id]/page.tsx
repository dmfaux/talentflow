import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { and, desc, asc, eq, sql } from "drizzle-orm";
import { CampaignActions } from "@/components/admin/campaign-actions";
import { CampaignTabs } from "@/components/admin/campaign-tabs";
import { CandidateTable } from "@/components/admin/candidate-table";
import { ShortlistTab } from "@/components/admin/shortlist-tab";
import { Suspense } from "react";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream text-txt-secondary",
  active: "bg-green-light text-green",
  paused: "bg-warning-light text-warning",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
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

  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, id),
    with: { client: true },
  });

  if (!campaign) notFound();

  // Candidate counts by status
  const statusCounts = await db
    .select({
      status: candidates.status,
      count: sql<number>`count(*)::int`,
    })
    .from(candidates)
    .where(eq(candidates.campaign_id, id))
    .groupBy(candidates.status);

  const counts: Record<string, number> = {};
  for (const row of statusCounts) counts[row.status] = row.count;

  const totalApplied = Object.values(counts).reduce((a, b) => a + b, 0);
  const passedGating =
    (counts.gating_passed ?? 0) + (counts.scoring ?? 0) + (counts.scored ?? 0) +
    (counts.shortlisted ?? 0);
  const aiScored = (counts.scored ?? 0) + (counts.shortlisted ?? 0);
  const shortlisted = counts.shortlisted ?? 0;

  const [topScoreRow] = await db
    .select({ score: sql<number>`max(${candidates.ai_score})` })
    .from(candidates)
    .where(eq(candidates.campaign_id, id));
  const topScore = topScoreRow?.score;

  // Candidate table data
  const limit = 20;
  const offset = parseInt(sp.offset ?? "0", 10);
  const statusFilter = sp.status;
  const confidenceFilter = sp.confidence;
  const sort = sp.sort ?? "score_desc";

  const conditions = [eq(candidates.campaign_id, id)];
  if (statusFilter) conditions.push(eq(candidates.status, statusFilter));
  if (confidenceFilter) conditions.push(eq(candidates.ai_confidence, confidenceFilter));

  const where = and(...conditions);
  const orderBy =
    sort === "score_asc" ? [asc(candidates.ai_score)]
    : sort === "date_desc" ? [desc(candidates.created_at)]
    : sort === "date_asc" ? [asc(candidates.created_at)]
    : [desc(candidates.ai_score)];

  const [candidateRows, countResult] = await Promise.all([
    db.select().from(candidates).where(where).orderBy(...orderBy).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(candidates).where(where),
  ]);

  const candidateTotal = countResult[0]?.total ?? 0;

  // Shortlist data
  const shortlistRows = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.campaign_id, id), eq(candidates.status, "shortlisted")))
    .orderBy(desc(candidates.ai_score));

  const stats = [
    { label: "Applied", value: totalApplied, accent: "" },
    { label: "Passed Gating", value: passedGating, accent: "text-green" },
    { label: "AI Scored", value: aiScored, accent: "text-accent" },
    { label: "Shortlisted", value: shortlisted, accent: "text-gold" },
    { label: "Top Score", value: topScore ? topScore.toFixed(1) : "\u2014", accent: topScore && topScore >= 8.5 ? "text-green" : "" },
  ];

  const maxPipeline = Math.max(totalApplied, 1);
  const pipeline = [
    { label: "Applied", value: totalApplied, color: "bg-accent/10" },
    { label: "Passed Gating", value: passedGating, color: "bg-green/15" },
    { label: "AI Scored", value: aiScored, color: "bg-accent/15" },
    { label: "Shortlisted", value: shortlisted, color: "bg-gold/20" },
  ];

  const isDev = process.env.NODE_ENV !== "production";
  const campaignUrl =
    !isDev && process.env.NEXT_PUBLIC_APP_DOMAIN
      ? `https://${campaign.client?.slug}.${process.env.NEXT_PUBLIC_APP_DOMAIN}/${campaign.slug}`
      : `/c/${campaign.client?.slug}/${campaign.slug}`;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/campaigns" className="hover:text-charcoal transition-colors">Campaigns</Link>
        <span>/</span>
        <span className="text-txt-secondary">{campaign.role_title}</span>
      </div>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl italic text-charcoal">{campaign.role_title}</h1>
            <span className={`inline-block rounded-full px-3 py-0.5 text-[0.7rem] font-medium ${STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft}`}>
              {campaign.status}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-txt-secondary">
            <span>{campaign.client?.name ?? "\u2014"}</span>
            <span className="text-txt-muted">&middot;</span>
            <span>
              {campaign.status === "draft"
                ? "Not started"
                : campaign.campaign_start
                  ? daysAgo(new Date(campaign.campaign_start))
                  : "\u2014"}
            </span>
            <span className="text-txt-muted">&middot;</span>
            <a href={campaignUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-accent hover:underline">
              {campaignUrl.replace("https://", "")}
            </a>
          </div>
        </div>
        <CampaignActions campaignId={campaign.id} status={campaign.status} />
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-5 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-surface px-5 py-4">
            <p className="text-[0.63rem] font-semibold uppercase tracking-[0.14em] text-txt-muted">{stat.label}</p>
            <p className={`mt-1.5 font-mono text-2xl font-semibold ${stat.accent || "text-charcoal"}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="mb-6 rounded-xl border border-border bg-surface px-6 py-5">
        <h3 className="mb-5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-txt-muted">Pipeline</h3>
        <div className="space-y-3">
          {pipeline.map((stage) => {
            const pct = maxPipeline > 0 ? (stage.value / maxPipeline) * 100 : 0;
            return (
              <div key={stage.label} className="flex items-center gap-4">
                <span className="w-28 shrink-0 text-[0.75rem] font-medium text-txt-secondary">{stage.label}</span>
                <div className="relative flex-1 h-8 rounded-lg bg-cream overflow-hidden">
                  <div className={`absolute inset-y-0 left-0 rounded-lg ${stage.color} transition-all duration-700`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
                  <span className="absolute inset-y-0 left-3 flex items-center font-mono text-xs font-semibold text-charcoal">{stage.value}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <CampaignTabs activeTab={activeTab} shortlistCount={shortlisted} campaignId={id} />

      {/* Tab content */}
      {activeTab === "shortlist" ? (
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
        <Suspense fallback={<div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-txt-muted">Loading...</div>}>
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
