"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { canManageOrg, useTenant } from "./tenant-provider";

// Inline brand picker for the campaign-creation flows (From Job Spec + the
// wizard's create step). The brand a campaign is created in IS the active-brand
// context (S8): the API derives it from the active_brand cookie and never
// accepts a client_id. So choosing here sets the active brand exactly as the
// header BrandSwitcher does — POST /api/admin/active-brand, then router.refresh()
// so the server re-resolves the cookie and RSC re-scopes.
//
// The win over "go pick a brand in the top bar": with a single accessible brand
// we default to it automatically, so the common one-brand org never dead-ends on
// "Choose a brand first". With several, it's a real picker.

const labelClass =
  "mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted";
const errorClass = "mt-1.5 text-xs text-red";

function Field({
  labelId,
  error,
  children,
}: {
  labelId: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label id={labelId} className={labelClass}>
        Brand
      </label>
      {children}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

/** @param error - external validation message (e.g. the wizard's "Select a
 *  brand" when Next is blocked); rendered under the control. */
export function BrandPicker({ error }: { error?: string } = {}) {
  const tenant = useTenant();
  const router = useRouter();
  const { brands, activeBrandId } = tenant;
  const labelId = useId();

  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Fire the single-brand auto-default once. A failed POST surfaces a retry
  // affordance instead of looping the effect.
  const autoDefaulted = useRef(false);

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  async function select(brandId: string) {
    // Return focus to the trigger before the menu unmounts, and clear any stale
    // failure even on a no-op re-select — both run regardless of the early return.
    if (open) triggerRef.current?.focus();
    setOpen(false);
    setFailed(false);
    if (brandId === activeBrandId) return;
    setPending(true);
    try {
      const res = await fetch("/api/admin/active-brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      // RSC re-reads the cookie; activeBrandId flips to brandId on the next
      // render. Client state (uploaded file, half-filled wizard) is preserved.
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  // Single accessible brand → make it active without the header detour. Runs
  // once; after refresh activeBrandId === brands[0].id so the guard holds. The
  // POST is deferred a microtask so we don't kick off state updates from inside
  // the effect's synchronous body.
  useEffect(() => {
    if (autoDefaulted.current) return;
    if (brands.length === 1 && activeBrandId !== brands[0].id) {
      autoDefaulted.current = true;
      const id = brands[0].id;
      queueMicrotask(() => void select(id));
    }
    // `select` is a stable closure over router; the inputs that matter are here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brands, activeBrandId]);

  // Dismiss the menu on outside-click / Escape (multi-brand dropdown only).
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ── No accessible brands ─────────────────────────────────────────
  if (brands.length === 0) {
    return (
      <Field labelId={labelId} error={error}>
        <div className="rounded-lg border border-dashed border-border bg-cream/40 p-4">
          <p className="text-sm font-medium text-charcoal">No brands yet</p>
          <p className="mt-1 text-xs text-txt-muted">
            {canManageOrg(tenant) ? (
              <>
                <Link href="/clients/new" className="text-accent hover:underline">
                  Add a brand
                </Link>{" "}
                before starting a campaign.
              </>
            ) : (
              "Ask an org admin to add you to a brand before starting a campaign."
            )}
          </p>
        </div>
      </Field>
    );
  }

  // ── Single brand: defaulted, shown as a settled selection ─────────
  if (brands.length === 1) {
    return (
      <Field labelId={labelId} error={error}>
        <div
          aria-labelledby={labelId}
          className="flex h-10 items-center justify-between rounded-lg border border-border bg-cream/40 px-3.5"
        >
          <span className="flex items-center gap-2 text-sm text-charcoal">
            <BrandDot />
            {brands[0].name}
          </span>
          {pending && <Spinner />}
        </div>
        {failed && (
          <p className={errorClass}>
            Couldn&apos;t set the brand.{" "}
            <button
              type="button"
              onClick={() => select(brands[0].id)}
              disabled={pending}
              className="font-medium underline cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Try again
            </button>
          </p>
        )}
      </Field>
    );
  }

  // ── Several brands: a real picker ─────────────────────────────────
  return (
    <Field labelId={labelId} error={error}>
      <div ref={ref} className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={labelId}
          className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-cream/40 px-3.5 text-left transition-colors hover:border-border-strong disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
        >
          {activeBrand ? (
            <span className="flex items-center gap-2 text-sm text-charcoal">
              <BrandDot />
              <span className="truncate">{activeBrand.name}</span>
            </span>
          ) : (
            <span className="text-sm text-txt-muted">Select a brand…</span>
          )}
          {pending ? (
            <Spinner />
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-txt-muted transition-transform ${open ? "rotate-180" : ""}`}
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          )}
        </button>

        {open && (
          <div
            role="listbox"
            aria-labelledby={labelId}
            className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-[0_8px_30px_-8px_rgba(17,18,60,0.25)]"
          >
            {brands.map((b) => {
              const selected = b.id === activeBrandId;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => select(b.id)}
                  className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-cream cursor-pointer ${
                    selected ? "text-accent" : "text-charcoal"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <BrandDot muted={!selected} />
                    <span className="truncate">{b.name}</span>
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
            })}
          </div>
        )}
      </div>
      {failed && (
        <p className={errorClass}>
          {activeBrand
            ? `Couldn't switch brands — ${activeBrand.name} is still selected. Try again.`
            : "Couldn't set the brand. Pick one to try again."}
        </p>
      )}
    </Field>
  );
}

function BrandDot({ muted = false }: { muted?: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
        muted ? "bg-txt-muted" : "bg-accent"
      }`}
      aria-hidden
    />
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 animate-spin text-txt-muted"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
