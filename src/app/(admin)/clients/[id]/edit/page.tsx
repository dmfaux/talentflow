"use client";

import { BrandingSection, type BrandingValues } from "@/components/admin/branding-section";
import { LiveCampaignPreview } from "@/components/admin/live-campaign-preview";
import { ThemeCard, type Theme } from "@/components/admin/theme-card";
import { TierBadge } from "@/components/admin/tier-badge";
import { useTenant } from "@/components/admin/tenant-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { Field, Input, Textarea } from "@/components/ui/field";
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
  default_theme_id: string | null;
}

const DEFAULT_BRANDING: BrandingValues = {
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "#11123c",
  brand_secondary_color: "#f0f3f7",
  brand_accent_color: "",
  brand_text_color: "#11123c",
};

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const tenant = useTenant();
  // Tier is org-level (clients.tier is a dead mirror); read it from the tenant
  // context so the badge + custom-theme gate reflect the org's real plan.
  const tier = tenant.orgTier;
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [name, setName] = useState("");
  const [branding, setBranding] = useState<BrandingValues>(DEFAULT_BRANDING);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [defaultThemeId, setDefaultThemeId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/clients/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(({ data }: { data: Client }) => {
        setClient(data);
        setName(data.name);
        setDefaultThemeId(data.default_theme_id);
        setBranding({
          logo_url: data.branding_logo_url,
          logo_background: (data.logo_background as BrandingValues["logo_background"]) || "light",
          logo_position: (data.logo_position as BrandingValues["logo_position"]) || "top-left",
          brand_primary_color: data.brand_primary_color ?? "#11123c",
          brand_secondary_color: data.brand_secondary_color ?? "#f0f3f7",
          brand_accent_color: data.brand_accent_color ?? "",
          brand_text_color: data.brand_text_color ?? "#11123c",
        });
      })
      .catch(() => setLoadError("Brand not found"))
      .finally(() => setLoading(false));
  }, [id]);

  // Themes available to THIS brand (gallery ∪ its own bespoke) for the default
  // selector. Scoped by brand_id so an org_admin editing a non-active brand still
  // sees the right bespoke set.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/themes?brand_id=${id}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((res) => setThemes(res.data ?? []))
      .catch((err) => {
        if (err.name !== "AbortError") setThemes([]);
      });
    return () => controller.abort();
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
          // tier is operator-only — not sent (the server ignores it anyway).
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
          // null = inherit the gallery/default look for new campaigns (CT3).
          default_theme_id: defaultThemeId,
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
    return (
      <div className="mx-auto max-w-5xl">
        <Skeleton className="mb-6 h-4 w-56" />
        <div className="space-y-6">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  if (loadError || !client) {
    return (
      <div className="mx-auto max-w-5xl py-20 text-center">
        <p className="text-sm font-medium text-ink">{loadError || "Brand not found"}</p>
        <p className="mt-1 text-sm text-ink-muted">
          This brand may have been removed, or you don&rsquo;t have access to it.
        </p>
        <Link
          href="/clients"
          className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-5`}
        >
          Back to brands
        </Link>
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
        <Link href={`/clients/${id}`} className="hover:text-ink transition-colors">
          {client.name}
        </Link>
        <span>/</span>
        <span className="text-ink-soft">Edit</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Details ───────────────────────────────────────────── */}
        <Card padding="lg">
          <h1 className="mb-6 text-xl font-semibold text-ink">Edit brand</h1>

          {saveError && (
            <Callout tone="error" className="mb-5">
              {saveError}
            </Callout>
          )}

          <div className="space-y-5">
            <Field label="Company name" htmlFor="name" required>
              <Input
                id="name"
                name="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact name" htmlFor="contact_name">
                <Input id="contact_name" name="contact_name" type="text" defaultValue={client.contact_name ?? ""} />
              </Field>
              <Field label="Contact email" htmlFor="contact_email">
                <Input id="contact_email" name="contact_email" type="email" defaultValue={client.contact_email ?? ""} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" htmlFor="contact_phone">
                <Input id="contact_phone" name="contact_phone" type="tel" defaultValue={client.contact_phone ?? ""} />
              </Field>
              <Field label="Billing email" htmlFor="billing_email">
                <Input id="billing_email" name="billing_email" type="email" defaultValue={client.billing_email ?? ""} />
              </Field>
            </div>

            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" name="notes" rows={3} defaultValue={client.notes ?? ""} />
            </Field>
          </div>
        </Card>

        {/* ── Subscription tier (read-only — operator-set) ──────── */}
        <Card padding="lg">
          <h2 className="mb-2 text-base font-semibold text-ink">Subscription tier</h2>
          <p className="mb-5 text-[0.75rem] text-ink-muted">
            The plan is set by TalentStream for the whole organisation and
            can&apos;t be changed here.
          </p>
          <div className="flex items-center gap-3 rounded-lg bg-canvas/60 px-4 py-3">
            <TierBadge tier={tier} size="md" />
            <span className="text-[0.75rem] text-ink-muted">
              Contact TalentStream to change your plan.
            </span>
          </div>
        </Card>

        {/* ── Default campaign theme (CT3) ──────────────────────── */}
        <Card padding="lg">
          <h2 className="mb-2 text-base font-semibold text-ink">Default campaign theme</h2>
          <p className="mb-5 text-[0.75rem] text-ink-muted">
            The look new campaigns inherit unless a campaign picks its own. Active
            campaigns keep the theme they were published with.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ThemeCard
              inherit
              selected={defaultThemeId === null}
              onClick={() => setDefaultThemeId(null)}
              title="No default"
              subtitle="Inherit"
              hint="TalentStream Classic"
            />
            {themes.map((theme) => {
              const locked = theme.scope === "custom" && tier === "standard";
              return (
                <ThemeCard
                  key={theme.id}
                  selected={defaultThemeId === theme.id}
                  disabled={locked && defaultThemeId !== theme.id}
                  onClick={() => setDefaultThemeId(theme.id)}
                  title={theme.name}
                  subtitle={theme.scope === "custom" ? "Bespoke" : "Gallery"}
                  previewImageUrl={theme.preview_image_url}
                  hint={locked ? "Premium plan only" : undefined}
                />
              );
            })}
          </div>
        </Card>

        {/* ── Branding + Preview ────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card padding="lg">
            <BrandingSection clientId={client.id} values={branding} onChange={patchBranding} />
          </Card>
          <Card>
            <LiveCampaignPreview values={branding} clientName={name} clientSlug={client.slug} />
          </Card>
        </div>

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <Link href={`/clients/${id}`} className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </Link>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
