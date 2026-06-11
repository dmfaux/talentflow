import { notFound } from "next/navigation";
import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ReportToolbar } from "@/components/admin/report-toolbar";
import { ReportCvPreview } from "@/components/admin/report-cv-preview";
import { buildCvManifest } from "@/lib/cv-files";

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

const INLINE_PREVIEW_LIMIT = 5;

function getRecommendation(score: number | null): string {
  if (score === null) return "borderline";
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
    // Tie-break on id so the order is stable and matches the CV archive.
    .orderBy(desc(candidates.ai_score), asc(candidates.id));

  const manifest = buildCvManifest(shortlisted);
  const totalApplied = summaryRow?.total ?? 0;
  const totalPassed = passedRow?.total ?? 0;
  const totalScored = scoredRow?.total ?? 0;
  const now = new Date();

  const reportDate = now.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const generatedStamp = now.toLocaleString("en-ZA");

  const metaParts = [
    campaign.client?.name,
    campaign.department,
    campaign.location,
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen bg-cream print:bg-white">
      <ReportToolbar campaignId={id} />

      <div className="mx-auto max-w-4xl px-8 py-12 print:py-8">
        {/* ── Header ───────────────────────────────────────────── */}
        <header>
          <div className="flex items-baseline justify-between">
            <p className="eyebrow text-txt-muted">
              Confidential · Shortlist Report
            </p>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-txt-muted">
              {reportDate}
            </p>
          </div>

          <h1 className="mt-5 font-serif text-[2.25rem] italic leading-[1.1] text-charcoal">
            {campaign.role_title}
          </h1>

          {metaParts.length > 0 && (
            <p className="mt-3 text-[0.9rem] text-txt-secondary">
              {metaParts.map((part, i) => (
                <span key={`${i}-${part}`}>
                  {i > 0 && <span className="mx-2 text-txt-muted">·</span>}
                  {part}
                </span>
              ))}
            </p>
          )}

          <div className="mt-8 border-t border-border" />
        </header>

        {/* ── Summary stats ────────────────────────────────────── */}
        <section className="mt-8">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: "Applied", value: totalApplied, accent: "text-charcoal" },
              { label: "Passed Screening", value: totalPassed, accent: "text-charcoal" },
              { label: "AI Scored", value: totalScored, accent: "text-charcoal" },
              { label: "Shortlisted", value: shortlisted.length, accent: "text-moss" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-border bg-surface p-5"
              >
                <p className="eyebrow text-txt-muted">{stat.label}</p>
                <p className={`mt-2 font-mono text-2xl ${stat.accent}`}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Shortlisted candidates ───────────────────────────── */}
        <section className="mt-12">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="eyebrow text-txt-secondary">
              Shortlisted Candidates
            </h2>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-txt-muted">
              {shortlisted.length} ranked
            </span>
          </div>

          <div className="space-y-6">
            {manifest.map(({ candidate: c, rank, filename }, idx) => {
              const dims = (c.ai_dimensions ?? {}) as Record<string, number>;
              const rec = getRecommendation(c.ai_score);
              const recMeta = RECOMMENDATION_LABELS[rec] ?? RECOMMENDATION_LABELS.borderline;
              const scoreColour =
                c.ai_score === null
                  ? "text-txt-muted"
                  : c.ai_score >= 8.5
                    ? "text-moss"
                    : c.ai_score >= 7.5
                      ? "text-charcoal"
                      : "text-txt-secondary";

              return (
                <article
                  key={c.id}
                  className="rounded-xl border border-border bg-surface p-7 print:break-inside-avoid print:shadow-none"
                >
                  {/* ── Candidate header ──────────────────────── */}
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-paper font-serif text-[0.95rem] italic text-charcoal">
                        {rank}
                      </span>
                      <h3 className="font-serif text-xl italic text-charcoal">
                        {c.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-4">
                      <span
                        className={`rounded-full px-3 py-0.5 text-[0.68rem] font-medium ${recMeta.style}`}
                      >
                        {recMeta.label}
                      </span>
                      <span className={`font-serif text-[2rem] italic leading-none ${scoreColour}`}>
                        {c.ai_score !== null ? c.ai_score.toFixed(1) : "—"}
                      </span>
                    </div>
                  </div>

                  {/* ── Dimensions ─────────────────────────────── */}
                  <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                    {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                      const value = dims[key] ?? null;
                      const pct = value !== null ? (value / 10) * 100 : 0;
                      const barTone =
                        value === null
                          ? "bg-cream"
                          : value >= 8
                            ? "bg-moss"
                            : value >= 6
                              ? "bg-gold"
                              : value >= 4
                                ? "bg-saffron"
                                : "bg-red";
                      return (
                        <div key={key}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[0.7rem] text-txt-muted">{label}</span>
                            <span className="font-mono text-[0.72rem] text-charcoal">
                              {value !== null ? value.toFixed(1) : "—"}
                            </span>
                          </div>
                          <div className="h-[5px] overflow-hidden rounded-full bg-cream">
                            <div
                              className={`h-full rounded-full ${barTone}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Rationale ──────────────────────────────── */}
                  {c.ai_rationale && (
                    <blockquote className="mb-5 border-l-[3px] border-accent pl-5">
                      <p className="font-serif text-[1rem] italic leading-relaxed text-txt-secondary">
                        {c.ai_rationale}
                      </p>
                    </blockquote>
                  )}

                  {/* ── Assessor notes ─────────────────────────── */}
                  {c.shortlist_notes && (
                    <div className="mb-2 border-l-2 border-border pl-4 py-0.5">
                      <p className="eyebrow mb-1 text-txt-muted">
                        Assessor Note
                      </p>
                      <p className="text-[0.88rem] leading-relaxed text-txt-secondary">
                        {c.shortlist_notes}
                      </p>
                    </div>
                  )}

                  {/* ── CV preview ─────────────────────────────── */}
                  {filename ? (
                    <ReportCvPreview
                      candidateId={c.id}
                      filename={filename}
                      expandedByDefault={idx < INLINE_PREVIEW_LIMIT}
                    />
                  ) : (
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="eyebrow text-txt-muted">
                        CV not on file
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="mt-14 border-t border-border pt-6 print:mt-10">
          <div className="space-y-3 text-[0.72rem] leading-relaxed text-txt-muted">
            <p>
              <span className="eyebrow text-txt-secondary">POPIA Compliance</span>
              <br />
              Candidate data is processed with explicit consent and stored in South
              Africa under a 12-month retention policy. Under Section 72 of POPIA,
              applications are transmitted to AI processors located outside South
              Africa for automated assessment; those processors are contractually
              bound not to retain, train on, or reuse the data — it is processed
              in-memory and discarded immediately after assessment. Candidates may
              request access, correction, or deletion at any time.
            </p>
            <p>
              <span className="eyebrow text-txt-secondary">AI Transparency</span>
              <br />
              Scores and recommendations were generated with AI-assisted assessment.
              These outputs are decision-support, not substitutes for human
              judgement. Full scoring rationale and audit logs are available on
              request.
            </p>
          </div>

          <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
            <p className="eyebrow text-txt-muted">TalentStream · Shortlist Report</p>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-txt-muted">
              Generated {generatedStamp}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
