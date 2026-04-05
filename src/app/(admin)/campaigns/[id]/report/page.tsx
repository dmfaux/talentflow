import { notFound } from "next/navigation";
import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { ReportToolbar } from "@/components/admin/report-toolbar";

interface Props {
  params: Promise<{ id: string }>;
}

const RECOMMENDATION_LABELS: Record<string, { label: string; style: string }> = {
  strong_recommend: { label: "Strong Recommend", style: "bg-green-light text-green" },
  recommend: { label: "Recommend", style: "bg-green-light text-accent" },
  recommend_with_caveats: { label: "Recommend with Caveats", style: "bg-warning-light text-warning" },
  borderline: { label: "Borderline", style: "bg-warning-light text-warning" },
  reject: { label: "Not Recommended", style: "bg-red-light text-red" },
};

const DIMENSION_LABELS: Record<string, string> = {
  skills_match: "Skills Match",
  experience_depth: "Experience Depth",
  career_progression: "Career Progression",
  tenure_patterns: "Tenure Patterns",
};

function getRecommendation(score: number | null): string {
  if (!score) return "borderline";
  if (score >= 8.5) return "strong_recommend";
  if (score >= 7.5) return "recommend";
  if (score >= 6) return "recommend_with_caveats";
  if (score >= 5) return "borderline";
  return "reject";
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params;

  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, id),
    with: { client: true },
  });

  if (!campaign) notFound();

  // Summary counts
  const [summaryRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(candidates)
    .where(eq(candidates.campaign_id, id));

  const [passedRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(candidates)
    .where(
      and(
        eq(candidates.campaign_id, id),
        sql`${candidates.status} IN ('gating_passed','scoring','scored','follow_up','shortlisted')`
      )
    );

  const [scoredRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(candidates)
    .where(
      and(
        eq(candidates.campaign_id, id),
        sql`${candidates.status} IN ('scored','follow_up','shortlisted')`
      )
    );

  const shortlisted = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.campaign_id, id), eq(candidates.status, "shortlisted")))
    .orderBy(desc(candidates.ai_score));

  const totalApplied = summaryRow?.total ?? 0;
  const totalPassed = passedRow?.total ?? 0;
  const totalScored = scoredRow?.total ?? 0;
  const now = new Date();

  return (
    <div className="min-h-screen bg-cream print:bg-white">
      <ReportToolbar />

      {/* Header strip */}
      <div className="bg-[#1B4332] px-8 py-10 print:py-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-serif text-lg italic text-[#D4A843]">
                TalentStream
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-white">
                {campaign.role_title}
              </h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-white/60">
                <span>{campaign.client?.name}</span>
                {campaign.department && (
                  <>
                    <span className="text-white/30">&middot;</span>
                    <span>{campaign.department}</span>
                  </>
                )}
                {campaign.location && (
                  <>
                    <span className="text-white/30">&middot;</span>
                    <span>{campaign.location}</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#D4A843]/60">
                Confidential
              </p>
              <p className="mt-1 font-mono text-xs text-white/40">
                {now.toLocaleDateString("en-ZA")}
              </p>
            </div>
          </div>

          {/* Summary stats */}
          <div className="mt-8 grid grid-cols-4 gap-4">
            {[
              { label: "Applied", value: totalApplied },
              { label: "Passed Screening", value: totalPassed },
              { label: "AI Scored", value: totalScored },
              { label: "Shortlisted", value: shortlisted.length },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg bg-white/[0.08] px-4 py-3">
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-white/40">
                  {stat.label}
                </p>
                <p className="mt-1 font-mono text-xl font-semibold text-white">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Candidate cards */}
      <div className="mx-auto max-w-4xl px-8 py-8">
        <h2 className="mb-6 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-txt-muted">
          Shortlisted Candidates ({shortlisted.length})
        </h2>

        <div className="space-y-5">
          {shortlisted.map((c, idx) => {
            const dims = (c.ai_dimensions ?? {}) as Record<string, number>;
            const rec = getRecommendation(c.ai_score);
            const recMeta = RECOMMENDATION_LABELS[rec] ?? RECOMMENDATION_LABELS.borderline;
            const scoreColor =
              c.ai_score === null
                ? "text-txt-muted"
                : c.ai_score >= 8.5
                  ? "text-green"
                  : c.ai_score >= 7.5
                    ? "text-gold"
                    : "text-txt-secondary";

            return (
              <div
                key={c.id}
                className="rounded-xl border border-border bg-surface p-6 print:break-inside-avoid print:shadow-none"
              >
                {/* Candidate header */}
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[0.65rem] font-bold text-ink">
                      {idx + 1}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-charcoal">
                        {c.name}
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-3 py-0.5 text-[0.68rem] font-medium ${recMeta.style}`}>
                      {recMeta.label}
                    </span>
                    <span className={`font-mono text-2xl font-bold ${scoreColor}`}>
                      {c.ai_score !== null ? c.ai_score.toFixed(1) : "\u2014"}
                    </span>
                  </div>
                </div>

                {/* Dimensions */}
                <div className="grid grid-cols-4 gap-4 mb-5">
                  {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                    const value = dims[key] ?? null;
                    const pct = value !== null ? (value / 10) * 100 : 0;
                    return (
                      <div key={key}>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[0.65rem] font-medium text-txt-muted">{label}</span>
                          <span className="font-mono text-[0.7rem] font-semibold text-charcoal">
                            {value !== null ? value.toFixed(1) : "\u2014"}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-cream overflow-hidden">
                          <div
                            className="h-full rounded-full bg-green/20"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Rationale */}
                {c.ai_rationale && (
                  <div className="mb-4 border-l-2 border-accent/30 pl-4">
                    <p className="text-sm leading-relaxed text-txt-secondary">
                      {c.ai_rationale}
                    </p>
                  </div>
                )}

                {/* Shortlist notes */}
                {c.shortlist_notes && (
                  <div className="rounded-lg bg-cream/60 px-4 py-2.5">
                    <p className="mb-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                      Assessor Notes
                    </p>
                    <p className="text-xs text-txt-secondary">{c.shortlist_notes}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-10 border-t border-border pt-6 print:mt-8">
          <div className="text-[0.68rem] leading-relaxed text-txt-muted space-y-2">
            <p>
              <strong className="text-txt-secondary">POPIA Compliance:</strong>{" "}
              All candidate data is processed with explicit consent and subject to a 12-month
              retention policy. Candidates may request data deletion at any time.
            </p>
            <p>
              <strong className="text-txt-secondary">AI Transparency:</strong>{" "}
              Scores and recommendations were generated using AI-assisted assessment.
              Full scoring rationale and audit logs are available upon request.
              These assessments are intended as decision-support tools and should be
              considered alongside human judgement.
            </p>
            <p className="font-mono text-[0.6rem] text-txt-muted/60">
              Report generated {now.toLocaleString("en-ZA")} &middot; TalentStream
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
