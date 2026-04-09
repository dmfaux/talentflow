"use client";

import { useState } from "react";

interface AssessmentEntry {
  id: string;
  scoring_type: string;
  score: number | null;
  dimensions: Record<string, number> | null;
  confidence: string | null;
  rationale: string | null;
  flags: (string | { type?: string; message?: string })[] | null;
  recommendation: string | null;
  created_at: string;
}

interface Props {
  assessments: AssessmentEntry[];
}

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

const SCORING_TYPE_LABELS: Record<string, string> = {
  initial: "Initial Assessment",
  chat_rescore: "Chat Re-Assessment",
  rescore_chat: "Chat Re-Assessment",
};

export function AssessmentHistory({ assessments }: Props) {
  const valid = assessments.filter((a) => a.score !== null);
  const [expandedId, setExpandedId] = useState<string | null>(
    valid[0]?.id ?? null
  );

  if (valid.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-charcoal">
          AI Assessment History
        </h3>
        {valid.length > 1 && (
          <span className="font-mono text-xs text-txt-muted">
            {valid.length} assessments
          </span>
        )}
      </div>

      {valid.map((entry, idx) => {
        const isCurrent = idx === 0;
        const isExpanded = expandedId === entry.id;
        const prevEntry = idx < valid.length - 1 ? valid[idx + 1] : null;
        const scoreDelta =
          prevEntry?.score != null && entry.score != null
            ? entry.score - prevEntry.score
            : null;
        const dims = (entry.dimensions ?? {}) as Record<string, number>;
        const flags = (entry.flags ?? []) as (
          | string
          | { type?: string; message?: string }
        )[];

        return (
          <div
            key={entry.id}
            className={`rounded-xl border bg-surface overflow-hidden ${
              isCurrent ? "border-accent/30" : "border-border"
            } ${!isCurrent && !isExpanded ? "opacity-70" : ""}`}
          >
            {/* Header — always visible */}
            <button
              onClick={() =>
                setExpandedId(isExpanded ? null : entry.id)
              }
              className="flex w-full items-center justify-between px-5 py-3.5 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                {/* Current / Superseded badge */}
                {valid.length > 1 && (
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em] ${
                      isCurrent
                        ? "bg-green-light text-green"
                        : "bg-cream text-txt-muted"
                    }`}
                  >
                    {isCurrent ? "Current" : "Superseded"}
                  </span>
                )}
                <span className="text-xs font-medium text-txt-secondary">
                  {SCORING_TYPE_LABELS[entry.scoring_type] ??
                    entry.scoring_type}
                </span>
                <span className="font-mono text-[0.65rem] text-txt-muted">
                  {new Date(entry.created_at).toLocaleString("en-ZA")}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Score + delta */}
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`font-mono text-lg font-bold ${
                      isCurrent ? "text-charcoal" : "text-txt-muted line-through"
                    }`}
                  >
                    {entry.score!.toFixed(1)}
                  </span>
                  {scoreDelta !== null && (
                    <span
                      className={`font-mono text-xs font-semibold ${
                        scoreDelta > 0
                          ? "text-green"
                          : scoreDelta < 0
                            ? "text-red"
                            : "text-txt-muted"
                      }`}
                    >
                      {scoreDelta > 0 ? "+" : ""}
                      {scoreDelta.toFixed(1)}
                    </span>
                  )}
                </div>

                {/* Expand chevron */}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  className={`text-txt-muted transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                >
                  <path d="M3.5 5.5L7 9l3.5-3.5" />
                </svg>
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-border">
                {/* Badges row */}
                {(entry.confidence || entry.recommendation) && (
                  <div className="flex items-center gap-2 px-5 pt-3.5">
                    {entry.confidence && (
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium ${
                          CONFIDENCE_STYLES[entry.confidence] ??
                          "bg-cream text-txt-muted"
                        }`}
                      >
                        {entry.confidence}
                      </span>
                    )}
                    {entry.recommendation && (
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium ${
                          RECOMMENDATION_STYLES[entry.recommendation] ??
                          "bg-cream text-txt-muted"
                        }`}
                      >
                        {entry.recommendation.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                )}

                {/* Rationale */}
                {entry.rationale && (
                  <div className="border-l-[3px] border-accent mx-5 mt-3.5 px-4 py-3">
                    <p className="text-sm leading-relaxed text-charcoal">
                      {entry.rationale}
                    </p>
                  </div>
                )}

                {/* Dimension bars */}
                {Object.keys(dims).length > 0 && (
                  <div className="px-5 pt-3.5 space-y-2.5">
                    {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                      const value = dims[key] ?? null;
                      const pct = value !== null ? (value / 10) * 100 : 0;
                      const barColor =
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
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="text-[0.65rem] font-medium text-txt-secondary">
                              {label}
                            </span>
                            <span className="font-mono text-[0.65rem] font-semibold text-charcoal">
                              {value !== null ? value.toFixed(1) : "\u2014"}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-cream overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor} transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Flags */}
                {flags.length > 0 && (
                  <div className="px-5 pt-3.5 pb-4">
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

                {/* Bottom padding when no flags */}
                {flags.length === 0 && <div className="pb-4" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
