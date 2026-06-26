"use client";

import { TierBadge } from "@/components/admin/tier-badge";
import { useTenant } from "@/components/admin/tenant-provider";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Textarea } from "@/components/ui/field";
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

interface Client {
  id: string;
  name: string;
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

}

// Campaign status → Badge tone — the shared map used across the campaigns and
// candidates clusters (draft/archived neutral, active moss, paused saffron,
// closed red).
const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  active: "moss",
  paused: "saffron",
  closed: "red",
  archived: "neutral",
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tenant = useTenant();
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
      .catch(() => setError("Brand not found"))
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
      <div>
        <Skeleton className="mb-6 h-4 w-40" />
        <Skeleton className="mb-8 h-44 rounded-xl" />
        <Skeleton className="mb-8 h-48 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm font-medium text-ink">{error || "Brand not found"}</p>
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

  const infoItems = [
    { label: "Contact", value: client.contact_name },
    { label: "Email", value: client.contact_email, mono: true },
    { label: "Phone", value: client.contact_phone, mono: true },
    { label: "Billing", value: client.billing_email, mono: true },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/clients" className="hover:text-ink transition-colors">
          Brands
        </Link>
        <span>/</span>
        <span className="text-ink-soft">{client.name}</span>
      </div>

      {/* Brand info card */}
      <Card className="mb-8">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-ink">{client.name}</h1>
              <TierBadge tier={tenant.orgTier} size="md" />
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <Badge tone={client.is_active !== false ? "moss" : "neutral"} dot>
                {client.is_active !== false ? "Active" : "Inactive"}
              </Badge>
              <span className="font-mono text-ink-muted">
                {new Date(client.created_at).toLocaleDateString("en-ZA")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" />
              </svg>
              Quick edit
            </Button>
            <Link href={`/clients/${id}/edit`} className={buttonVariants({ size: "sm" })}>
              Edit branding
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          {infoItems.map((item) => (
            <div key={item.label}>
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
                {item.label}
              </p>
              <p
                className={`mt-0.5 text-sm ${
                  item.mono ? "font-mono text-xs" : ""
                } ${item.value ? "text-ink" : "text-ink-muted"}`}
              >
                {item.value || "—"}
              </p>
            </div>
          ))}
        </div>

        {client.notes && (
          <div className="mt-4 rounded-lg bg-canvas/60 px-4 py-2.5 text-sm text-ink-soft">
            {client.notes}
          </div>
        )}
      </Card>

      {/* Branding */}
      <BrandingDisplay client={client} />

      {/* Edit modal */}
      <Modal
        open={editing}
        onClose={() => {
          setEditing(false);
          setSaveError("");
        }}
        title="Edit brand"
        size="lg"
        dismissible={!saving}
      >
        {saveError && (
          <Callout tone="error" className="mb-4">
            {saveError}
          </Callout>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Company name" htmlFor="edit-name" required>
            <Input id="edit-name" name="name" type="text" required defaultValue={client.name} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name" htmlFor="edit-contact_name">
              <Input id="edit-contact_name" name="contact_name" type="text" defaultValue={client.contact_name ?? ""} />
            </Field>
            <Field label="Contact email" htmlFor="edit-contact_email">
              <Input id="edit-contact_email" name="contact_email" type="email" defaultValue={client.contact_email ?? ""} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" htmlFor="edit-contact_phone">
              <Input id="edit-contact_phone" name="contact_phone" type="tel" defaultValue={client.contact_phone ?? ""} />
            </Field>
            <Field label="Billing email" htmlFor="edit-billing_email">
              <Input id="edit-billing_email" name="billing_email" type="email" defaultValue={client.billing_email ?? ""} />
            </Field>
          </div>

          <Field label="Notes" htmlFor="edit-notes">
            <Textarea id="edit-notes" name="notes" rows={3} defaultValue={client.notes ?? ""} />
          </Field>

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setSaveError("");
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Campaigns */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Campaigns
            <span className="ml-2 font-mono text-xs font-normal text-ink-muted">
              {client.campaigns.length}
            </span>
          </h2>
        </div>

        {client.campaigns.length === 0 ? (
          <div className="rounded-xl border border-rule bg-surface px-5 py-10 text-center text-sm text-ink-muted">
            No campaigns yet
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-rule bg-surface">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-rule">
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Role
                  </th>
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Slug
                  </th>
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Status
                  </th>
                  <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {client.campaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="group cursor-pointer transition-colors hover:bg-canvas/60"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="text-sm font-medium text-ink group-hover:text-cobalt"
                      >
                        {campaign.role_title}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-soft">
                      {campaign.slug}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[campaign.status] ?? "neutral"} dot uppercase>
                        {campaign.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-muted">
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

  // Literal hex values below render the logo-preview surfaces (light/dark card
  // backgrounds + the transparency checkerboard) — real colours, not theme tokens.
  const bgStyle =
    logoBg === "transparent"
      ? {
          backgroundImage:
            "linear-gradient(45deg, #d1dce6 25%, transparent 25%), linear-gradient(-45deg, #d1dce6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1dce6 75%), linear-gradient(-45deg, transparent 75%, #d1dce6 75%)",
          backgroundSize: "12px 12px",
          backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
        }
      : { backgroundColor: logoBg === "light" ? "#ffffff" : "#11123c" };

  return (
    <Card className="mb-8">
      <h2 className="mb-4 text-sm font-semibold text-ink">Branding</h2>

      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        {/* Logo */}
        <div>
          <p className="mb-2 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
            Logo
          </p>
          <div
            className={`relative flex h-28 w-40 items-center overflow-hidden rounded-lg border border-rule ${
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
              <span className="font-mono text-[0.7rem] text-ink-muted">no logo</span>
            )}
          </div>
          <p className="mt-2 font-mono text-[0.65rem] text-ink-muted">
            {logoBg} · {logoPosition}
          </p>
        </div>

        {/* Colour swatches */}
        <div>
          <p className="mb-2 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
            Colours
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {colors.map((c) => (
              <div
                key={c.label}
                className="rounded-lg border border-rule bg-canvas/30 p-3"
              >
                <div
                  className="h-10 w-full rounded-md border border-rule"
                  style={{
                    backgroundColor: c.value ?? "transparent",
                    ...(c.value
                      ? {}
                      : {
                          backgroundImage:
                            "linear-gradient(45deg, #d1dce6 25%, transparent 25%), linear-gradient(-45deg, #d1dce6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1dce6 75%), linear-gradient(-45deg, transparent 75%, #d1dce6 75%)",
                          backgroundSize: "8px 8px",
                          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
                        }),
                  }}
                />
                <p className="mt-2 text-[0.7rem] font-medium text-ink">
                  {c.label}
                </p>
                <p className="font-mono text-[0.65rem] text-ink-muted">
                  {c.value ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
