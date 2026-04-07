import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { candidates, messages, scoringLogs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { CandidateActions } from "@/components/admin/candidate-actions";
import { CandidateNotes } from "@/components/admin/candidate-notes";
import { AuditLog } from "@/components/admin/audit-log";

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-cream text-txt-secondary",
  gating_failed: "bg-red-light text-red",
  gating_passed: "bg-green-light text-green",
  scoring: "bg-warning-light text-warning",
  scored: "bg-green-light text-accent",
  follow_up: "bg-warning-light text-warning",
  shortlisted: "bg-[#fef3c7] text-gold",
  rejected: "bg-red-light text-red",
  withdrawn: "bg-cream text-txt-muted",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-green-light text-green",
  medium: "bg-warning-light text-warning",
  low: "bg-red-light text-red",
};

const RECOMMENDATION_STYLES: Record<string, string> = {
  strong_recommend: "bg-green-light text-green",
  recommend: "bg-green-light text-accent",
  recommend_with_caveats: "bg-warning-light text-warning",
  borderline: "bg-warning-light text-warning",
  reject: "bg-red-light text-red",
};

const DIMENSION_LABELS: Record<string, string> = {
  skills_match: "Skills Match",
  experience_depth: "Experience Depth",
  career_progression: "Career Progression",
  tenure_patterns: "Tenure Patterns",
};

