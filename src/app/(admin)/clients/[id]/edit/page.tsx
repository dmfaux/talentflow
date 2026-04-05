"use client";

import { BrandingSection, type BrandingValues } from "@/components/admin/branding-section";
import { LiveCampaignPreview } from "@/components/admin/live-campaign-preview";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

interface Client {
  id: string;
  name: string;
  slug: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_email: string | null;
  notes: string | null;
  branding_logo_url: string | null;
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
  brand_accent_color: string | null;
  brand_text_color: string | null;
  logo_background: string | null;
  logo_position: string | null;
}

const DEFAULT_BRANDING: BrandingValues = {
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "#0b0f1c",
  brand_secondary_color: "#f3f0e8",
  brand_accent_color: "",
  brand_text_color: "#0b0f1c",
};

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [name, setName] = useState("");
  const [branding, setBranding] = useState<BrandingValues>(DEFAULT_BRANDING);

  useEffect(() => {
    fetch(`/api/admin/clients/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(({ data }: { data: Client }) => {
        setClient(data);
        setName(data.name);
        setBranding({
          logo_url: data.branding_logo_url,
          logo_background: (data.logo_background as BrandingValues["logo_background"]) || "light",
          logo_position: (data.logo_position as BrandingValues["logo_position"]) || "top-left",
          brand_primary_color: data.brand_primary_color ?? "#0b0f1c",
          brand_secondary_color: data.brand_secondary_color ?? "#f3f0e8",
          brand_accent_color: data.brand_accent_color ?? "",
          brand_text_color: data.brand_text_color ?? "#0b0f1c",
        });
      })
      .catch(() => setLoadError("Client not found"))
      .finally(() => setLoading(false));
  }, [id]);

  function patchBranding(patch: Partial<BrandingValues>) {
    setBranding((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError("");

    const form = new FormData(e.currentTarget);
    const trimmedName = name.trim();

    if (!trimmedName) {
      setSaveError("Company name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          contact_name: (form.get("contact_name") as string) || null,
          contact_email: (form.get("contact_email") as string) || null,
          contact_phone: (form.get("contact_phone") as string) || null,
          billing_email: (form.get("billing_email") as string) || null,
          notes: (form.get("notes") as string) || null,
          branding_logo_url: branding.logo_url,
          logo_background: branding.logo_background,
          logo_position: branding.logo_position,
          brand_primary_color: branding.brand_primary_color || null,
          brand_secondary_color: branding.brand_secondary_color || null,
          brand_accent_color: branding.brand_accent_color || null,
          brand_text_color: branding.brand_text_color || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || "Failed to save");
        return;
      }

      router.push(`/clients/${id}`);
    } catch {
      setSaveError("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-sm text-txt-muted">Loading...</div>;
  }

  if (loadError || !client) {
    return <div className="py-20 text-center text-sm text-red">{loadError || "Client not found"}</div>;
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
  const labelClass =
    "mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted";

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/clients" className="hover:text-charcoal transition-colors">
          Clients
        </Link>
        <span>/</span>
        <Link href={`/clients/${id}`} className="hover:text-charcoal transition-colors">
          {client.name}
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">Edit</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Details ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-surface p-8">
          <h1 className="font-display mb-6 text-xl font-medium text-charcoal">Edit Client</h1>

          {saveError && (
            <div className="mb-5 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
              {saveError}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label htmlFor="name" className={labelClass}>
                Company Name <span className="text-red">*</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact_name" className={labelClass}>Contact Name</label>
                <input id="contact_name" name="contact_name" type="text" defaultValue={client.contact_name ?? ""} className={inputClass} />
              </div>
              <div>
                <label htmlFor="contact_email" className={labelClass}>Contact Email</label>
                <input id="contact_email" name="contact_email" type="email" defaultValue={client.contact_email ?? ""} className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact_phone" className={labelClass}>Phone</label>
                <input id="contact_phone" name="contact_phone" type="tel" defaultValue={client.contact_phone ?? ""} className={inputClass} />
              </div>
              <div>
                <label htmlFor="billing_email" className={labelClass}>Billing Email</label>
                <input id="billing_email" name="billing_email" type="email" defaultValue={client.billing_email ?? ""} className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="notes" className={labelClass}>Notes</label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={client.notes ?? ""}
                className="w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20 resize-none"
              />
            </div>
          </div>
        </div>

        {/* ── Branding + Preview ────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="rounded-xl border border-border bg-surface p-8">
            <BrandingSection clientId={client.id} values={branding} onChange={patchBranding} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-6">
            <LiveCampaignPreview values={branding} clientName={name} clientSlug={client.slug} />
          </div>
        </div>

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/clients/${id}`}
            className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-cobalt px-5 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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
  );
}
