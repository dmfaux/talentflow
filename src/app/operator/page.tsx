"use client";

import { TierBadge } from "@/components/admin/tier-badge";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Organization {
  id: string;
  name: string;
  slug: string;
  tier: string;
  status: string;
  billing_email: string | null;
  created_at: string;
}

const TIERS = ["all", "standard", "premium", "enterprise"] as const;
const STATUSES = ["all", "active", "suspended", "deleted"] as const;
const PAGE_SIZE = 50;

const STATUS_DOT: Record<string, string> = {
  active: "bg-green",
  suspended: "bg-warning",
  deleted: "bg-red",
};

export default function OperatorOrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("all");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [page, setPage] = useState(0);

  // Server-side search/filter — the operator legitimately spans all orgs, so
  // querying is the right model (vs. fetch-all + client filter).
  useEffect(() => {
    const params = new URLSearchParams();
    const q = search.trim();
    if (q) params.set("q", q);
    if (tier !== "all") params.set("tier", tier);
    if (status !== "all") params.set("status", status);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));

    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/operator/organizations?${params.toString()}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((res) => {
          setOrgs(res.data?.organizations ?? []);
          setTotal(res.data?.total ?? 0);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setOrgs([]);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [search, tier, status, page]);

  // Reset to first page when filters change.
  useEffect(() => {
    setPage(0);
  }, [search, tier, status]);

  const hasFilters = search.trim() !== "" || tier !== "all" || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-ink-muted">
            Control plane
          </p>
          <h1 className="mt-1 font-serif text-2xl text-ink">Organisations</h1>
          <p className="mt-1 text-xs text-ink-muted">
            {loading ? "Loading…" : `${total} ${total === 1 ? "org" : "orgs"}${hasFilters ? " matching filters" : " total"}`}
          </p>
        </div>
        <Link
          href="/operator/orgs/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cobalt px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-cobalt-deep"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          New organisation
        </Link>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
          >
            <circle cx="6" cy="6" r="4" />
            <path d="M9 9l3 3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or slug…"
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 font-mono text-[0.78rem] text-ink outline-none placeholder:text-ink-muted placeholder:font-sans focus:border-cobalt"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          className="h-9 cursor-pointer rounded-lg border border-border bg-surface px-2.5 text-[0.78rem] font-medium capitalize text-ink-soft outline-none focus:border-cobalt"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
          ))}
        </select>

        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as (typeof TIERS)[number])}
          className="h-9 cursor-pointer rounded-lg border border-border bg-surface px-2.5 text-[0.78rem] font-medium capitalize text-ink-soft outline-none focus:border-cobalt"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>{t === "all" ? "All tiers" : t}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => { setSearch(""); setTier("all"); setStatus("all"); }}
            className="h-9 cursor-pointer rounded-lg px-2.5 text-[0.78rem] font-medium text-ink-muted hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {loading && orgs.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface py-20 text-center text-sm text-ink-muted">
          Loading organisations…
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState
          icon="campaigns"
          title={hasFilters ? "No organisations match" : "No organisations yet"}
          description={hasFilters ? "Try clearing the filters above." : "Provisioned organisations will appear here."}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-canvas/60">
                <th className="px-5 py-3 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">Organisation</th>
                <th className="px-5 py-3 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">Slug</th>
                <th className="px-5 py-3 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">Tier</th>
                <th className="px-5 py-3 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">Status</th>
                <th className="px-5 py-3 text-right text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orgs.map((org) => (
                <tr
                  key={org.id}
                  className="group cursor-pointer transition-colors hover:bg-cobalt-tint/40"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    router.push(`/operator/orgs/${org.id}`);
                  }}
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/operator/orgs/${org.id}`}
                      className="text-sm font-medium text-ink group-hover:text-cobalt"
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-muted">{org.slug}</td>
                  <td className="px-5 py-3"><TierBadge tier={org.tier} /></td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[org.status] ?? "bg-ink-muted"}`} />
                      <span className="capitalize text-ink-soft">{org.status}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-ink-muted">
                    {new Date(org.created_at).toLocaleDateString("en-ZA")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="font-mono text-xs text-ink-muted">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-ink-soft transition-colors hover:bg-canvas disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-ink-soft transition-colors hover:bg-canvas disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
