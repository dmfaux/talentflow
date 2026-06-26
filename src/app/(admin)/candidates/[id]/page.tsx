import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { candidates, chatMessages, messages, scoringLogs } from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { CandidateActions } from "@/components/admin/candidate-actions";
import { CandidateNotes } from "@/components/admin/candidate-notes";
import { AuditLog } from "@/components/admin/audit-log";
import { AssessmentHistory } from "@/components/admin/assessment-history";
import { DecisionHistory } from "@/components/admin/decision-history";
import { canAccessBrand, orgScope, requireTenant } from "@/lib/tenant";
import { getCandidateAuditTrail } from "@/lib/rejection";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";

interface Props {
  params: Promise<{ id: string }>;
}

// Status → Badge tone (AA-safe soft-tint; the Badge always carries a text label
// so meaning is never colour-alone).
const STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  gating_failed: "red",
  gating_passed: "moss",
  scoring: "saffron",
  scored: "cobalt",
  follow_up: "saffron",
  pending_rejection: "saffron",
  shortlisted: "moss",
  rejected: "red",
  withdrawn: "neutral",
};

const CONFIDENCE_TONE: Record<string, BadgeTone> = {
  high: "moss",
  medium: "saffron",
  low: "red",
};

const RECOMMENDATION_TONE: Record<string, BadgeTone> = {
  strong_recommend: "moss",
  recommend: "cobalt",
  recommend_with_caveats: "saffron",
  borderline: "saffron",
  reject: "red",
};

const DIMENSION_LABELS: Record<string, string> = {
  skills_match: "Skills Match",
  experience_depth: "Experience Depth",
  career_progression: "Career Progression",
  tenure_patterns: "Tenure Patterns",
};

