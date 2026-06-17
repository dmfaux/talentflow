"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canManageOrg, useTenant } from "./tenant-provider";

// The header brand context + switcher (S8). Lists the caller's brands and — for
// owner/org_admin/acting-operator — an "All brands" entry. Selecting one POSTs
// to /api/admin/active-brand (validated server-side) then refreshes so RSC
// reads re-scope. A plain single-brand member gets a static label, no menu.

export function BrandSwitcher() {
  const tenant = useTenant();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const showAll = canManageOrg(tenant);
  const { brands, activeBrandId, orgName } = tenant;
  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;
  const activeLabel = activeBrand ? activeBrand.name : "All brands";

  // A plain member with exactly one brand and no "All" option has nothing to
  // switch — render a static label.
  const staticOnly = !showAll && brands.length <= 1;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function select(brandId: string | null) {
    setOpen(false);
    if (brandId === activeBrandId) return;
    setPending(true);
    try {
      await fetch("/api/admin/active-brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: brandId ?? "all" }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      {orgName && (
        <>
          <span className="hidden max-w-[12rem] truncate text-[0.78rem] font-medium text-ink/70 sm:inline">
            {orgName}
          </span>
          <span className="hidden h-4 w-px bg-rule sm:inline" aria-hidden />
        </>
      )}

      {staticOnly ? (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-canvas px-2.5 py-1.5 text-[0.78rem] font-medium text-ink">
          <BrandDot />
          {activeLabel}
        </span>
      ) : (
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={pending}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-canvas px-2.5 py-1.5 text-[0.78rem] font-medium text-ink transition-colors hover:border-rule-strong hover:bg-paper disabled:opacity-60 cursor-pointer"
          >
            <BrandDot active={!!activeBrand} />
            <span className="max-w-[10rem] truncate">{activeLabel}</span>
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-ink/40 transition-transform ${open ? "rotate-180" : ""}`}
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>

          {open && (
            <div
              role="listbox"
              className="absolute right-0 z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-rule bg-paper py-1 shadow-[0_8px_30px_-8px_rgba(17,18,60,0.25)]"
            >
              <p className="px-3 pb-1.5 pt-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Active brand
              </p>
              {showAll && (
                <BrandOption
                  label="All brands"
                  hint="Every brand in the org"
                  selected={!activeBrandId}
                  onClick={() => select(null)}
                />
              )}
              {brands.map((b) => (
                <BrandOption
                  key={b.id}
                  label={b.name}
                  selected={b.id === activeBrandId}
                  onClick={() => select(b.id)}
                />
              ))}
              {brands.length === 0 && (
                <p className="px-3 py-2 text-xs text-ink-muted">
                  No brands yet.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BrandDot({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${
        active ? "bg-cobalt" : "bg-vermillion"
      }`}
      aria-hidden
    />
  );
}

function BrandOption({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[0.8rem] transition-colors hover:bg-canvas cursor-pointer ${
        selected ? "text-cobalt" : "text-ink"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{label}</span>
        {hint && <span className="block text-[0.65rem] text-ink-muted">{hint}</span>}
      </span>
      {selected && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M3 8.5L6.5 12L13 4" />
        </svg>
      )}
    </button>
  );
}
