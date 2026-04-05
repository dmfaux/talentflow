"use client";

import Link from "next/link";
import { useEffect, useState, FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";

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
  paused: "bg-warning-light text-warning",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError("");
    setSaving(true);

    const form = new FormData(e.currentTarget);
    const name = (form.get("name") as string).trim();
    if (!name) {
      setSaveError("Name is required");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/admin/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contact_name: (form.get("contact_name") as string) || null,
          contact_email: (form.get("contact_email") as string) || null,
          contact_phone: (form.get("contact_phone") as string) || null,
          billing_email: (form.get("billing_email") as string) || null,
          notes: (form.get("notes") as string) || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || "Failed to save");
        return;
      }

      const { data } = await res.json();
      setClient((prev) => (prev ? { ...prev, ...data } : prev));
      setEditing(false);
    } catch {
      setSaveError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

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

  const inputClass =
    "h-9 w-full rounded-lg border border-border bg-cream/40 px-3 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20";
  const labelClass =
    "mb-1 block text-[0.65rem] font-medium uppercase tracking-[0.12em] text-txt-muted";

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
              <span className="text-txt-muted">&middot;</span>
              <span className="font-mono text-txt-muted">
                {new Date(client.created_at).toLocaleDateString("en-ZA")}
              </span>
            </div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" />
            </svg>
            Edit
          </button>
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

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h2 className="mb-5 text-base font-semibold text-charcoal">
              Edit Client
            </h2>

            {saveError && (
              <div className="mb-4 rounded-lg bg-red-light px-4 py-2 text-sm text-red">
                {saveError}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="edit-name" className={labelClass}>
                  Company Name <span className="text-red">*</span>
                </label>
                <input
                  id="edit-name"
                  name="name"
                  type="text"
                  required
                  defaultValue={client.name}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-contact_name" className={labelClass}>Contact Name</label>
                  <input id="edit-contact_name" name="contact_name" type="text" defaultValue={client.contact_name ?? ""} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="edit-contact_email" className={labelClass}>Contact Email</label>
                  <input id="edit-contact_email" name="contact_email" type="email" defaultValue={client.contact_email ?? ""} className={inputClass} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-contact_phone" className={labelClass}>Phone</label>
                  <input id="edit-contact_phone" name="contact_phone" type="tel" defaultValue={client.contact_phone ?? ""} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="edit-billing_email" className={labelClass}>Billing Email</label>
                  <input id="edit-billing_email" name="billing_email" type="email" defaultValue={client.billing_email ?? ""} className={inputClass} />
                </div>
              </div>

              <div>
                <label htmlFor="edit-notes" className={labelClass}>Notes</label>
                <textarea
                  id="edit-notes"
                  name="notes"
                  rows={3}
                  defaultValue={client.notes ?? ""}
                  className="w-full rounded-lg border border-border bg-cream/40 px-3 py-2 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setEditing(false); setSaveError(""); }}
                  className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.8rem] font-medium text-ink transition-colors hover:bg-accent-light hover:text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {saving && (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                        className="text-sm font-medium text-charcoal group-hover:text-accent"
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
