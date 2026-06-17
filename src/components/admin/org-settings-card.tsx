"use client";

import { TierBadge } from "@/components/admin/tier-badge";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { useToast } from "@/components/ui/toast-provider";
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
      toast("Organization updated", "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20";
  const labelClass =
    "mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted";

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-6">
      <div className="mb-5 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1b4332" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M5 6.5h6M5 9.5h4" />
        </svg>
        <h2 className="text-sm font-semibold text-charcoal">Organization</h2>
      </div>

      {loading ? (
        <p className="text-sm text-txt-muted">Loading…</p>
      ) : !org ? (
        <p className="text-sm text-txt-muted">Could not load organization settings.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="org-name" className={labelClass}>
              Organization Name
            </label>
            <input
              id="org-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="org-contact-name" className={labelClass}>
                Contact Name
              </label>
              <input
                id="org-contact-name"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Jane Smith"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="org-contact-email" className={labelClass}>
                Contact Email
              </label>
              <input
                id="org-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="jane@org.com"
                className={inputClass}
              />
            </div>
          </div>

          {/* Read-only plan + billing (operator-owned) */}
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-cream/60 px-4 py-3">
            <div>
              <p className={labelClass}>Plan</p>
              <TierBadge tier={org.tier} size="md" />
            </div>
            <div>
              <p className={labelClass}>Billing Email</p>
              <p className="font-mono text-sm text-txt-secondary">
                {org.billing_email || <span className="text-txt-muted">&mdash;</span>}
              </p>
              <p className="mt-1 text-[0.62rem] text-txt-muted">Managed by TalentStream</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!dirty || !name.trim() || saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.78rem] font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {saving && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Save changes
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
