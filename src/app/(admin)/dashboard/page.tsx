"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Range = "week" | "month" | "quarter" | "year" | "all";

interface DashboardData {
  range: Range;
  granularity: "day" | "week" | "month";
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
  time_series: { period: string; count: number }[];
}

interface AnalyticsData {
  range: Range;
  granularity: "day" | "week" | "month";
  visitors: {
    total: number;
    unique: number;
    sessions: number;
    time_series: { period: string; views: number; unique: number }[];
  };
  funnel: {
    page_views: number;
    form_starts: number;
    form_submits: number;
    view_to_start_pct: number;
    start_to_submit_pct: number;
  };
  abandonment: {
    drop_off_by_field: { field: string; count: number }[];
  };
  browsers: { browser: string | null; count: number }[];
  devices: { device_type: string | null; count: number }[];
}

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "all", label: "All time" },
];

function formatPeriodLabel(period: string, granularity: "day" | "week" | "month"): string {
  const date = new Date(period);
  if (granularity === "month") {
    return date.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
  }
  if (granularity === "week") {
    return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

const RANGE_SUBTITLES: Record<Range, string> = {
  week: "Last 7 days",
  month: "Last 30 days",
  quarter: "Last 13 weeks",
  year: "Last 12 months",
  all: "All time",
};

const STATUS_LABELS: Record<string, string> = {
  new: "NEW",
  gating_failed: "GATING REJECTED",
  gating_passed: "GATING PASSED",
  scoring: "SCORING",
  scored: "SCORED",
  follow_up: "FOLLOW-UP",
  shortlisted: "SHORTLISTED",
  rejected: "REJECTED",
  withdrawn: "WITHDRAWN",
};

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream text-txt-secondary",
  active: "bg-green-light text-green",
  paused: "bg-warning-light text-warning",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
};

const BROWSER_COLORS: Record<string, string> = {
  Chrome: "#4285F4",
  Safari: "#007AFF",
  Firefox: "#FF7139",
  Edge: "#0078D4",
  Opera: "#FF1B2D",
  "Samsung Internet": "#1428A0",
  other: "#9fb5c4",
};

const DEVICE_COLORS: Record<string, string> = {
  desktop: "#2c5bff",
  mobile: "#067340",
  tablet: "#d68a0b",
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
    <div className="flex items-end gap-2">
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0;
        const pct = (val / max) * 100;
        const barHeight = Math.max((pct / 100) * maxHeight, 2);
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="text-[0.65rem] font-mono text-txt-muted">
              {val}
            </span>
            <div
              className={`w-full rounded-t ${barColor} transition-all duration-500`}
              style={{ height: `${barHeight}px` }}
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

function AreaChart({
  data,
  height = 160,
}: {
  data: { period: string; count: number; label: string }[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  if (data.length === 0) {
    return (
      <p className="text-sm text-txt-muted py-10 text-center">
        No applications in this period
      </p>
    );
  }

  const padTop = 8;
  const padBottom = 4;
  const plotHeight = height - padTop - padBottom;
  const plotWidth = width;

  const max = Math.max(...data.map((d) => d.count), 1);
  const n = data.length;
  const stepX = n > 1 ? plotWidth / (n - 1) : 0;

  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = padTop + plotHeight - (d.count / max) * plotHeight;
    return { x, y, count: d.count, label: d.label, period: d.period };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const areaPath = n > 1
    ? `${linePath} L${points[n - 1].x.toFixed(2)},${padTop + plotHeight} L${points[0].x.toFixed(2)},${padTop + plotHeight} Z`
    : "";

  const maxLabels = 6;
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));
  const labelIndices = new Set<number>();
  for (let i = 0; i < n; i += labelStep) labelIndices.add(i);
  labelIndices.add(n - 1);

  const latest = points[n - 1];
  const maxIdx = points.reduce((m, p, i) => p.count > points[m].count ? i : m, 0);

  return (
    <div ref={containerRef}>
      <div className="flex items-start justify-between mb-1">
        <span className="font-mono text-[0.65rem] text-txt-muted">
          max {max}
        </span>
        <span className="font-mono text-[0.65rem] text-txt-secondary">
          latest: <span className="text-charcoal font-semibold">{latest.count}</span>
        </span>
      </div>
      {width > 0 && (
        <>
          <svg width={width} height={height} className="block">
            {/* Horizontal gridlines */}
            <line x1={0} y1={padTop} x2={width} y2={padTop} stroke="#d1dce6" strokeWidth="1" />
            <line x1={0} y1={padTop + plotHeight / 2} x2={width} y2={padTop + plotHeight / 2} stroke="#d1dce6" strokeWidth="1" strokeDasharray="2 2" />
            <line x1={0} y1={padTop + plotHeight} x2={width} y2={padTop + plotHeight} stroke="#d1dce6" strokeWidth="1" />

            {/* Area fill */}
            {n > 1 && (
              <path d={areaPath} fill="#2c5bff" fillOpacity="0.08" />
            )}

            {/* Line */}
            {n > 1 && (
              <path
                d={linePath}
                fill="none"
                stroke="#2c5bff"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Point markers — first, last, and max */}
            {Array.from(new Set([0, n - 1, maxIdx])).map((i) => (
              <circle
                key={i}
                cx={points[i].x}
                cy={points[i].y}
                r="3"
                fill="#ffffff"
                stroke="#2c5bff"
                strokeWidth="1.5"
              />
            ))}

            {/* Hover hit zones with tooltips */}
            {points.map((p, i) => (
              <rect
                key={i}
                x={Math.max(0, p.x - stepX / 2)}
                y={padTop}
                width={stepX || plotWidth}
                height={plotHeight}
                fill="transparent"
              >
                <title>{p.label}: {p.count}</title>
              </rect>
            ))}
          </svg>
          <div className="relative mt-1" style={{ height: 14 }}>
            {points.map((p, i) =>
              labelIndices.has(i) ? (
                <span
                  key={i}
                  className="absolute text-[0.6rem] text-txt-muted -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${p.x}px` }}
                >
                  {p.label}
                </span>
              ) : null
            )}
          </div>
        </>
      )}
      {width === 0 && <div style={{ height: height + 15 }} />}
    </div>
  );
}

function DonutChart({
  segments,
  total,
  centerLabel,
  centerValue,
  size = 180,
  thickness = 28,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
  centerLabel: string;
  centerValue: string | number;
  size?: number;
  thickness?: number;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background ring */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--color-cream)"
            strokeWidth={thickness}
          />
          {/* Segments */}
          {segments.map((seg, i) => {
            if (seg.value === 0 || total === 0) return null;
            const fraction = seg.value / total;
            const dash = fraction * circumference;
            const gap = circumference - dash;
            const strokeDashoffset = -offset;
            offset += dash;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-700"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-semibold text-charcoal">
            {centerValue}
          </span>
          <span className="text-[0.65rem] font-medium uppercase tracking-wide text-txt-muted">
            {centerLabel}
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {segments.map((seg) => {
          const pct = total > 0 ? (seg.value / total) * 100 : 0;
          return (
            <div key={seg.label} className="flex items-center gap-2.5 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="flex-1 text-txt-secondary truncate">
                {seg.label}
              </span>
              <span className="font-mono text-charcoal">{seg.value}</span>
              <span className="font-mono text-txt-muted w-9 text-right">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
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

function NewCampaignDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M7 2v10M2 7h10" />
        </svg>
        New Campaign
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`ml-0.5 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2.5 4L5 6.5L7.5 4" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-52 overflow-hidden rounded-lg border border-border bg-white shadow-lg animate-[scaleIn_150ms_ease-out]" style={{ transformOrigin: "top right" }}>
          <Link
            href="/campaigns/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-[0.8rem] text-charcoal transition-colors hover:bg-cream"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="1.5" width="11" height="12" rx="1.5" />
              <path d="M5 5h5M5 7.5h5M5 10h3" />
            </svg>
            Campaign Wizard
          </Link>
          <Link
            href="/campaigns/new/from-job-spec"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-[0.8rem] text-charcoal transition-colors hover:bg-cream"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 1.5H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V5.5L8.5 1.5z" />
              <path d="M8.5 1.5V5.5h4" />
              <path d="M6 8.5l1.5 2L10 7.5" />
            </svg>
            From Job Spec
          </Link>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("month");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/dashboard?range=${range}`).then((r) => r.json()),
      fetch(`/api/admin/analytics?range=${range}`).then((r) => r.json()),
    ])
      .then(([dashRes, analyticsRes]) => {
        setData(dashRes.data ?? null);
        setAnalytics(analyticsRes.data ?? null);
      })
      .finally(() => setLoading(false));
  }, [range]);

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
            Cross-campaign performance overview &middot; {RANGE_SUBTITLES[range]}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-cream/60 p-0.5">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`rounded-md px-2.5 py-1 text-[0.72rem] font-medium transition-colors cursor-pointer ${
                  range === opt.value
                    ? "bg-surface text-charcoal shadow-sm"
                    : "text-txt-muted hover:text-txt-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <NewCampaignDropdown />
        </div>
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
          sub={`${data.candidates.scored} scored candidates`}
        />
      </div>

      {/* ── Funnel + Score Distribution ── */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* Candidate funnel — donut */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-charcoal mb-5">
            Candidate funnel
          </h2>
          <DonutChart
            total={data.gating.total}
            centerLabel="Applied"
            centerValue={data.gating.total}
            segments={[
              {
                label: "Shortlisted",
                value: data.status_breakdown.find((s) => s.status === "shortlisted")?.count ?? 0,
                color: "#067340",
              },
              {
                label: "Scored",
                value: data.status_breakdown.find((s) => s.status === "scored")?.count ?? 0,
                color: "#2c5bff",
              },
              {
                label: "Awaiting scoring",
                value:
                  (data.status_breakdown.find((s) => s.status === "gating_passed")?.count ?? 0) +
                  (data.status_breakdown.find((s) => s.status === "scoring")?.count ?? 0),
                color: "#7a87ff",
              },
              {
                label: "Rejected",
                value: data.status_breakdown.find((s) => s.status === "rejected")?.count ?? 0,
                color: "#05dbd6",
              },
              {
                label: "Gating failed",
                value: data.status_breakdown.find((s) => s.status === "gating_failed")?.count ?? 0,
                color: "#9fb5c4",
              },
            ]}
          />
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
        {/* Application volume time series */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-charcoal mb-5">
            Application volume
            <span className="ml-2 text-xs font-normal text-txt-muted">
              {RANGE_SUBTITLES[range]}
            </span>
          </h2>
          <AreaChart
            data={data.time_series.map((t) => ({
              ...t,
              label: formatPeriodLabel(t.period, data.granularity),
            }))}
            height={160}
          />
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

      {/* ── Visitor Analytics ── */}
      {analytics && (
        <>
          <div className="mt-8 mb-6 flex items-center gap-3">
            <h2 className="text-lg font-semibold text-charcoal">Visitor Analytics</h2>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Visitor KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Unique visitors"
              value={analytics.visitors.unique}
              sub={`${analytics.visitors.sessions} visits · ${analytics.visitors.total} views`}
            />
            <StatCard
              label="Form started"
              value={analytics.funnel.form_starts}
              sub={`${analytics.funnel.view_to_start_pct}% of visitors`}
            />
            <StatCard
              label="Applications"
              value={analytics.funnel.form_submits}
              sub={`${analytics.funnel.start_to_submit_pct}% completion`}
            />
            <StatCard
              label="Form conversion"
              value={
                analytics.funnel.page_views > 0
                  ? `${Math.round((analytics.funnel.form_submits / analytics.funnel.page_views) * 1000) / 10}%`
                  : "—"
              }
              sub="visitor → application"
            />
          </div>

          {/* Visitor volume chart */}
          <div className="rounded-xl border border-border bg-surface p-6 mb-6">
            <h2 className="text-sm font-semibold text-charcoal mb-5">
              Visitor volume
              <span className="ml-2 text-xs font-normal text-txt-muted">
                {RANGE_SUBTITLES[range]}
              </span>
            </h2>
            <AreaChart
              data={analytics.visitors.time_series.map((t) => ({
                period: t.period,
                count: t.unique,
                label: formatPeriodLabel(t.period, analytics.granularity),
              }))}
              height={160}
            />
          </div>

          {/* Funnel + Drop-off */}
          <div className="grid lg:grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-sm font-semibold text-charcoal mb-5">
                Conversion funnel
              </h2>
              <div className="space-y-4">
                <FunnelRow
                  label="Viewed page"
                  count={analytics.funnel.page_views}
                  total={analytics.funnel.page_views}
                  color="bg-accent"
                />
                <FunnelRow
                  label="Started application"
                  count={analytics.funnel.form_starts}
                  total={analytics.funnel.page_views}
                  color="bg-[#7a87ff]"
                />
                <FunnelRow
                  label="Submitted application"
                  count={analytics.funnel.form_submits}
                  total={analytics.funnel.page_views}
                  color="bg-green"
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-sm font-semibold text-charcoal mb-5">
                Form drop-off by field
              </h2>
              {analytics.abandonment.drop_off_by_field.length > 0 ? (
                <BarChart
                  data={analytics.abandonment.drop_off_by_field}
                  labelKey="field"
                  valueKey="count"
                  maxHeight={160}
                  barColor="bg-vermillion"
                />
              ) : (
                <p className="text-sm text-txt-muted py-10 text-center">
                  No abandonment data yet
                </p>
              )}
            </div>
          </div>

          {/* Browser + Device */}
          <div className="grid lg:grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-sm font-semibold text-charcoal mb-5">
                Browser breakdown
              </h2>
              {analytics.browsers.length > 0 ? (
                <DonutChart
                  total={analytics.browsers.reduce((s, b) => s + b.count, 0)}
                  centerLabel="Visitors"
                  centerValue={analytics.visitors.unique}
                  segments={analytics.browsers.map((b) => ({
                    label: b.browser ?? "Unknown",
                    value: b.count,
                    color: BROWSER_COLORS[b.browser ?? ""] ?? "#9fb5c4",
                  }))}
                />
              ) : (
                <p className="text-sm text-txt-muted py-10 text-center">
                  No visitor data yet
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-sm font-semibold text-charcoal mb-5">
                Device breakdown
              </h2>
              {analytics.devices.length > 0 ? (
                <DonutChart
                  total={analytics.devices.reduce((s, d) => s + d.count, 0)}
                  centerLabel="Visitors"
                  centerValue={analytics.visitors.unique}
                  segments={analytics.devices.map((d) => ({
                    label: d.device_type ?? "Unknown",
                    value: d.count,
                    color: DEVICE_COLORS[d.device_type ?? ""] ?? "#9fb5c4",
                  }))}
                />
              ) : (
                <p className="text-sm text-txt-muted py-10 text-center">
                  No visitor data yet
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
