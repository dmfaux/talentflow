"use client";

import { useTenant } from "@/components/admin/tenant-provider";
import { Card, SectionHeading } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
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
    <Card className="mb-6">
      <SectionHeading
        className="mb-5"
        title="Active brand"
        icon={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="5.5" r="2.5" />
            <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
          </svg>
        }
      />

      {active ? (
        <div className="flex items-center justify-between rounded-lg bg-canvas/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink">{active.name}</p>
            <p className="text-[0.65rem] text-ink-muted">
              Editing presentation, careers page, and contact details
            </p>
          </div>
          <Link
            href={`/clients/${active.id}/edit`}
            className={buttonVariants({ variant: "secondary" })}
          >
            Manage brand &rarr;
          </Link>
        </div>
      ) : (
        <p className="rounded-lg bg-canvas/60 px-4 py-3 text-sm text-ink-soft">
          No single brand is active. Pick one from the brand switcher in the top
          bar to manage its settings, or visit{" "}
          <Link href="/clients" className="text-cobalt hover:underline">
            Brands
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
