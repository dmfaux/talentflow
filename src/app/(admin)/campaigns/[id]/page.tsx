"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

// ── Types ────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  slug: string;
  role_title: string;
  role_description: string | null;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  status: string;
  campaign_start: string | null;
  campaign_end: string | null;
  client: { id: string; name: string } | null;
  candidate_counts: Record<string, number>;
}

interface Candidate {
  id: string;
  name: string;
  email: string;
  ai_score: number | null;
  ai_confidence: string | null;
  ai_dimensions: Record<string, number> | null;
  ai_flags: unknown[] | null;
  status: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream text-txt-secondary",
  active: "bg-green-light text-green",
  paused: "bg-warning-light text-warning",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-green-light text-green",
  medium: "bg-warning-light text-warning",
  low: "bg-red-light text-red",
};

const PIPELINE_STAGES = [
  { key: "new", label: "Applied" },
  { key: "gating_passed", label: "Passed Gating" },
  { key: "scored", label: "Scored" },
  { key: "shortlisted", label: "Shortlisted" },
] as const;

// ── Component ────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const limit = 20;

  const fetchCandidates = useCallback(
    (offset: number) => {
      fetch(`/api/admin/campaigns/${id}/candidates?limit=${limit}&offset=${offset}`)
        .then((r) => r.json())
        .then((res) => {
          setCandidates(res.data?.candidates ?? []);
          setTotal(res.data?.total ?? 0);
        });
    },
    [id]
  );

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/campaigns/${id}`).then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      }),
      fetch(`/api/admin/campaigns/${id}/candidates?limit=${limit}&offset=0`).then((r) => r.json()),
    ])
      .then(([campRes, candRes]) => {
        setCampaign(campRes.data);
        setCandidates(candRes.data?.candidates ?? []);
        setTotal(candRes.data?.total ?? 0);
      })
      .catch(() => setError("Campaign not found"))
      .finally(() => setLoading(false));
  }, [id]);

  function changePage(newPage: number) {
    setPage(newPage);
    fetchCandidates(newPage * limit);
  }

  async function updateStatus(status: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setCampaign((prev) => (prev ? { ...prev, ...data } : prev));
      }
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="py-20 text-center text-sm text-txt-muted">Loading...</div>;
  if (error || !campaign) return <div className="py-20 text-center text-sm text-red">{error || "Not found"}</div>;

  // Compute stats
  const counts = campaign.candidate_counts;
  const totalApplied = Object.values(counts).reduce((a, b) => a + b, 0);
  const passedGating = (counts.gating_passed ?? 0) + (counts.scoring ?? 0) + (counts.scored ?? 0) + (counts.follow_up ?? 0) + (counts.shortlisted ?? 0);
  const scored = (counts.scored ?? 0) + (counts.follow_up ?? 0) + (counts.shortlisted ?? 0);
  const shortlisted = counts.shortlisted ?? 0;
  const topScore = candidates.reduce((max, c) => Math.max(max, c.ai_score ?? 0), 0);

  const stats = [
    { label: "Applied", value: totalApplied },
    { label: "Passed Gating", value: passedGating },
    { label: "AI Scored", value: scored },
    { label: "Shortlisted", value: shortlisted },
    { label: "Top Score", value: topScore ? topScore.toFixed(1) : "—" },
  ];

  // Pipeline funnel
  const pipelineValues = [totalApplied, passedGating, scored, shortlisted];
  const maxPipeline = Math.max(totalApplied, 1);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/campaigns" className="hover:text-charcoal transition-colors">Campaigns</Link>
        <span>/</span>
        <span className="text-txt-secondary">{campaign.role_title}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-charcoal">{campaign.role_title}</h1>
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium ${STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft}`}>
              {campaign.status}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-txt-secondary">
            <span>{campaign.client?.name ?? "—"}</span>
            {campaign.department && (
              <>
                <span className="text-txt-muted">&middot;</span>
                <span>{campaign.department}</span>
              </>
            )}
            {campaign.location && (
              <>
                <span className="text-txt-muted">&middot;</span>
                <span>{campaign.location}</span>
              </>
            )}
            <span className="text-txt-muted">&middot;</span>
            <span className="font-mono text-txt-muted">{campaign.slug}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {campaign.status === "active" && (
            <button
              onClick={() => updateStatus("paused")}
              disabled={actionLoading}
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-warning transition-colors hover:bg-warning-light cursor-pointer disabled:opacity-50"
            >
              Pause
            </button>
          )}
          {campaign.status === "paused" && (
            <button
              onClick={() => updateStatus("active")}
              disabled={actionLoading}
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-green transition-colors hover:bg-green-light cursor-pointer disabled:opacity-50"
            >
              Resume
            </button>
          )}
          {(campaign.status === "active" || campaign.status === "paused") && (
            <button
              onClick={() => updateStatus("closed")}
              disabled={actionLoading}
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-red transition-colors hover:bg-red-light cursor-pointer disabled:opacity-50"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-5 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-txt-muted">
              {stat.label}
            </p>
            <p className="mt-1 font-mono text-xl font-semibold text-charcoal">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Pipeline funnel */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-5">
        <h3 className="mb-4 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
          Pipeline Funnel
        </h3>
        <div className="space-y-2.5">
          {PIPELINE_STAGES.map((stage, i) => {
            const value = pipelineValues[i];
            const pct = maxPipeline > 0 ? (value / maxPipeline) * 100 : 0;
            return (
              <div key={stage.key} className="flex items-center gap-3">
                <span className="w-28 text-xs font-medium text-txt-secondary shrink-0">
                  {stage.label}
                </span>
                <div className="flex-1 h-7 rounded-md bg-cream overflow-hidden">
                  <div
                    className="h-full rounded-md bg-green/15 transition-all duration-500"
                    style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-xs text-charcoal shrink-0">
                  {value}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Candidates table */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-charcoal">
            Candidates
            <span className="ml-2 font-mono text-xs font-normal text-txt-muted">{total}</span>
          </h3>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Name</th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted text-center">Score</th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted text-center">Confidence</th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Flags</th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {candidates.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-txt-muted">
                  No candidates yet
                </td>
              </tr>
            ) : (
              candidates.map((c) => {
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
                      <span className="text-sm font-medium text-charcoal group-hover:text-accent transition-colors">
                        {c.name}
                      </span>
                      <span className="ml-2 font-mono text-[0.65rem] text-txt-muted">{c.email}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`font-mono text-sm font-semibold ${scoreColor}`}>
                        {c.ai_score !== null ? c.ai_score.toFixed(1) : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {c.ai_confidence ? (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium ${CONFIDENCE_STYLES[c.ai_confidence] ?? "bg-cream text-txt-muted"}`}>
                          {c.ai_confidence}
                        </span>
                      ) : (
                        <span className="text-txt-muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {flagCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-warning">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M6 2v4M6 8.5v.5" />
                          </svg>
                          {flagCount}
                        </span>
                      ) : (
                        <span className="text-txt-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium ${STATUS_STYLES[c.status] ?? STATUS_STYLES.draft}`}>
                        {c.status.replace(/_/g, " ")}
                      </span>
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
              Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => changePage(page - 1)}
                disabled={page === 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-txt-muted transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8.5 3L4.5 7l4 4" /></svg>
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => changePage(i)}
                  className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    i === page
                      ? "bg-charcoal text-white"
                      : "text-txt-muted hover:bg-cream hover:text-charcoal"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
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
    </div>
  );
}
