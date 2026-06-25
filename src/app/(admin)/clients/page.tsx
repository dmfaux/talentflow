"use client";

import { TierBadge } from "@/components/admin/tier-badge";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

interface Client {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  is_active: boolean | null;
  campaigns?: unknown[];
}

const PAGE_SIZE = 20;

export default function ClientsPage() {
  const router = useRouter();
  const tenant = useTenant();
  const canCreate = canManageOrg(tenant);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters — tier is an org-level attribute every brand inherits, so there's
  // nothing per-brand to filter on; only search + status remain.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  // Pagination
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((res) => setClients(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter === "active" && c.is_active === false) return false;
      if (statusFilter === "inactive" && c.is_active !== false) return false;
      if (q) {
        const haystack = [c.name, c.contact_name ?? "", c.contact_email ?? ""]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [clients, search, statusFilter]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Brands</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            {loading
              ? "Loading..."
              : hasActiveFilters
                ? `${filtered.length} of ${clients.length}`
                : `${clients.length} total`}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/clients/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            New brand
          </Link>
        )}
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
            placeholder="Search name, contact, email..."
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
          onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
          className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[0.78rem] font-medium text-txt-secondary outline-none focus:border-accent cursor-pointer"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
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

      {/* Table */}
      {loading ? (
        <div className="rounded-xl border border-border bg-surface py-20 text-center text-sm text-txt-muted">
          Loading brands...
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          icon="campaigns"
          title="No brands yet"
          description="Brands carry their own careers page, branding, and team. Create your first to start running campaigns."
          actionLabel={canCreate ? "New brand" : undefined}
          actionHref={canCreate ? "/clients/new" : undefined}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface py-20 text-center">
          <p className="text-sm text-txt-secondary">No brands match your filters</p>
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
                <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                  Name
                </th>
                <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                  Contact
                </th>
                <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                  Email
                </th>
                <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted text-center">
                  Campaigns
                </th>
                <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.map((client) => (
                <tr
                  key={client.id}
                  className="group cursor-pointer transition-colors hover:bg-cream/60"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    router.push(`/clients/${client.id}`);
                  }}
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/clients/${client.id}`}
                      className="inline-flex items-center gap-2 text-sm font-medium text-charcoal group-hover:text-accent"
                    >
                      <span className="text-[0.95rem] font-medium text-ink">{client.name}</span>
                      <TierBadge tier={tenant.orgTier} />
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-txt-secondary">
                    {client.contact_name || <span className="text-txt-muted">&mdash;</span>}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-txt-secondary">
                    {client.contact_email || <span className="text-txt-muted">&mdash;</span>}
                  </td>
                  <td className="px-5 py-3 text-center font-mono text-xs text-txt-secondary">
                    {client.campaigns?.length ?? 0}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          client.is_active !== false ? "bg-green" : "bg-red"
                        }`}
                      />
                      <span className="text-txt-secondary">
                        {client.is_active !== false ? "Active" : "Inactive"}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="text-xs text-txt-muted">
                Showing {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 0}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-txt-muted transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8.5 3L4.5 7l4 4" /></svg>
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 7) pageNum = i;
                  else if (page < 4) pageNum = i;
                  else if (page > totalPages - 5) pageNum = totalPages - 7 + i;
                  else pageNum = page - 3 + i;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
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
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-txt-muted transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5.5 3L9.5 7l-4 4" /></svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
