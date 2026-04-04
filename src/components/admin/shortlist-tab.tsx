"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ShortlistCandidate {
  id: string;
  name: string;
  email: string;
  ai_score: number | null;
  ai_confidence: string | null;
  ai_rationale: string | null;
  ai_dimensions: Record<string, number> | null;
  shortlist_notes: string | null;
}

interface Props {
  campaignId: string;
  candidates: ShortlistCandidate[];
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-green-light text-green",
  medium: "bg-warning-light text-warning",
  low: "bg-red-light text-red",
};

const DIMENSION_LABELS: Record<string, string> = {
  skills_match: "Skills",
  experience_depth: "Experience",
  career_progression: "Progression",
  tenure_patterns: "Tenure",
};

export function ShortlistTab({ campaignId, candidates: initial }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function removeFromShortlist(candidateId: string) {
    setSavingId(candidateId);
    await fetch(`/api/admin/candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "scored" }),
    });
    setItems((prev) => prev.filter((c) => c.id !== candidateId));
    setSavingId(null);
    router.refresh();
  }

  function moveItem(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const arr = [...items];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setItems(arr);
  }

  async function saveNotes(candidateId: string, notes: string) {
    setSavingId(candidateId);
    await fetch(`/api/admin/candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortlist_notes: notes }),
    });
    setSavingId(null);
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-16 text-center">
        <p className="text-sm text-txt-muted">No candidates shortlisted yet</p>
        <p className="mt-1 text-xs text-txt-muted">
          Use the candidates table to add candidates to the shortlist
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((c, idx) => {
        const dims = c.ai_dimensions ?? {};
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
            className="rounded-xl border border-border bg-surface p-5 transition-shadow hover:shadow-sm"
          >
            {/* Header row */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                {/* Position controls */}
                <div className="flex flex-col items-center gap-0.5">
                  <button
                    onClick={() => moveItem(idx, -1)}
                    disabled={idx === 0}
                    className="p-0.5 text-txt-muted hover:text-charcoal disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 7l3-3 3 3" /></svg>
                  </button>
                  <span className="font-mono text-[0.6rem] text-txt-muted">
                    {idx + 1}
                  </span>
                  <button
                    onClick={() => moveItem(idx, 1)}
                    disabled={idx === items.length - 1}
                    className="p-0.5 text-txt-muted hover:text-charcoal disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5l3 3 3-3" /></svg>
                  </button>
                </div>

                <div>
                  <h3
                    className="text-sm font-semibold text-charcoal cursor-pointer hover:text-accent transition-colors"
                    onClick={() => router.push(`/candidates/${c.id}`)}
                  >
                    {c.name}
                  </h3>
                  <p className="font-mono text-[0.65rem] text-txt-muted">{c.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Score */}
                <span className={`font-mono text-lg font-bold ${scoreColor}`}>
                  {c.ai_score !== null ? c.ai_score.toFixed(1) : "\u2014"}
                </span>
                {c.ai_confidence && (
                  <span className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium ${CONFIDENCE_STYLES[c.ai_confidence] ?? "bg-cream text-txt-muted"}`}>
                    {c.ai_confidence}
                  </span>
                )}
                <button
                  onClick={() => removeFromShortlist(c.id)}
                  disabled={savingId === c.id}
                  className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-[0.68rem] font-medium text-txt-muted transition-colors hover:bg-red-light hover:text-red hover:border-red/20 cursor-pointer disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Dimension bars */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                const value = dims[key] ?? null;
                const pct = value !== null ? (value / 10) * 100 : 0;
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[0.6rem] font-medium text-txt-muted">{label}</span>
                      <span className="font-mono text-[0.65rem] font-semibold text-charcoal">
                        {value !== null ? value.toFixed(1) : "\u2014"}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-cream overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green/20 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Rationale */}
            {c.ai_rationale && (
              <div className="mb-4">
                <p className={`text-xs leading-relaxed text-txt-secondary ${expandedId !== c.id ? "line-clamp-2" : ""}`}>
                  {c.ai_rationale}
                </p>
                {c.ai_rationale.length > 150 && (
                  <button
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    className="mt-1 text-[0.68rem] font-medium text-accent hover:underline cursor-pointer"
                  >
                    {expandedId === c.id ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="mb-1 block text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Shortlist Notes
              </label>
              <textarea
                rows={2}
                defaultValue={c.shortlist_notes ?? ""}
                onBlur={(e) => saveNotes(c.id, e.target.value)}
                placeholder="Add notes for this candidate..."
                className="w-full rounded-lg border border-border bg-cream/40 px-3 py-2 text-xs text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