export default async function CandidateDetailPage({ params }: Props) {
  const { id } = await params;

  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, id),
    with: {
      campaign: { with: { client: true } },
      scoringLogs: { orderBy: [desc(scoringLogs.created_at)] },
      messages: { orderBy: [desc(messages.created_at)] },
    },
  });

  if (!candidate) notFound();

  const dims = (candidate.ai_dimensions ?? {}) as Record<string, number>;
  const flags = (candidate.ai_flags ?? []) as (string | { type?: string; message?: string })[];
  const gatingAnswers = (candidate.gating_answers ?? {}) as Record<string, string>;
  const gatingConfig = (candidate.campaign.gating_config ?? []) as {
    id: string;
    label: string;
    pass_criteria: string[];
  }[];

  // Parse recommendation from scoring log response if available
  let recommendation: string | null = null;
  if (candidate.scoringLogs.length > 0) {
    try {
      let raw = candidate.scoringLogs[0].full_response;
      if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      const parsed = JSON.parse(raw);
      recommendation = parsed.recommendation ?? null;
    } catch {
      // ignore
    }
  }

  const scoreColor =
    candidate.ai_score === null
      ? "text-txt-muted"
      : candidate.ai_score >= 8.5
        ? "text-green"
        : candidate.ai_score >= 7.5
          ? "text-gold"
          : candidate.ai_score >= 5
            ? "text-txt-secondary"
            : "text-red";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/campaigns" className="hover:text-charcoal transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${candidate.campaign.id}`}
          className="hover:text-charcoal transition-colors"
        >
          {candidate.campaign.role_title}
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">{candidate.name}</span>
      </div>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl italic text-charcoal">
              {candidate.name}
            </h1>
            <span
              className={`inline-block rounded-full px-3 py-0.5 text-[0.7rem] font-medium ${
                STATUS_STYLES[candidate.status] ?? STATUS_STYLES.new
              }`}
            >
              {candidate.status.replace(/_/g, " ")}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-txt-secondary">
            <span>{candidate.campaign.client?.name ?? "\u2014"}</span>
            <span className="text-txt-muted">&middot;</span>
            <span>{candidate.campaign.role_title}</span>
            <span className="text-txt-muted">&middot;</span>
            <span className="font-mono text-txt-muted">{candidate.email}</span>
            {candidate.phone && (
              <>
                <span className="text-txt-muted">&middot;</span>
                <span className="font-mono text-txt-muted">{candidate.phone}</span>
              </>
            )}
          </div>
          {candidate.status === "rejected" && candidate.rejection_reason && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red/20 bg-red-light px-3.5 py-2.5">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" className="mt-0.5 shrink-0">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 5v3.5M8 10.5v.5" />
              </svg>
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-red">Rejection Reason</p>
                <p className="mt-0.5 text-sm text-charcoal">{candidate.rejection_reason}</p>
              </div>
            </div>
          )}
        </div>
        <CandidateActions
          candidateId={candidate.id}
          status={candidate.status}
          hasCv={!!candidate.cv_url}
        />
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6 items-start">
        {/* Left column — sticky score panel */}
        <div className="w-80 shrink-0 sticky top-20 space-y-4">
          {/* Score overview */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <div>
                <p className="text-[0.63rem] font-semibold uppercase tracking-[0.14em] text-txt-muted">
                  Overall Score
                </p>
                <p className={`mt-1 font-mono text-4xl font-bold ${scoreColor}`}>
                  {candidate.ai_score !== null
                    ? candidate.ai_score.toFixed(1)
                    : "\u2014"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {candidate.ai_confidence && (
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium ${
                      CONFIDENCE_STYLES[candidate.ai_confidence] ?? "bg-cream text-txt-muted"
                    }`}
                  >
                    {candidate.ai_confidence}
                  </span>
                )}
                {recommendation && (
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium ${
                      RECOMMENDATION_STYLES[recommendation] ?? "bg-cream text-txt-muted"
                    }`}
                  >
                    {recommendation.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            </div>

            {/* Dimension bars */}
            <div className="space-y-3">
              {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                const value = dims[key] ?? null;
                const pct = value !== null ? (value / 10) * 100 : 0;
                const barColor =
                  value === null
                    ? "bg-cream"
                    : value >= 8.5
                      ? "bg-green/20"
                      : value >= 7
                        ? "bg-gold/20"
                        : "bg-cream";
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[0.68rem] font-medium text-txt-secondary">
                        {label}
                      </span>
                      <span className="font-mono text-[0.7rem] font-semibold text-charcoal">
                        {value !== null ? value.toFixed(1) : "\u2014"}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-cream overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor} transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Applied date / meta */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-txt-muted">Applied</span>
                <span className="font-mono text-charcoal">
                  {new Date(candidate.created_at).toLocaleDateString("en-ZA")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">Source</span>
                <span className="text-charcoal">{candidate.source ?? "\u2014"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">WhatsApp</span>
                <span className="text-charcoal">
                  {candidate.whatsapp_opted_in ? "Opted in" : "No"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">POPIA Consent</span>
                <span className="font-mono text-charcoal">
                  {candidate.popia_consent_at
                    ? new Date(candidate.popia_consent_at).toLocaleDateString("en-ZA")
                    : "\u2014"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">Data Purge</span>
                <span className="font-mono text-charcoal">
                  {candidate.data_purge_at
                    ? new Date(candidate.data_purge_at).toLocaleDateString("en-ZA")
                    : "\u2014"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column — scrolling content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* AI Rationale */}
          {candidate.ai_rationale && (
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="border-l-[3px] border-accent px-5 py-4">
                <p className="mb-1 text-[0.63rem] font-semibold uppercase tracking-[0.14em] text-txt-muted">
                  AI Assessment
                </p>
                <p className="text-sm leading-relaxed text-charcoal">
                  {candidate.ai_rationale}
                </p>
              </div>
              {flags.length > 0 && (
                <div className="border-t border-border px-5 py-3">
                  <p className="mb-2 text-[0.63rem] font-semibold uppercase tracking-[0.14em] text-warning">
                    Flags ({flags.length})
                  </p>
                  <ul className="space-y-1">
                    {flags.map((flag, i) => {
                      const text =
                        typeof flag === "string"
                          ? flag
                          : flag.message ?? JSON.stringify(flag);
                      return (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-xs text-txt-secondary"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="#d97706"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            className="mt-0.5 shrink-0"
                          >
                            <path d="M6 2v4M6 8.5v.5" />
                          </svg>
                          {text}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Gating Answers */}
          {gatingConfig.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold text-charcoal">
                Screening Answers
              </h3>
              <div className="space-y-3">
                {gatingConfig.map((q) => {
                  const answer = gatingAnswers[q.id] ?? null;
                  const passed = answer !== null && q.pass_criteria.includes(answer);
                  return (
                    <div
                      key={q.id}
                      className="flex items-start justify-between rounded-lg border border-border px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-txt-secondary">
                          {q.label}
                        </p>
                        <p className="mt-0.5 text-sm text-charcoal">
                          {answer ?? <span className="text-txt-muted">No answer</span>}
                        </p>
                      </div>
                      {answer !== null && (
                        <span
                          className={`ml-3 shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full ${
                            passed ? "bg-green-light text-green" : "bg-red-light text-red"
                          }`}
                        >
                          {passed ? (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 5.5L4 7.5 8 3" />
                            </svg>
                          ) : (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
                            </svg>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Communication History */}
          {candidate.messages.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold text-charcoal">
                Communication History
                <span className="ml-2 font-mono text-xs font-normal text-txt-muted">
                  {candidate.messages.length}
                </span>
              </h3>
              <div className="space-y-3">
                {candidate.messages.map((msg) => (
                  <div key={msg.id} className="flex items-start gap-3">
                    {/* Channel icon */}
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream">
                      {msg.channel === "whatsapp" ? (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="#22c55e" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 1a7 7 0 00-6.1 10.4L1 15l3.7-.9A7 7 0 108 1zm3.3 9.7c-.1.4-.8.7-1.1.8-.3 0-.6.1-1.9-.4s-2.1-1.5-2.7-2.5c-.3-.5-.7-1.3-.7-2s.4-1 .6-1.2c.1-.2.3-.3.4-.3h.3c.1 0 .3 0 .4.3s.5 1.3.6 1.4c0 .1 0 .2-.1.3l-.3.4c-.1.1-.2.3-.1.5.2.3.7 1.1 1.5 1.7.6.5 1.2.7 1.4.8.2.1.3 0 .4-.1l.6-.7c.1-.2.3-.2.4-.1l1.3.6c.2.1.3.2.3.3s0 .6-.1 1z"/>
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#666" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="3" width="12" height="9" rx="1.5" />
                          <path d="M2 4.5l6 4 6-4" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[0.65rem] text-txt-muted">
                        <span className="capitalize">{msg.channel}</span>
                        <span>
                          {msg.direction === "outbound" ? "\u2192 Sent" : "\u2190 Received"}
                        </span>
                        <span className="font-mono">
                          {new Date(msg.created_at).toLocaleString("en-ZA")}
                        </span>
                        {msg.status && (
                          <span className="text-txt-muted">({msg.status})</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-charcoal line-clamp-2">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admin Notes */}
          <CandidateNotes
            candidateId={candidate.id}
            initialShortlistNotes={candidate.shortlist_notes ?? ""}
          />

          {/* Audit Log */}
          <AuditLog
            logs={candidate.scoringLogs.map((l) => ({
              id: l.id,
              model_version: l.model_version,
              score: l.score,
              processing_time_ms: l.processing_time_ms,
              full_prompt: l.full_prompt,
              full_response: l.full_response,
              created_at: l.created_at.toISOString(),
            }))}
          />
        </div>
      </div>
    </div>
  );
}
