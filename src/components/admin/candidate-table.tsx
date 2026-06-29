"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast-provider";

interface Candidate {
  id: string;
  name: string;
  email: string;
  ai_score: number | null;
  ai_confidence: string | null;
  ai_flags: unknown[] | null;
  status: string;
  source: string | null;
  invite_expires_at: string | null;
  created_at: string;
}

interface Props {
  campaignId: string;
  candidates: Candidate[];
  total: number;
  limit: number;
  offset: number;
}

// Status → Badge tone. pending_rejection stays amber (never red) — the AI only
// recommended rejection; no decision is made until a human accepts it.
const STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  // Recruiter-invited, awaiting the candidate to complete the form.
  invited: "saffron",
  gating_failed: "red",
  gating_passed: "moss",
  scoring: "saffron",
  scored: "cobalt",
  follow_up: "saffron",
  pending_rejection: "saffron",
  shortlisted: "moss",
  rejected: "red",
  withdrawn: "neutral",
  // Distinct from `rejected` — never engaged with the follow-up chat, so no
  // evaluation decision was made about them.
  no_response: "neutral",
};

const CONFIDENCE_TONE: Record<string, BadgeTone> = {
  high: "moss",
  medium: "saffron",
  low: "red",
};

const STATUSES = ["all", "invited", "gating_passed", "scored", "follow_up", "pending_rejection", "shortlisted", "rejected", "no_response"] as const;
const SORT_OPTIONS = [
  { value: "score_desc", label: "Score (high to low)" },
  { value: "score_asc", label: "Score (low to high)" },
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
] as const;

