"use client";

import { useToast } from "@/components/ui/toast-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
  // Optional per-org plan overrides — blank = inherit the tier's plan default.
  const [baseFee, setBaseFee] = useState("");
  const [includedCredits, setIncludedCredits] = useState("");
  const [overageDiscount, setOverageDiscount] = useState("");
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

    const toOverride = (s: string) =>
      s.trim() === "" ? null : Math.max(0, parseInt(s, 10) || 0);

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
          base_fee_zar: toOverride(baseFee),
          included_credits: toOverride(includedCredits),
          overage_discount_pct:
            overageDiscount.trim() === ""
              ? null
              : Math.min(100, Math.max(0, parseInt(overageDiscount, 10) || 0)),
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
    "h-10 w-full rounded-lg border border-rule bg-canvas/40 px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
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
        <div className="rounded-xl border border-rule bg-surface p-6">
          {formError && (
            <Callout tone="error" className="mb-5">
              {formError}
            </Callout>
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
                        selected ? "border-cobalt bg-cobalt-tint" : "border-rule bg-surface hover:border-rule-strong"
                      }`}
                    >
                      <span className="text-[0.8rem] font-semibold text-ink">{opt.label}</span>
                      <span className="text-[0.68rem] leading-snug text-ink-muted">{opt.helper}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom plan overrides (optional) — blank inherits the plan default */}
            <div className="rounded-lg border border-dashed border-rule p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Custom plan overrides
              </p>
              <p className="mt-1 text-[0.68rem] text-ink-muted">
                Optional negotiated commercials. Leave blank to inherit the {tier} plan
                — you can set these later on the org page.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="ovr-base-fee" className={labelClass}>
                    Base fee (ZAR/mo)
                  </label>
                  <input
                    id="ovr-base-fee"
                    type="number"
                    min={0}
                    step={500}
                    value={baseFee}
                    onChange={(e) => setBaseFee(e.target.value)}
                    placeholder="Plan default"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="ovr-credits" className={labelClass}>
                    Credits/mo
                  </label>
                  <input
                    id="ovr-credits"
                    type="number"
                    min={0}
                    step={1000}
                    value={includedCredits}
                    onChange={(e) => setIncludedCredits(e.target.value)}
                    placeholder="Plan default"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="ovr-overage" className={labelClass}>
                    Overage disc. (%)
                  </label>
                  <input
                    id="ovr-overage"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={overageDiscount}
                    onChange={(e) => setOverageDiscount(e.target.value)}
                    placeholder="Plan default"
                    className={`${inputClass} font-mono`}
                  />
                </div>
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

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-rule pt-5">
            <Link href="/operator" className={buttonVariants({ variant: "ghost" })}>
              Cancel
            </Link>
            <Button type="submit" disabled={!canSubmit} loading={saving}>
              Provision organisation
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
