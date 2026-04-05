"use client";

import { TierBadge } from "@/components/admin/tier-badge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Client {
  id: string;
  name: string;
  tier: string | null;
  contact_name: string | null;
  contact_email: string | null;
  is_active: boolean | null;
  campaigns?: unknown[];
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((res) => setClients(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Clients</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            {loading ? "Loading..." : `${clients.length} total`}
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-ink transition-colors hover:bg-accent-light hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          New Client
        </Link>
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
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-txt-muted">
                  Loading clients...
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-txt-muted">
                  No clients yet.{" "}
                  <Link href="/clients/new" className="text-accent hover:underline">
                    Create one
                  </Link>
                </td>
              </tr>
            ) : (
              clients.map((client) => (
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
                      <TierBadge tier={client.tier ?? "standard"} />
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
