"use client";

import { TierBadge } from "@/components/admin/tier-badge";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { useToast } from "@/components/ui/toast-provider";
import { Card, SectionHeading } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormEvent, useEffect, useState } from "react";

interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  tier: string;
  billing_email: string | null;
  contact_name: string | null;
  contact_email: string | null;
  status: string;
}

// Tenant org settings (S9). Editable name + contact; read-only plan + billing
// email (operator-owned). Rendered only for owner/org_admin (the server PATCH is
// gated manage_org_settings; this hides the card from members entirely).
export function OrgSettingsCard() {
  const tenant = useTenant();
  const { toast } = useToast();

  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/organization")
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load");
        return r.json();
      })
      .then(({ data }: { data: OrgSettings }) => {
        setOrg(data);
        setName(data.name ?? "");
        setContactName(data.contact_name ?? "");
        setContactEmail(data.contact_email ?? "");
      })
      .catch(() => setOrg(null))
      .finally(() => setLoading(false));
  }, []);

  if (!canManageOrg(tenant)) return null;

  const dirty =
    !!org &&
    (name.trim() !== org.name ||
      (contactName.trim() || null) !== (org.contact_name ?? null) ||
      (contactEmail.trim() || null) !== (org.contact_email ?? null));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!org || !name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          contact_name: contactName.trim() || null,
          contact_email: contactEmail.trim() || null,
        }),
      });
      const { data, error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not save", "error");
        return;
      }
      setOrg(data);
      setName(data.name);
      setContactName(data.contact_name ?? "");
      setContactEmail(data.contact_email ?? "");
      toast("Organisation updated", "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  // Read-only data labels for the operator-owned plan/billing well.
  const dataLabel =
    "mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

  return (
    <Card className="mb-6">
      <SectionHeading
        className="mb-5"
        title="Organisation"
        icon={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M5 6.5h6M5 9.5h4" />
          </svg>
        }
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !org ? (
        <p className="text-sm text-ink-muted">Could not load organisation settings.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Organisation name" htmlFor="org-name" required>
            <Input
              id="org-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact name" htmlFor="org-contact-name">
              <Input
                id="org-contact-name"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Jane Smith"
              />
            </Field>
            <Field label="Contact email" htmlFor="org-contact-email">
              <Input
                id="org-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="jane@org.com"
              />
            </Field>
          </div>

          {/* Read-only plan + billing (operator-owned) */}
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-canvas/60 px-4 py-3">
            <div>
              <p className={dataLabel}>Plan</p>
              <TierBadge tier={org.tier} size="md" />
            </div>
            <div>
              <p className={dataLabel}>Billing email</p>
              <p className="font-mono text-sm text-ink-soft">
                {org.billing_email || <span className="text-ink-muted">&mdash;</span>}
              </p>
              <p className="mt-1 text-[0.62rem] text-ink-muted">Managed by TalentStream</p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || !name.trim()} loading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
