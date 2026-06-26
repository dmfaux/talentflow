"use client";

import { BrandingSection, type BrandingValues } from "@/components/admin/branding-section";
import { LiveCampaignPreview } from "@/components/admin/live-campaign-preview";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { TierBadge } from "@/components/admin/tier-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { Field, Input, Textarea } from "@/components/ui/field";
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

// Matches the Field primitive's label treatment for the one hand-built field (slug).
const controlLabel = "block text-[0.8rem] font-medium text-ink-soft";

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
        <div className="rounded-xl border border-rule bg-surface px-5 py-14 text-center">
          <h1 className="text-sm font-semibold text-ink">Not available</h1>
          <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-ink-muted">
            Only org admins and owners can create brands.
          </p>
          <Link
            href="/clients"
            className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-4`}
          >
            Back to brands
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/clients" className="hover:text-ink transition-colors">
          Brands
        </Link>
        <span>/</span>
        <span className="text-ink-soft">New brand</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Details ───────────────────────────────────────────── */}
        <Card padding="lg">
          <h1 className="mb-6 text-xl font-semibold text-ink">New brand</h1>

          {error && (
            <Callout tone="error" className="mb-5">
              {error}
            </Callout>
          )}

          <div className="space-y-5">
            <Field label="Company name" htmlFor="name" required error={fieldErrors.name}>
              <Input
                id="name"
                name="name"
                type="text"
                required
                autoFocus
                value={name}
                placeholder="Acme Corp"
                onChange={(e) => handleNameChange(e.target.value)}
                invalid={!!fieldErrors.name}
              />
            </Field>

            <div className="space-y-1.5">
              <label htmlFor="slug" className={controlLabel}>
                Subdomain{" "}
                <span className="text-red" aria-hidden="true">
                  *
                </span>
              </label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(e.target.value);
                }}
                onBlur={(e) => checkSlug(e.target.value)}
                placeholder="acme-corp"
                invalid={!!fieldErrors.slug}
              />
              <p className="font-mono text-[0.7rem] text-ink-muted">
                {slug || "slug"}.talentstream.co.za
                {slugChecking && <span className="ml-2 text-ink-muted">checking…</span>}
              </p>
              {fieldErrors.slug && <p className="text-xs text-red">{fieldErrors.slug}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact name" htmlFor="contact_name">
                <Input id="contact_name" name="contact_name" type="text" placeholder="Jane Smith" />
              </Field>
              <Field label="Contact email" htmlFor="contact_email">
                <Input id="contact_email" name="contact_email" type="email" placeholder="jane@acme.com" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" htmlFor="contact_phone">
                <Input id="contact_phone" name="contact_phone" type="tel" placeholder="+27 82 123 4567" />
              </Field>
              <Field label="Billing email" htmlFor="billing_email">
                <Input id="billing_email" name="billing_email" type="email" placeholder="accounts@acme.com" />
              </Field>
            </div>

            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" name="notes" rows={3} placeholder="Internal notes about this brand..." />
            </Field>
          </div>
        </Card>

        {/* ── Subscription tier (inherited — operator-set) ──────── */}
        <Card padding="lg">
          <h2 className="mb-2 text-base font-semibold text-ink">Subscription tier</h2>
          <p className="mb-5 text-[0.75rem] text-ink-muted">
            New brands inherit your organisation&apos;s plan, which is set by
            TalentStream and applies across every brand.
          </p>
          <div className="flex items-center gap-3 rounded-lg bg-canvas/60 px-4 py-3">
            <TierBadge tier={tenant.orgTier} size="md" />
            <span className="text-[0.75rem] text-ink-muted">
              Contact TalentStream to change your plan.
            </span>
          </div>
        </Card>

        {/* ── Branding + Preview ────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card padding="lg">
            <BrandingSection clientId={draftId} values={branding} onChange={patchBranding} />
          </Card>
          <Card>
            <LiveCampaignPreview values={branding} clientName={name} clientSlug={slug} />
          </Card>
        </div>

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <Link href="/clients" className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </Link>
          <Button type="submit" loading={loading}>
            Create brand
          </Button>
        </div>
      </form>
    </div>
  );
}
