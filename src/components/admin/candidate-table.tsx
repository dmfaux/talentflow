"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

interface Candidate {
  id: string;
  name: string;
  email: string;
  ai_score: number | null;
  ai_confidence: string | null;
  ai_flags: unknown[] | null;
  status: string;
  created_at: string;
}

interface Props {
  campaignId: string;
  candidates: Candidate[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_STYLES: Record<string, string> = {
  new: "text-txt-secondary",
  gating_failed: "text-red",
  gating_passed: "text-green",
  scoring: "text-warning",
  scored: "text-accent",
  follow_up: "text-warning",
  shortlisted: "text-gold",
  rejected: "text-red",
  withdrawn: "text-txt-muted",
  // Distinct from `rejected` — these candidates never engaged with the
  // follow-up chat, so no evaluation decision was made about them.
  no_response: "text-txt-muted",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-green-light text-green",
  medium: "bg-warning-light text-warning",
  low: "bg-red-light text-red",
};

const STATUSES = ["all", "gating_passed", "scored", "follow_up", "shortlisted", "rejected", "no_response"] as const;
const SORT_OPTIONS = [
  { value: "score_desc", label: "Score (high to low)" },
  { value: "score_asc", label: "Score (low to high)" },
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
] as const;

function initialsColor(name: string): string {
  const colors = [
    "bg-green-light text-green",
    "bg-warning-light text-warning",
    "bg-red-light text-red",
    "bg-cobalt-tint text-cobalt-deep",
    "bg-vermillion-soft text-vermillion",
    "bg-moss-soft text-moss",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function CandidateTable({ campaignId, candidates, total, limit, offset }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
    <div className="rounded-xl border border-border bg-surface">
      {/* Controls bar */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-charcoal">
          Candidates
          <span className="ml-2 font-mono text-xs font-normal text-txt-muted">{total}</span>
        </h3>
        <div className="flex items-center gap-3">
          {/* Status filter */}
          <select
            value={currentStatus}
            onChange={(e) => updateParams({ status: e.target.value })}
            className="h-8 rounded-lg border border-border bg-cream/60 px-2.5 text-[0.72rem] font-medium text-txt-secondary outline-none focus:border-accent cursor-pointer"
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
            className="h-8 rounded-lg border border-border bg-cream/60 px-2.5 text-[0.72rem] font-medium text-txt-secondary outline-none focus:border-accent cursor-pointer"
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
            className="h-8 rounded-lg border border-border bg-cream/60 px-2.5 text-[0.72rem] font-medium text-txt-secondary outline-none focus:border-accent cursor-pointer"
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
          <tr className="border-b border-border">
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Candidate</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted text-center">Score</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted text-center">Confidence</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted text-center">Flags</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Status</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted text-right">Applied</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {candidates.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-14 text-center text-sm text-txt-muted">
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
              const scoreColor =
                c.ai_score === null
                  ? "text-txt-muted"
                  : c.ai_score >= 8.5
                    ? "text-green"
                    : c.ai_score >= 7.5
                      ? "text-gold"
                      : "text-txt-secondary";
              const flagCount = Array.isArray(c.ai_flags) ? c.ai_flags.length : 0;

              return (
                <tr
                  key={c.id}
                  className="group cursor-pointer transition-colors hover:bg-cream/60"
                  onClick={() => router.push(`/candidates/${c.id}`)}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold ${initialsColor(c.name)}`}
                      >
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-charcoal group-hover:text-accent transition-colors truncate">
                          {c.name}
                        </p>
                        <p className="font-mono text-[0.65rem] text-txt-muted truncate">
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
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium ${CONFIDENCE_STYLES[c.ai_confidence] ?? "bg-cream text-txt-muted"}`}>
                        {c.ai_confidence}
                      </span>
                    ) : (
                      <span className="text-txt-muted">&mdash;</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {flagCount > 0 ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-warning">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M6 2v4M6 8.5v.5" />
                        </svg>
                        {flagCount}
                      </span>
                    ) : (
                      <span className="text-txt-muted text-xs">&mdash;</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium ${STATUS_STYLES[c.status] ?? "text-txt-muted"}`}>
                      {c.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[0.65rem] text-txt-muted">
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
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-xs text-txt-muted">
            Showing {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => changePage(page - 1)}
              disabled={page === 0}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-txt-muted transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
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
                  className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    pageNum === page
                      ? "bg-charcoal text-white"
                      : "text-txt-muted hover:bg-cream hover:text-charcoal"
                  }`}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              onClick={() => changePage(page + 1)}
              disabled={page >= totalPages - 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-txt-muted transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5.5 3L9.5 7l-4 4" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
