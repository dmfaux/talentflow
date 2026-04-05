"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  owner_client_id: string | null;
  owner_client_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type FilterTab = "all" | "shared" | "bespoke";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "shared", label: "Shared Library" },
  { id: "bespoke", label: "Bespoke" },
];

function formatCreated(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  useEffect(() => {
    fetch("/api/admin/templates")
      .then((r) => r.json())
      .then((res) => setTemplates(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (activeTab === "all") return templates;
    if (activeTab === "shared")
      return templates.filter((t) => t.owner_client_id === null);
    return templates.filter((t) => t.owner_client_id !== null);
  }, [templates, activeTab]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Templates</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            Template library available to campaigns
          </p>
        </div>
        <Link
          href="/templates/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cobalt px-4 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cobalt-deep"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M7 2v10M2 7h10" />
          </svg>
          Register Template
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-canvas-2 p-1">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                active
                  ? "bg-paper text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Name
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Key
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Owner
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Active
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-txt-muted"
                >
                  Loading templates...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-txt-muted"
                >
                  No templates registered yet.{" "}
                  <Link
                    href="/templates/new"
                    className="text-cobalt hover:underline"
                  >
                    Register one
                  </Link>
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr
                  key={t.id}
                  className="group transition-colors hover:bg-cream/60"
                >
                  <td className="px-5 py-3">
                    <div className="font-display text-sm font-medium text-charcoal">
                      {t.name}
                    </div>
                    {t.description && (
                      <div className="mt-0.5 text-xs text-ink-muted">
                        {t.description}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-muted">
                    {t.key}
                  </td>
                  <td className="px-5 py-3 text-sm">
                    {t.owner_client_id === null ? (
                      <span className="text-ink-muted">Shared Library</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-medium text-charcoal">
                          {t.owner_client_name ?? "Unknown"}
                        </span>
                        <span className="inline-flex items-center rounded-sm bg-vermillion/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-vermillion">
                          Bespoke
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          t.is_active ? "bg-green" : "bg-red"
                        }`}
                      />
                      <span className="text-txt-secondary">
                        {t.is_active ? "Active" : "Inactive"}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-txt-secondary">
                    {formatCreated(t.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
