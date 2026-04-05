"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface DashboardData {
  campaigns: {
    total: number;
    by_status: Record<string, number>;
  };
  candidates: {
    total: number;
    scored: number;
    shortlisted: number;
    avg_score: number | null;
  };
  gating: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    pass_rate: number;
  };
  status_breakdown: { status: string; count: number }[];
  score_distribution: { bucket: string; count: number }[];
  recent_campaigns: {
    id: string;
    role_title: string;
    client_name: string | null;
    status: string;
    campaign_start: string | null;
    campaign_end: string | null;
    total_candidates: number;
    shortlisted: number;
    avg_score: number | null;
  }[];
  weekly_volume: { week: string; count: number }[];
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  gating_failed: "Gating rejected",
  gating_passed: "Gating passed",
  scoring: "Scoring",
  scored: "Scored",
  follow_up: "Follow-up",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream text-txt-secondary",
  active: "bg-green-light text-green",
  paused: "bg-warning-light text-warning",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
};

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-xs font-medium text-txt-muted uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-medium text-charcoal tracking-tight">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-txt-secondary">{sub}</p>}
    </div>
  );
}

function BarChart({
  data,
  labelKey,
  valueKey,
  maxHeight = 120,
  barColor = "bg-accent",
}: {
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
  maxHeight?: number;
  barColor?: string;
}) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return (
    <div className="flex items-end gap-2" style={{ height: maxHeight }}>
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0;
        const pct = (val / max) * 100;
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="text-[0.65rem] font-mono text-txt-muted">
              {val}
            </span>
            <div
              className={`w-full rounded-t ${barColor} transition-all duration-500`}
              style={{ height: `${Math.max(pct, 2)}%` }}
            />
            <span className="text-[0.6rem] text-txt-muted whitespace-nowrap">
              {String(d[labelKey])}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FunnelRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-txt-secondary">{label}</span>
        <span className="font-mono text-charcoal">
          {count}{" "}
          <span className="text-txt-muted text-xs">
            ({pct.toFixed(0)}%)
          </span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-cream overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${Math.max(pct, 0.5)}%` }}
        />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-5">
            <div className="h-3 w-20 bg-cream rounded" />
            <div className="mt-3 h-7 w-16 bg-cream rounded" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-surface p-6 h-64" />
        <div className="rounded-xl border border-border bg-surface p-6 h-64" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then((res) => setData(res.data ?? null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-charcoal mb-6">Dashboard</h1>
        <LoadingSkeleton />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-charcoal mb-6">Dashboard</h1>
        <p className="text-sm text-txt-muted">Failed to load dashboard data.</p>
      </div>
    );
  }

  const activeCampaigns = data.campaigns.by_status["active"] ?? 0;
  const conversionRate =
    data.candidates.total > 0
      ? ((data.candidates.shortlisted / data.candidates.total) * 100).toFixed(1)
      : "0";

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Dashboard</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            Cross-campaign performance overview
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          New Campaign
        </Link>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Active campaigns"
          value={activeCampaigns}
          sub={`${data.campaigns.total} total`}
        />
        <StatCard
          label="Total candidates"
          value={data.candidates.total}
          sub={`${data.candidates.scored} scored`}
        />
        <StatCard
          label="Shortlisted"
          value={data.candidates.shortlisted}
          sub={`${conversionRate}% conversion`}
        />
        <StatCard
          label="Avg AI score"
          value={data.candidates.avg_score ?? "—"}
          sub="Across all scored candidates"
        />
      </div>

      {/* ── Funnel + Score Distribution ── */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* Candidate funnel */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-charcoal mb-5">
            Candidate funnel
          </h2>
          <div className="space-y-4">
            <FunnelRow
              label="Applied"
              count={data.gating.total}
              total={data.gating.total}
              color="bg-accent"
            />
            <FunnelRow
              label="Passed gating"
              count={data.gating.passed}
              total={data.gating.total}
              color="bg-accent-light"
            />
            <FunnelRow
              label="Gating rejected"
              count={data.gating.failed}
              total={data.gating.total}
              color="bg-red/70"
            />
            <FunnelRow
              label="AI scored"
              count={data.candidates.scored}
              total={data.gating.total}
              color="bg-gold"
            />
            <FunnelRow
              label="Shortlisted"
              count={data.candidates.shortlisted}
              total={data.gating.total}
              color="bg-green"
            />
          </div>
        </div>

        {/* Score distribution */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-charcoal mb-5">
            Score distribution
          </h2>
          <BarChart
            data={data.score_distribution}
            labelKey="bucket"
            valueKey="count"
            maxHeight={160}
          />
        </div>
      </div>

      {/* ── Weekly Volume + Status Breakdown ── */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* Weekly application volume */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-charcoal mb-5">
            Weekly applications
            <span className="ml-2 text-xs font-normal text-txt-muted">
              Last 8 weeks
            </span>
          </h2>
          {data.weekly_volume.length > 0 ? (
            <BarChart
              data={data.weekly_volume.map((w) => ({
                ...w,
                label: new Date(w.week).toLocaleDateString("en-ZA", {
                  day: "numeric",
                  month: "short",
                }),
              }))}
              labelKey="label"
              valueKey="count"
              maxHeight={140}
              barColor="bg-accent/70"
            />
          ) : (
            <p className="text-sm text-txt-muted py-10 text-center">
              No applications in the last 8 weeks
            </p>
          )}
        </div>

        {/* Status breakdown */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-charcoal mb-5">
            Candidate status breakdown
          </h2>
          {data.status_breakdown.length > 0 ? (
            <div className="space-y-2.5">
              {data.status_breakdown.map((row) => (
                <div
                  key={row.status}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-txt-secondary">
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                  <span className="font-mono text-charcoal">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-txt-muted py-10 text-center">
              No candidates yet
            </p>
          )}
        </div>
      </div>

      {/* ── Recent Campaigns ── */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-charcoal">
            Campaign overview
          </h2>
          <Link
            href="/campaigns"
            className="text-xs font-medium text-accent hover:text-accent-light transition-colors"
          >
            View all
          </Link>
        </div>
        {data.recent_campaigns.length > 0 ? (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-6 pb-3 text-xs font-medium text-txt-muted uppercase tracking-wide">
                    Campaign
                  </th>
                  <th className="px-3 pb-3 text-xs font-medium text-txt-muted uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-3 pb-3 text-xs font-medium text-txt-muted uppercase tracking-wide text-right">
                    Candidates
                  </th>
                  <th className="px-3 pb-3 text-xs font-medium text-txt-muted uppercase tracking-wide text-right">
                    Shortlisted
                  </th>
                  <th className="px-6 pb-3 text-xs font-medium text-txt-muted uppercase tracking-wide text-right">
                    Avg score
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recent_campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border/50 last:border-0 hover:bg-cream/50 transition-colors"
                  >
                    <td className="px-6 py-3">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium text-charcoal hover:text-accent transition-colors"
                      >
                        {c.role_title}
                      </Link>
                      <p className="text-xs text-txt-muted mt-0.5">
                        {c.client_name ?? "—"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium ${
                          CAMPAIGN_STATUS_STYLES[c.status] ?? CAMPAIGN_STATUS_STYLES.draft
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-txt-secondary">
                      {c.total_candidates}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-txt-secondary">
                      {c.shortlisted}
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-txt-secondary">
                      {c.avg_score ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-txt-muted py-10 text-center">
            No campaigns yet
          </p>
        )}
      </div>
    </div>
  );
}
