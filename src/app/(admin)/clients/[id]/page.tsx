"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Campaign {
  id: string;
  slug: string;
  role_title: string;
  status: string;
  created_at: string;
}

interface Client {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_email: string | null;
  branding_logo_url: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
  campaigns: Campaign[];
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream text-txt-secondary",
  active: "bg-green-light text-green",
  paused: "bg-[#fef9c3] text-[#a16207]",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/clients/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((res) => setClient(res.data))
      .catch(() => setError("Client not found"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-txt-muted">Loading...</div>
    );
  }

  if (error || !client) {
    return (
      <div className="py-20 text-center text-sm text-red">
        {error || "Client not found"}
      </div>
    );
  }

  const infoItems = [
    { label: "Contact", value: client.contact_name },
    { label: "Email", value: client.contact_email, mono: true },
    { label: "Phone", value: client.contact_phone, mono: true },
    { label: "Billing", value: client.billing_email, mono: true },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/clients" className="hover:text-charcoal transition-colors">
          Clients
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">{client.name}</span>
      </div>

      {/* Client info card */}
      <div className="mb-8 rounded-xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-charcoal">
              {client.name}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  client.is_active !== false ? "bg-green" : "bg-red"
                }`}
              />
              <span className="text-txt-secondary">
                {client.is_active !== false ? "Active" : "Inactive"}
              </span>
              <span className="text-txt-muted">·</span>
              <span className="font-mono text-txt-muted">
                {new Date(client.created_at).toLocaleDateString("en-ZA")}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          {infoItems.map((item) => (
            <div key={item.label}>
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-txt-muted">
                {item.label}
              </p>
              <p
                className={`mt-0.5 text-sm ${
                  item.mono ? "font-mono text-xs" : ""
                } ${item.value ? "text-charcoal" : "text-txt-muted"}`}
              >
                {item.value || "\u2014"}
              </p>
            </div>
          ))}
        </div>

        {client.notes && (
          <div className="mt-4 rounded-lg bg-cream/60 px-4 py-2.5 text-sm text-txt-secondary">
            {client.notes}
          </div>
        )}
      </div>

      {/* Campaigns */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-charcoal">
            Campaigns
            <span className="ml-2 font-mono text-xs font-normal text-txt-muted">
              {client.campaigns.length}
            </span>
          </h2>
        </div>

        {client.campaigns.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-5 py-10 text-center text-sm text-txt-muted">
            No campaigns yet
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                    Role
                  </th>
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                    Slug
                  </th>
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                    Status
                  </th>
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {client.campaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="group cursor-pointer transition-colors hover:bg-cream/60"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="text-sm font-medium text-charcoal group-hover:text-gold"
                      >
                        {campaign.role_title}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-txt-secondary">
                      {campaign.slug}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[0.7rem] font-medium ${
                          STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft
                        }`}
                      >
                        {campaign.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-txt-muted">
                      {new Date(campaign.created_at).toLocaleDateString("en-ZA")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
