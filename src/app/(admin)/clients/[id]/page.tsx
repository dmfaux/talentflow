"use client";

import { TierBadge } from "@/components/admin/tier-badge";
import Link from "next/link";
import { useEffect, useState, FormEvent } from "react";
import { useParams } from "next/navigation";

interface Campaign {
  id: string;
  slug: string;
  role_title: string;
  status: string;
  created_at: string;
}

interface OwnedTemplate {
  id: string;
  key: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  owner_client_id: string | null;
  is_active: boolean;
}

interface Client {
  id: string;
  name: string;
  tier: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_email: string | null;
  branding_logo_url: string | null;
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
  brand_accent_color: string | null;
  brand_text_color: string | null;
  logo_background: string | null;
  logo_position: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
  campaigns: Campaign[];
  ownedTemplates?: OwnedTemplate[];
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
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [ownedTemplates, setOwnedTemplates] = useState<OwnedTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [requestOpen, setRequestOpen] = useState(false);

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

  useEffect(() => {
    if (!id) return;
    setTemplatesLoading(true);
    fetch(`/api/admin/templates?client_id=${id}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((res) => {
        const all: OwnedTemplate[] = res.data ?? [];
        setOwnedTemplates(all.filter((t) => t.owner_client_id === id));
      })
      .catch(() => setOwnedTemplates([]))
      .finally(() => setTemplatesLoading(false));
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
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-charcoal">
                {client.name}
              </h1>
              <TierBadge tier={client.tier ?? "standard"} size="md" />
            </div>
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" />
              </svg>
              Quick edit
            </button>
            <Link
              href={`/clients/${id}/edit`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-cobalt px-3 text-[0.75rem] font-medium text-ink transition-colors hover:bg-cobalt-deep cursor-pointer"
            >
              Edit branding
            </Link>
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

      {/* Branding */}
      <BrandingDisplay client={client} />

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
      <div className="mt-8">
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

      {/* Bespoke Templates */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-charcoal">
            Bespoke Templates
            <span className="ml-2 font-mono text-xs font-normal text-txt-muted">
              {ownedTemplates.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-paper px-4 py-2 text-sm text-ink transition-colors hover:bg-cream cursor-pointer"
          >
            Request Bespoke Template
          </button>
        </div>

        {templatesLoading ? (
          <div className="rounded-xl border border-border bg-surface px-5 py-10 text-center text-sm text-txt-muted">
            Loading templates...
          </div>
        ) : ownedTemplates.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-5 py-10 text-center text-sm text-txt-muted">
            No bespoke templates yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <ul className="divide-y divide-border">
              {ownedTemplates.map((tpl) => (
                <li key={tpl.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="h-12 w-16 shrink-0 overflow-hidden rounded border border-border bg-cream/40">
                    {tpl.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tpl.thumbnail_url}
                        alt={tpl.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-mono text-[0.6rem] text-txt-muted">
                        no img
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-charcoal">
                      {tpl.name}
                    </p>
                    {tpl.description && (
                      <p className="truncate text-xs text-txt-muted">
                        {tpl.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs ${
                      tpl.is_active ? "text-txt-secondary" : "text-txt-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        tpl.is_active ? "bg-green" : "bg-red"
                      }`}
                    />
                    {tpl.is_active ? "Active" : "Inactive"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Request Bespoke Template modal */}
      {requestOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm"
          onClick={() => setRequestOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-base font-semibold text-charcoal">
              Request a Bespoke Template
            </h2>
            <p className="mb-5 text-sm leading-relaxed text-txt-secondary">
              Bespoke templates are custom-designed landing pages built
              exclusively for your account. To commission a new bespoke
              template, please contact your TalentStream account manager or
              email{" "}
              <strong className="font-medium text-charcoal">
                design@talentstream.co.za
              </strong>{" "}
              with your brief. Our design team will scope the work, provide a
              quote, and deliver the template within 3-5 business days.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setRequestOpen(false)}
                className="inline-flex h-9 items-center rounded-lg bg-cobalt px-5 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cobalt-deep cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BrandingDisplay({ client }: { client: Client }) {
  const colors = [
    { label: "Primary", value: client.brand_primary_color },
    { label: "Secondary", value: client.brand_secondary_color },
    { label: "Accent", value: client.brand_accent_color },
    { label: "Text", value: client.brand_text_color },
  ];

  const hasAnyBranding =
    client.branding_logo_url ||
    colors.some((c) => c.value) ||
    client.logo_background ||
    client.logo_position;

  if (!hasAnyBranding) return null;

  const logoBg = client.logo_background ?? "light";
  const logoPosition = client.logo_position ?? "top-left";

  const bgStyle =
    logoBg === "transparent"
      ? {
          backgroundImage:
            "linear-gradient(45deg, #e5dfd0 25%, transparent 25%), linear-gradient(-45deg, #e5dfd0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5dfd0 75%), linear-gradient(-45deg, transparent 75%, #e5dfd0 75%)",
          backgroundSize: "12px 12px",
          backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
        }
      : { backgroundColor: logoBg === "light" ? "#ffffff" : "#0b0f1c" };

  return (
    <div className="mb-8 rounded-xl border border-border bg-surface p-6">
      <h2 className="mb-4 text-sm font-semibold text-charcoal">Branding</h2>

      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        {/* Logo */}
        <div>
          <p className="mb-2 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-txt-muted">
            Logo
          </p>
          <div
            className={`relative flex h-28 w-40 items-center overflow-hidden rounded-lg border border-border ${
              logoPosition === "top-centre" ? "justify-center" : "justify-start pl-4"
            }`}
            style={bgStyle}
          >
            {client.branding_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.branding_logo_url}
                alt={`${client.name} logo`}
                className="max-h-[70%] max-w-[80%] object-contain"
              />
            ) : (
              <span className="font-mono text-[0.7rem] text-txt-muted">no logo</span>
            )}
          </div>
          <p className="mt-2 font-mono text-[0.65rem] text-txt-muted">
            {logoBg} · {logoPosition}
          </p>
        </div>

        {/* Colour swatches */}
        <div>
          <p className="mb-2 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-txt-muted">
            Colours
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {colors.map((c) => (
              <div
                key={c.label}
                className="rounded-lg border border-border bg-cream/30 p-3"
              >
                <div
                  className="h-10 w-full rounded-md border border-border"
                  style={{
                    backgroundColor: c.value ?? "transparent",
                    ...(c.value
                      ? {}
                      : {
                          backgroundImage:
                            "linear-gradient(45deg, #e5dfd0 25%, transparent 25%), linear-gradient(-45deg, #e5dfd0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5dfd0 75%), linear-gradient(-45deg, transparent 75%, #e5dfd0 75%)",
                          backgroundSize: "8px 8px",
                          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
                        }),
                  }}
                />
                <p className="mt-2 text-[0.7rem] font-medium text-charcoal">
                  {c.label}
                </p>
                <p className="font-mono text-[0.65rem] text-txt-muted">
                  {c.value ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