export default async function CandidateDetailPage({ params }: Props) {
  const { id } = await params;

  // S4: requireTenant() (the cached layout guard) resolves first so its ctx
  // org-scopes the read — a cross-org candidate id notFound()s instead of
  // exposing another tenant's scoring, CV, and chat transcript.
  const ctx = await requireTenant();

  const candidate = await db.query.candidates.findFirst({
    where: and(eq(candidates.id, id), orgScope(candidates, ctx)),
    with: {
      campaign: { with: { client: true } },
      scoringLogs: { orderBy: [desc(scoringLogs.created_at)] },
      messages: { orderBy: [desc(messages.created_at)] },
      conversations: {
        with: { chatMessages: { orderBy: [asc(chatMessages.created_at)] } },
      },
    },
  });

  if (!candidate) notFound();

  // Role-gate candidate mutation controls (recruiter+ on this brand). Cosmetic;
  // the candidate routes enforce the same check server-side.
  const canManageCandidate = await canAccessBrand(
    ctx,
    candidate.campaign.client_id,
    "recruiter"
  );

  // Human-in-the-loop rejection trail (who accepted/dismissed, when, why).
  const decisionTrail = await getCandidateAuditTrail(candidate.id);

  const dims = (candidate.ai_dimensions ?? {}) as Record<string, number>;
  const flags = (candidate.ai_flags ?? []) as (string | { type?: string; message?: string })[];
  const gatingAnswers = (candidate.gating_answers ?? {}) as Record<string, string>;
  const gatingConfig = (candidate.campaign.gating_config ?? []) as {
    id: string;
    label: string;
    pass_criteria: string[];
  }[];

  // Get recommendation from the most recent scoring log's structured field
  const validLogs = candidate.scoringLogs.filter((l) => l.score !== null);
  const recommendation: string | null = validLogs[0]?.recommendation ?? null;
  const previousScore =
    validLogs.length > 1 ? validLogs[1]?.score ?? null : null;

  // AA-safe score ramp (large display number ≥3:1): deepest green at the top,
  // mid-green for strong, ink for the middle band, red for failing.
  const scoreColor =
    candidate.ai_score === null
      ? "text-ink-muted"
      : candidate.ai_score >= 8.5
        ? "text-moss-deep"
        : candidate.ai_score >= 7.5
          ? "text-moss"
          : candidate.ai_score >= 5
            ? "text-ink-soft"
            : "text-red";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/campaigns" className="hover:text-ink transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${candidate.campaign.id}`}
          className="hover:text-ink transition-colors"
        >
          {candidate.campaign.role_title}
        </Link>
        <span>/</span>
        <span className="text-ink-soft">{candidate.name}</span>
      </div>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl italic text-ink">
              {candidate.name}
            </h1>
            <Badge tone={STATUS_TONE[candidate.status] ?? "neutral"} dot uppercase>
              {candidate.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-soft">
            <span>{candidate.campaign.client?.name ?? "\u2014"}</span>
            <span className="text-ink-muted">&middot;</span>
            <span>{candidate.campaign.role_title}</span>
            <span className="text-ink-muted">&middot;</span>
            <span className="font-mono text-ink-muted">{candidate.email}</span>
            {candidate.phone && (
              <>
                <span className="text-ink-muted">&middot;</span>
                <span className="font-mono text-ink-muted">{candidate.phone}</span>
              </>
            )}
          </div>
          {candidate.status === "rejected" && candidate.rejection_reason && (
            <Callout
              tone="error"
              className="mt-3"
              icon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 5v3.5M8 10.5v.5" />
                </svg>
              }
            >
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em]">Rejection reason</p>
              <p className="mt-0.5">{candidate.rejection_reason}</p>
            </Callout>
          )}
          {candidate.status === "pending_rejection" && (
            <Callout
              tone="warning"
              className="mt-3"
              icon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M8 1.5L15 14H1z" />
                  <path d="M8 6.5v3M8 11.5v.5" />
                </svg>
              }
            >
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em]">Rejection recommended — awaiting your decision</p>
              <p className="mt-0.5">
                {candidate.rejection_reason ??
                  "The AI recommended rejecting this candidate. No rejection happens until you accept it."}
              </p>
            </Callout>
          )}
        </div>
        <CandidateActions
          candidateId={candidate.id}
          status={candidate.status}
          hasCv={!!candidate.cv_url}
          canManage={canManageCandidate}
        />
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6 items-start">
        {/* Left column — sticky score panel */}
        <div className="w-80 shrink-0 sticky top-20 space-y-4">
          {/* Score overview */}
          <div className="rounded-xl border border-rule bg-surface p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <div>
                <p className="text-[0.63rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  Overall Score
                </p>
                <p className={`mt-1 font-mono text-4xl font-bold ${scoreColor}`}>
                  {candidate.ai_score !== null
                    ? candidate.ai_score.toFixed(1)
                    : "\u2014"}
                </p>
                {previousScore !== null && candidate.ai_score !== null && (
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">
                    was {previousScore.toFixed(1)}{" "}
                    <span
                      className={
                        candidate.ai_score - previousScore > 0
                          ? "text-moss-deep"
                          : candidate.ai_score - previousScore < 0
                            ? "text-red"
                            : ""
                      }
                    >
                      ({candidate.ai_score - previousScore > 0 ? "+" : ""}
                      {(candidate.ai_score - previousScore).toFixed(1)})
                    </span>
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {candidate.ai_confidence && (
                  <Badge tone={CONFIDENCE_TONE[candidate.ai_confidence] ?? "neutral"} size="sm" className="capitalize">
                    {candidate.ai_confidence}
                  </Badge>
                )}
                {recommendation && (
                  <Badge tone={RECOMMENDATION_TONE[recommendation] ?? "neutral"} size="sm" className="capitalize">
                    {recommendation.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
            </div>

            {/* Dimension bars */}
            <div className="space-y-3">
              {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                const value = dims[key] ?? null;
                const pct = value !== null ? (value / 10) * 100 : 0;
                // AA-safe fill scale (gold = teal misnomer, too faint \u2192 cobalt).
                const barColor =
                  value === null
                    ? "bg-canvas-2"
                    : value >= 8
                      ? "bg-moss"
                      : value >= 6
                        ? "bg-cobalt"
                        : value >= 4
                          ? "bg-saffron"
                          : "bg-red";
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[0.68rem] font-medium text-ink-soft">
                        {label}
                      </span>
                      <span className="font-mono text-[0.7rem] font-semibold text-ink">
                        {value !== null ? value.toFixed(1) : "\u2014"}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-canvas overflow-hidden">
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
          <div className="rounded-xl border border-rule bg-surface p-5">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-muted">Applied</span>
                <span className="font-mono text-ink">
                  {new Date(candidate.created_at).toLocaleDateString("en-ZA")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Source</span>
                <span className="text-ink">{candidate.source ?? "\u2014"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Chat</span>
                <span className="text-ink">
                  {candidate.conversations.length > 0 ? "Active" : "None"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">POPIA Consent</span>
                <span className="font-mono text-ink">
                  {candidate.popia_consent_at
                    ? new Date(candidate.popia_consent_at).toLocaleDateString("en-ZA")
                    : "\u2014"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Data Purge</span>
                <span className="font-mono text-ink">
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
          {/* AI Assessment History */}
          <AssessmentHistory
            assessments={validLogs.map((l) => ({
              id: l.id,
              scoring_type: l.scoring_type,
              score: l.score,
              dimensions: l.dimensions as Record<string, number> | null,
              confidence: l.confidence,
              rationale: l.rationale,
              flags: l.flags as (string | { type?: string; message?: string })[] | null,
              recommendation: l.recommendation,
              created_at: l.created_at.toISOString(),
            }))}
          />

          {/* Gating Answers */}
          {gatingConfig.length > 0 && (
            <div className="rounded-xl border border-rule bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">
                Screening Answers
              </h3>
              <div className="space-y-3">
                {gatingConfig.map((q) => {
                  const answer = gatingAnswers[q.id] ?? null;
                  const passed = answer !== null && q.pass_criteria.includes(answer);
                  return (
                    <div
                      key={q.id}
                      className="flex items-start justify-between rounded-lg border border-rule px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink-soft">
                          {q.label}
                        </p>
                        <p className="mt-0.5 text-sm text-ink">
                          {answer ?? <span className="text-ink-muted">No answer</span>}
                        </p>
                      </div>
                      {answer !== null && (
                        <span
                          className={`ml-3 shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full ${
                            passed ? "bg-moss-soft text-moss-deep" : "bg-red-light text-red"
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
            <div className="rounded-xl border border-rule bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">
                Communication History
                <span className="ml-2 font-mono text-xs font-normal text-ink-muted">
                  {candidate.messages.length}
                </span>
              </h3>
              <div className="space-y-3">
                {candidate.messages.map((msg) => (
                  <div key={msg.id} className="flex items-start gap-3">
                    {/* Channel icon */}
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas">
                      {msg.channel === "whatsapp" ? (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="#22c55e" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 1a7 7 0 00-6.1 10.4L1 15l3.7-.9A7 7 0 108 1zm3.3 9.7c-.1.4-.8.7-1.1.8-.3 0-.6.1-1.9-.4s-2.1-1.5-2.7-2.5c-.3-.5-.7-1.3-.7-2s.4-1 .6-1.2c.1-.2.3-.3.4-.3h.3c.1 0 .3 0 .4.3s.5 1.3.6 1.4c0 .1 0 .2-.1.3l-.3.4c-.1.1-.2.3-.1.5.2.3.7 1.1 1.5 1.7.6.5 1.2.7 1.4.8.2.1.3 0 .4-.1l.6-.7c.1-.2.3-.2.4-.1l1.3.6c.2.1.3.2.3.3s0 .6-.1 1z"/>
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                          <rect x="2" y="3" width="12" height="9" rx="1.5" />
                          <path d="M2 4.5l6 4 6-4" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[0.65rem] text-ink-muted">
                        <span className="capitalize">{msg.channel}</span>
                        <span>
                          {msg.direction === "outbound" ? "\u2192 Sent" : "\u2190 Received"}
                        </span>
                        <span className="font-mono">
                          {new Date(msg.created_at).toLocaleString("en-ZA")}
                        </span>
                        {msg.status && (
                          <span className="text-ink-muted">({msg.status})</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-ink line-clamp-2">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Transcript */}
          {candidate.conversations.length > 0 && (
            <div className="rounded-xl border border-rule bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">
                Chat Transcript
                <span className="ml-2 font-mono text-xs font-normal text-ink-muted">
                  {candidate.conversations.length} conversation{candidate.conversations.length !== 1 ? "s" : ""}
                </span>
              </h3>
              <div className="space-y-4">
                {candidate.conversations.map((conv) => (
                  <div key={conv.id} className="rounded-lg border border-rule">
                    <div className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium ${
                        conv.status === "active" ? "bg-moss-soft text-moss-deep" :
                        conv.status === "dormant" ? "bg-saffron-soft text-saffron-deep" :
                        "bg-canvas text-ink-muted"
                      }`}>
                        {conv.status}
                      </span>
                      <span className="font-mono text-[0.65rem] text-ink-muted">
                        {new Date(conv.created_at).toLocaleString("en-ZA")}
                      </span>
                    </div>
                    <div className="max-h-80 overflow-y-auto px-4 py-3">
                      <div className="space-y-2.5">
                        {conv.chatMessages.map((msg) => (
                          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[80%] rounded-xl px-3.5 py-2 ${
                              msg.role === "user"
                                ? "bg-cobalt/10 text-ink"
                                : "bg-canvas text-ink-soft"
                            }`}>
                              <p className="mb-0.5 text-[0.6rem] font-medium text-ink-muted">
                                {msg.role === "user" ? "Candidate" : "Bot"}
                              </p>
                              <p className="text-xs leading-relaxed">{msg.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
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

          {/* Decision History — human-in-the-loop rejection trail */}
          <DecisionHistory
            entries={decisionTrail.map((e) => ({
              id: e.id,
              action: e.action,
              reason: e.reason,
              reason_sent_to_candidate: e.reason_sent_to_candidate,
              actor_name: e.actor_name,
              actor_email: e.actor_email,
              created_at: e.created_at.toISOString(),
            }))}
          />

          {/* Audit Log */}
          <AuditLog
            logs={candidate.scoringLogs.map((l) => ({
              id: l.id,
              scoring_type: l.scoring_type,
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
