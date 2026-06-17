"use client";

import { useTenant } from "@/components/admin/tenant-provider";
import Link from "next/link";

// Active-brand settings shortcut (S9). Reads the S8 tenant context (the
// BrandSwitcher's selection + the caller's accessible brands) and deep-links to
// brand management. Cosmetic only — brand editing is server-gated.
export function ActiveBrandCard() {
  const { activeBrandId, brands } = useTenant();

  if (brands.length === 0) return null;

  const active = activeBrandId
    ? brands.find((b) => b.id === activeBrandId) ?? null
    : null;

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-6">
      <div className="mb-5 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1b4332" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
        </svg>
        <h2 className="text-sm font-semibold text-charcoal">Active Brand</h2>
      </div>

      {active ? (
        <div className="flex items-center justify-between rounded-lg bg-cream/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-charcoal">{active.name}</p>
            <p className="text-[0.65rem] text-txt-muted">
              Editing presentation, careers page, and contact details
            </p>
          </div>
          <Link
            href={`/clients/${active.id}/edit`}
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
          >
            Manage brand &rarr;
          </Link>
        </div>
      ) : (
        <p className="rounded-lg bg-cream/60 px-4 py-3 text-sm text-txt-secondary">
          No single brand is active. Pick one from the brand switcher in the top
          bar to manage its settings, or visit{" "}
          <Link href="/clients" className="text-accent hover:underline">
            Brands
          </Link>
          .
        </p>
      )}
    </div>
  );
}
