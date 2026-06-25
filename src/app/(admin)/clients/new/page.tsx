"use client";

import { BrandingSection, type BrandingValues } from "@/components/admin/branding-section";
import { LiveCampaignPreview } from "@/components/admin/live-campaign-preview";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { TierBadge } from "@/components/admin/tier-badge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const INITIAL_BRANDING: BrandingValues = {
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "#11123c",
  brand_secondary_color: "#f0f3f7",
  brand_accent_color: "",
  brand_text_color: "#11123c",
};

export default function NewClientPage() {
  const router = useRouter();
  const tenant = useTenant();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [slugChecking, setSlugChecking] = useState(false);
  const [branding, setBranding] = useState<BrandingValues>(INITIAL_BRANDING);

  // Stable UUID for this draft client — used as the logo upload path prefix
  // and then passed to POST so the server stores the same id.
  const draftId = useMemo(() => crypto.randomUUID(), []);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugManual) setSlug(slugify(value));
  }

  function patchBranding(patch: Partial<BrandingValues>) {
    setBranding((prev) => ({ ...prev, ...patch }));
  }

  async function checkSlug(value: string) {
    if (!value || value.length < 2) return;
    setSlugChecking(true);
    setFieldErrors((prev) => ({ ...prev, slug: "" }));
    try {
      const res = await fetch(`/api/admin/clients/check-slug?slug=${encodeURIComponent(value)}`);
      const { data } = await res.json();
      if (!data.available) {
        setFieldErrors((prev) => ({ ...prev, slug: data.error || "This slug is already taken" }));
      }
    } finally {
      setSlugChecking(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    const trimmedName = name.trim();

    if (!trimmedName) {
      setFieldErrors({ name: "Brand name is required" });
      return;
    }
    if (!slug) {
      setFieldErrors({ slug: "Subdomain slug is required" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draftId,
          name: trimmedName,
          slug,
          // tier is operator-set on the org (the server ignores any value sent
          // here); new brands inherit the org's plan.
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
        setError(data.error || "Failed to create brand");
        return;
      }

      router.push("/clients");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // Brand creation is org_admin+ (server-enforced via manage_brand). Mirror it
  // cosmetically so a member who reaches this URL gets a clear message, not a
  // form that 403s on submit.
  if (!canManageOrg(tenant)) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="rounded-xl border border-border bg-surface px-5 py-14 text-center">
          <h1 className="text-sm font-semibold text-charcoal">Not available</h1>
          <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-txt-muted">
            Only org admins and owners can create brands.
          </p>
          <Link
            href="/clients"
            className="mt-4 inline-flex h-8 items-center rounded-lg bg-accent px-4 text-[0.75rem] font-medium text-white transition-colors hover:bg-accent-light"
          >
            Back to brands
          </Link>
        </div>
      </div>
    );
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
          Brands
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">New brand</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Details ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-surface p-8">
          <h1 className="font-display mb-6 text-xl font-medium text-charcoal">New brand</h1>

          {error && (
            <div className="mb-5 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
              {error}
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
                autoFocus
                value={name}
                placeholder="Acme Corp"
                onChange={(e) => handleNameChange(e.target.value)}
                className={`${inputClass} ${fieldErrors.name ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              />
              {fieldErrors.name && <p className="mt-1 text-xs text-red">{fieldErrors.name}</p>}
            </div>

            <div>
              <label htmlFor="slug" className={labelClass}>
                Subdomain <span className="text-red">*</span>
              </label>
              <input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(e.target.value);
                }}
                onBlur={(e) => checkSlug(e.target.value)}
                placeholder="acme-corp"
                className={`${inputClass} ${fieldErrors.slug ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              />
              <p className="mt-1.5 font-mono text-[0.7rem] text-txt-muted">
                {slug || "slug"}.talentstream.co.za
                {slugChecking && <span className="ml-2 text-txt-muted">checking...</span>}
              </p>
              {fieldErrors.slug && <p className="mt-1 text-xs text-red">{fieldErrors.slug}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact_name" className={labelClass}>Contact Name</label>
                <input id="contact_name" name="contact_name" type="text" placeholder="Jane Smith" className={inputClass} />
              </div>
              <div>
                <label htmlFor="contact_email" className={labelClass}>Contact Email</label>
                <input id="contact_email" name="contact_email" type="email" placeholder="jane@acme.com" className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact_phone" className={labelClass}>Phone</label>
                <input id="contact_phone" name="contact_phone" type="tel" placeholder="+27 82 123 4567" className={inputClass} />
              </div>
              <div>
                <label htmlFor="billing_email" className={labelClass}>Billing Email</label>
                <input id="billing_email" name="billing_email" type="email" placeholder="accounts@acme.com" className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="notes" className={labelClass}>Notes</label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Internal notes about this brand..."
                className="w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20 resize-none"
              />
            </div>
          </div>
        </div>

        {/* ── Subscription Tier (inherited — operator-set) ──────── */}
        <div className="rounded-xl border border-border bg-surface p-8">
          <h2 className="font-display mb-2 text-base font-medium text-charcoal">
            Subscription Tier
          </h2>
          <p className="mb-5 text-[0.75rem] text-txt-muted">
            New brands inherit your organisation&apos;s plan, which is set by
            TalentStream and applies across every brand.
          </p>
          <div className="flex items-center gap-3 rounded-lg bg-cream/60 px-4 py-3">
            <TierBadge tier={tenant.orgTier} size="md" />
            <span className="text-[0.75rem] text-txt-muted">
              Contact TalentStream to change your plan.
            </span>
          </div>
        </div>

        {/* ── Branding + Preview ────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="rounded-xl border border-border bg-surface p-8">
            <BrandingSection clientId={draftId} values={branding} onChange={patchBranding} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-6">
            <LiveCampaignPreview values={branding} clientName={name} clientSlug={slug} />
          </div>
        </div>

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <Link
            href="/clients"
            className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-cobalt px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading && (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Create brand
          </button>
        </div>
      </form>
    </div>
  );
}
