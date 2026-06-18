"use client";

import Link from "next/link";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";

// The "nudge" half of the skippable onboarding (Resolved Decision: auto-redirect
// to /onboarding, but allow "I'll do this later"). When an org has no brands yet,
// every admin page carries this strap so the manager is gently, persistently
// reminded to finish — cosmetic only; the real gate is the empty workspace.
export function NoBrandBanner() {
  const tenant = useTenant();

  // Only org managers can create a brand, and only when none exist yet. A plain
  // member with no brand access is a different (admin-resolved) situation.
  if (!canManageOrg(tenant) || tenant.brands.length > 0) return null;

  return (
    <div className="border-b border-cobalt/15 bg-cobalt-tint/60">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-2.5">
        <p className="flex items-center gap-2.5 text-[0.82rem] text-ink">
          <span className="pulse-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt" />
          <span>
            <span className="font-semibold">Finish setting up.</span> Add your
            first brand to start running campaigns.
          </span>
        </p>
        <Link
          href="/onboarding"
          className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[0.78rem] font-medium text-canvas transition-colors hover:bg-cobalt"
        >
          Add your brand
          <svg
            className="arrow-slide"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