// AA-safe avatar tints — same soft-tint family as Badge (deep text on its tint).
function initialsColor(name: string): string {
  const colors = [
    "bg-moss-soft text-moss-deep",
    "bg-saffron-soft text-saffron-deep",
    "bg-red-light text-red",
    "bg-cobalt-tint text-cobalt-deep",
    "bg-vermillion-soft text-vermillion-deep",
    "bg-canvas-2 text-ink-soft",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

const filterSelect =
  "h-8 rounded-lg border border-rule bg-canvas/60 px-2.5 text-[0.72rem] font-medium text-ink-soft outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20 cursor-pointer";

export function CandidateTable({ campaignId, candidates, total, limit, offset }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [resending, setResending] = useState<string | null>(null);

  const resendInvite = useCallback(
    async (id: string) => {
      setResending(id);
      try {
        const res = await fetch(`/api/admin/candidates/${id}/resend-invite`, { method: "POST" });
        toast(res.ok ? "Invite resent" : "Couldn't resend the invite", res.ok ? "success" : "error");
        if (res.ok) router.refresh();
      } catch {
        toast("Couldn't reach the server", "error");
      } finally {
        setResending(null);
      }
    },
    [router, toast]
  );

  const currentSort = searchParams.get("sort") ?? "score_desc";
  const currentStatus = searchParams.get("status") ?? "all";
  const currentConfidence = searchParams.get("confidence") ?? "all";
  const page = Math.floor(offset / limit);
  const totalPages = Math.ceil(total / limit);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === "all" || !value) params.delete(key);
        else params.set(key, value);
      }
      // Reset offset when changing filters
      if ("status" in updates || "confidence" in updates || "sort" in updates) {
        params.delete("offset");
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, pathname, router]
  );

  function changePage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage === 0) params.delete("offset");
    else params.set("offset", String(newPage * limit));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="rounded-xl border border-rule bg-surface">
      {/* Controls bar */}
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">
          Candidates
          <span className="ml-2 font-mono text-xs font-normal text-ink-muted">{total}</span>
        </h3>
        <div className="flex items-center gap-3">
          {/* Status filter */}
          <select
            value={currentStatus}
            onChange={(e) => updateParams({ status: e.target.value })}
            aria-label="Filter by status"
            className={filterSelect}
          >
            <option value="all">All statuses</option>
            {STATUSES.filter((s) => s !== "all").map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ").toUpperCase()}</option>
            ))}
          </select>
          {/* Confidence filter */}
          <select
            value={currentConfidence}
            onChange={(e) => updateParams({ confidence: e.target.value })}
            aria-label="Filter by confidence"
            className={filterSelect}
          >
            <option value="all">All confidence</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          {/* Sort */}
          <select
            value={currentSort}
            onChange={(e) => updateParams({ sort: e.target.value })}
            aria-label="Sort candidates"
            className={filterSelect}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-rule">
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">Candidate</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted text-center">Score</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted text-center">Confidence</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted text-center">Flags</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">Status</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted text-right">Applied</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {candidates.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-14 text-center text-sm text-ink-muted">
                No candidates match the current filters
              </td>
            </tr>
          ) : (
            candidates.map((c) => {
              const initials = c.name
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              // Small text \u2192 AA needs 4.5:1, so green is moss-deep (mid-moss fails).
              const scoreColor =
                c.ai_score === null
                  ? "text-ink-muted"
                  : c.ai_score >= 7.5
                    ? "text-moss-deep"
                    : "text-ink-soft";
              const flagCount = Array.isArray(c.ai_flags) ? c.ai_flags.length : 0;

              return (
                <tr
                  key={c.id}
                  className="group cursor-pointer transition-colors hover:bg-canvas/60"
                  onClick={(e) => {
                    // Let the name link handle keyboard/modifier clicks itself.
                    if ((e.target as HTMLElement).closest("a")) return;
                    router.push(`/candidates/${c.id}`);
                  }}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold ${initialsColor(c.name)}`}
                      >
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/candidates/${c.id}`}
                            className="truncate text-sm font-medium text-ink transition-colors group-hover:text-cobalt"
                          >
                            {c.name}
                          </Link>
                          {c.source === "recruiter_manual" && (
                            <Badge tone="neutral" size="sm" className="shrink-0">
                              Sourced
                            </Badge>
                          )}
                        </div>
                        <p className="font-mono text-[0.65rem] text-ink-muted truncate">
                          {c.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`font-mono text-sm font-semibold ${scoreColor}`}>
                      {c.ai_score !== null ? c.ai_score.toFixed(1) : "\u2014"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    {c.ai_confidence ? (
                      <Badge tone={CONFIDENCE_TONE[c.ai_confidence] ?? "neutral"} size="sm" className="capitalize">
                        {c.ai_confidence}
                      </Badge>
                    ) : (
                      <span className="text-ink-muted">&mdash;</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {flagCount > 0 ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-saffron-deep">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M6 2v4M6 8.5v.5" />
                        </svg>
                        {flagCount}
                      </span>
                    ) : (
                      <span className="text-ink-muted text-xs">&mdash;</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={STATUS_TONE[c.status] ?? "neutral"} dot uppercase>
                        {c.status.replace(/_/g, " ")}
                      </Badge>
                      {c.status === "invited" && (
                        <div className="flex items-center gap-2">
                          {c.invite_expires_at && (
                            <span className="text-[0.62rem] text-ink-muted">
                              {new Date(c.invite_expires_at) < new Date()
                                ? "Invite expired"
                                : `Expires ${new Date(c.invite_expires_at).toLocaleDateString("en-ZA")}`}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              resendInvite(c.id);
                            }}
                            disabled={resending === c.id}
                            className="text-[0.62rem] font-medium text-cobalt hover:underline cursor-pointer disabled:opacity-50"
                          >
                            {resending === c.id ? "Resending…" : "Resend"}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[0.65rem] text-ink-muted">
                    {new Date(c.created_at).toLocaleDateString("en-ZA")}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-rule px-5 py-3">
          <span className="text-xs text-ink-muted">
            Showing {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => changePage(page - 1)}
              disabled={page === 0}
              aria-label="Previous page"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8.5 3L4.5 7l4 4" /></svg>
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 4) {
                pageNum = i;
              } else if (page > totalPages - 5) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => changePage(pageNum)}
                  aria-label={`Page ${pageNum + 1}`}
                  aria-current={pageNum === page || undefined}
                  className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    pageNum === page
                      ? "bg-ink text-white"
                      : "text-ink-muted hover:bg-canvas hover:text-ink"
                  }`}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              onClick={() => changePage(page + 1)}
              disabled={page >= totalPages - 1}
              aria-label="Next page"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5.5 3L9.5 7l-4 4" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
