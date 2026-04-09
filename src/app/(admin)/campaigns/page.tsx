"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";

interface Campaign {
  id: string;
  client_name: string | null;
  client_slug: string | null;
  slug: string;
  role_title: string;
  department: string | null;
  location: string | null;
  status: string;
  campaign_start: string | null;
  campaign_end: string | null;
  created_at: string;
}

const STATUSES = ["all", "draft", "active", "paused", "closed", "archived"] as const;
type StatusFilter = (typeof STATUSES)[number];

type SortKey =
  | "role_title"
  | "client_name"
  | "department"
  | "location"
  | "status"
  | "campaign_end"
  | "created_at";
type SortDir = "asc" | "desc";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream text-txt-secondary",
  active: "bg-green-light text-green",
  paused: "bg-warning-light text-warning",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
};

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

function daysRemaining(end: string | null): string {
  if (!end) return "—";
  const diff = Math.ceil(
    (new Date(end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return "Ended";
  if (diff === 0) return "Ends today";
  return `${diff}d`;
}

function compareNullable(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDir,
): number {
  // Nulls always sort last regardless of direction
  const aNull = a === null || a === undefined || a === "";
  const bNull = b === null || b === undefined || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const mult = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mult;
  return String(a).localeCompare(String(b)) * mult;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    fetch("/api/admin/campaigns")
      .then((r) => r.json())
      .then((res) => setCampaigns(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const clients = useMemo(() => {
    const names = new Set<string>();
    for (const c of campaigns) {
      if (c.client_name) names.add(c.client_name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [campaigns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = campaigns.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (clientFilter !== "all" && c.client_name !== clientFilter) return false;
      if (q) {
        const haystack = [
          c.role_title,
          c.client_name ?? "",
          c.department ?? "",
          c.location ?? "",
          c.slug,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) =>
      compareNullable(a[sortKey], b[sortKey], sortDir),
    );
  }, [campaigns, statusFilter, clientFilter, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Default direction per column type: text ascending, dates descending
      setSortDir(key === "created_at" || key === "campaign_end" ? "desc" : "asc");
    }
  }

  function clearFilters() {
    setStatusFilter("all");
    setClientFilter("all");
    setSearch("");
  }

  const hasActiveFilters =
    statusFilter !== "all" || clientFilter !== "all" || search.trim() !== "";

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Campaigns</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            {loading
              ? "Loading..."
              : hasActiveFilters
                ? `${filtered.length} of ${campaigns.length}`
                : `${campaigns.length} total`}
          </p>
        </div>
        <NewCampaignDropdown />
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-muted pointer-events-none"
          >
            <circle cx="6" cy="6" r="4" />
            <path d="M9 9l3 3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search role, client, location..."
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[0.78rem] text-charcoal outline-none placeholder:text-txt-muted focus:border-accent"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-txt-muted hover:text-charcoal cursor-pointer"
              aria-label="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[0.78rem] font-medium text-txt-secondary outline-none focus:border-accent cursor-pointer capitalize"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>

        {/* Client filter */}
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          disabled={clients.length === 0}
          className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[0.78rem] font-medium text-txt-secondary outline-none focus:border-accent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="all">All clients</option>
          {clients.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="h-9 rounded-lg border border-transparent px-2.5 text-[0.78rem] font-medium text-txt-muted hover:text-charcoal cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Data grid */}
      {loading ? (
        <div className="rounded-xl border border-border bg-surface py-20 text-center text-sm text-txt-muted">
          Loading campaigns...
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon="campaigns"
          title="No campaigns yet"
          description="Create your first campaign to start screening candidates with AI-powered assessments."
          actionLabel="Create Campaign"
          actionHref="/campaigns/new"
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface py-20 text-center">
          <p className="text-sm text-txt-secondary">No campaigns match your filters</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-[0.78rem] font-medium text-accent hover:underline cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <SortHeader label="Role" sortKey="role_title" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Client" sortKey="client_name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Department" sortKey="department" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Location" sortKey="location" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Ends" sortKey="campaign_end" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Created" sortKey="created_at" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((campaign) => (
                <tr
                  key={campaign.id}
                  className="group cursor-pointer transition-colors hover:bg-cream/60"
                  onClick={(e) => {
                    // Let link clicks through without double-navigating
                    if ((e.target as HTMLElement).closest("a")) return;
                    router.push(`/campaigns/${campaign.id}`);
                  }}
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="block text-sm font-medium text-charcoal group-hover:text-accent transition-colors"
                    >
                      {campaign.role_title}
                    </Link>
                    <p className="mt-0.5 font-mono text-[0.62rem] text-txt-muted">
                      {campaign.client_slug}/{campaign.slug}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-sm text-txt-secondary">
                    {campaign.client_name ?? <span className="text-txt-muted">&mdash;</span>}
                  </td>
                  <td className="px-5 py-3 text-sm text-txt-secondary">
                    {campaign.department ?? <span className="text-txt-muted">&mdash;</span>}
                  </td>
                  <td className="px-5 py-3 text-sm text-txt-secondary">
                    {campaign.location ?? <span className="text-txt-muted">&mdash;</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium capitalize ${
                        STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft
                      }`}
                    >
                      {campaign.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-txt-secondary">
                    {daysRemaining(campaign.campaign_end)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[0.65rem] text-txt-muted">
                    {new Date(campaign.created_at).toLocaleDateString("en-ZA")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = currentKey === sortKey;
  return (
    <th className={`px-5 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[0.63rem] font-semibold uppercase tracking-[0.12em] transition-colors cursor-pointer ${
          active ? "text-charcoal" : "text-txt-muted hover:text-txt-secondary"
        }`}
      >
        {label}
        <span className="flex flex-col leading-none">
          <svg
            width="8"
            height="5"
            viewBox="0 0 8 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={active && currentDir === "asc" ? "text-accent" : "text-txt-muted/50"}
          >
            <path d="M1.5 3.5L4 1l2.5 2.5" />
          </svg>
          <svg
            width="8"
            height="5"
            viewBox="0 0 8 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={active && currentDir === "desc" ? "text-accent" : "text-txt-muted/50"}
          >
            <path d="M1.5 1.5L4 4l2.5-2.5" />
          </svg>
        </span>
      </button>
    </th>
  );
}
