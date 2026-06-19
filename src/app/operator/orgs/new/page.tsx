"use client";

import { useToast } from "@/components/ui/toast-provider";
import type { Tier } from "@/components/admin/tier-badge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

// Local mirrors of src/lib/slug.ts — that module imports the db, so it can't be
// pulled into a client bundle. Validation here is cosmetic; the server's
// validateSlug is authoritative and its error is surfaced inline on submit.
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "mail", "ftp",
  "staging", "dev", "test", "status", "cdn", "assets",
]);
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function slugHint(slug: string): string | null {
  if (!slug) return null;
  if (slug.length < 2) return "Slug must be at least 2 characters";
  if (slug.length > 63) return "Slug must be 63 characters or fewer";
  if (!SLUG_REGEX.test(slug)) return "Lowercase letters, numbers, and hyphens only";
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved`;
  return null;
}

const TIER_OPTIONS: Array<{ value: Tier; label: string; helper: string }> = [
  { value: "standard", label: "Standard", helper: "Shared templates · pay per campaign" },
  { value: "premium", label: "Premium", helper: "One bespoke template · reduced rate" },
  { value: "enterprise", label: "Enterprise", helper: "Retainer · unlimited & bespoke" },
];

export default function NewOrganizationPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [tier, setTier] = useState<Tier>("standard");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  function handleNameChange(value: string) {
    setName(value);
    if (!slugManual) setSlug(slugify(value));
  }

  const slugProblem = slugHint(slug);
  const canSubmit =
    name.trim() !== "" && slug !== "" && !slugProblem && ownerEmail.trim() !== "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!canSubmit) return;

    setSaving(true);
    try {
      const res = await fetch("/api/operator/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          tier,
          ownerEmail: ownerEmail.trim(),
        }),
      });
      const { data, error } = await res.json();
      if (!res.ok) {
        setFormError(error || "Could not provision the organisation");
        return;
      }
      toast("Organisation provisioned — invite sent", "success");
      router.push(`/operator/orgs/${data.organization.id}`);
    } catch {
      setFormError("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
  const labelClass =
    "mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

  return (
    <div className="mx-auto max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/operator" className="transition-colors hover:text-ink">
          Organisations
        </Link>
        <span>/</span>
        <span className="text-ink-soft">New</span>
      </div>

      <div className="mb-6">
        <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-ink-muted">
          Control plane
        </p>
        <h1 className="mt-1 font-serif text-2xl text-ink">New organisation</h1>
        <p className="mt-1 text-xs text-ink-muted">
          Provisions an empty, isolated org and emails its first Owner an invitation.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="rounded-xl border border-border bg-surface p-6">
          {formError && (
            <div className="mb-5 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
              {formError}
            </div>
          )}

          <div className="space-y-5">
            {/* Name */}
            <div>
              <label htmlFor="org-name" className={labelClass}>
                Organisation name
              </label>
              <input
                id="org-name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Holdings"
                className={inputClass}
              />
            </div>

            {/* Slug */}
            <div>
              <label htmlFor="org-slug" className={labelClass}>
                Org slug
              </label>
              <input
                id="org-slug"
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                placeholder="acme-holdings"
                className={`${inputClass} font-mono ${slugProblem ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              />
              <p className="mt-1.5 font-mono text-[0.7rem] text-ink-muted">
                {slug || "slug"}.talentstream.co.za
              </p>
              {slugProblem && <p className="mt-1 text-xs text-red">{slugProblem}</p>}
            </div>

            {/* Tier */}
            <div>
              <label className={labelClass}>Tier</label>
              <div className="grid grid-cols-3 gap-2">
                {TIER_OPTIONS.map((opt) => {
                  const selected = tier === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTier(opt.value)}
                      className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                        selected ? "border-cobalt bg-cobalt-tint" : "border-border bg-paper hover:border-border-strong"
                      }`}
                    >
                      <span className="text-[0.8rem] font-semibold text-ink">{opt.label}</span>
                      <span className="text-[0.68rem] leading-snug text-ink-muted">{opt.helper}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Owner email */}
            <div>
              <label htmlFor="owner-email" className={labelClass}>
                Owner email
              </label>
              <input
                id="owner-email"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="owner@acme.com"
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1.5 text-[0.7rem] text-ink-muted">
                They&rsquo;ll receive an invitation to set a password and sign in as the org Owner.
              </p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-5">
            <Link
              href="/operator"
              className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-cobalt px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-cobalt-deep disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {saving && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Provision organisation
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
