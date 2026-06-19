"use client";

import { useToast } from "@/components/ui/toast-provider";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface AvailableTheme {
  id: string;
  name: string;
  scope: "gallery" | "custom";
  client_id: string | null;
}

export interface ThemeBrand {
  id: string;
  name: string;
  slug: string;
  default_theme_id: string | null;
  default_theme_name: string | null;
  default_theme_scope: string | null;
}

// Themes card on the operator org-detail page (beside Plan & billing). For each
// brand: assign a default campaign theme (gallery, or — for Premium+ orgs — a
// bespoke theme) and jump to the bespoke builder. Bespoke is visibly gated for
// Standard orgs; the server is the real enforcement (assertThemeAssignable).
export function ThemesCard({
  orgId,
  tier,
  brands: initialBrands,
}: {
  orgId: string;
  tier: string;
  brands: ThemeBrand[];
}) {
  const { toast } = useToast();
  const premium = tier === "premium" || tier === "enterprise";

  const [brands, setBrands] = useState<ThemeBrand[]>(initialBrands);
  const [available, setAvailable] = useState<AvailableTheme[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  // The org's available themes: the global gallery + every brand's bespoke.
  useEffect(() => {
    fetch(`/api/operator/themes?org_id=${orgId}`)
      .then((r) => r.json())
      .then((res) =>
        setAvailable(
          (res.data ?? []).map((t: AvailableTheme) => ({
            id: t.id,
            name: t.name,
            scope: t.scope,
            client_id: t.client_id,
          }))
        )
      )
      .catch(() => setAvailable([]));
  }, [orgId]);

  const galleryThemes = useMemo(
    () => available.filter((t) => t.scope === "gallery"),
    [available]
  );

  function optionsForBrand(brandId: string): AvailableTheme[] {
    // Gallery is available to all; a brand's own bespoke only to that brand.
    return available.filter(
      (t) => t.scope === "gallery" || t.client_id === brandId
    );
  }

  async function assign(brandId: string, themeId: string | null) {
    setSavingId(brandId);
    try {
      const res = await fetch(
        `/api/operator/clients/${brandId}/default-theme`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme_id: themeId }),
        }
      );
      const { error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not set the default theme", "error");
        return;
      }
      const picked = themeId
        ? available.find((t) => t.id === themeId)
        : undefined;
      setBrands((prev) =>
        prev.map((b) =>
          b.id === brandId
            ? {
                ...b,
                default_theme_id: themeId,
                default_theme_name: picked?.name ?? null,
                default_theme_scope: picked?.scope ?? null,
              }
            : b
        )
      );
      toast(themeId ? "Default theme set" : "Reverted to gallery default", "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-ink">Themes</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            The default campaign-email look per brand. Bespoke, white-label themes
            require Premium+.
          </p>
        </div>
        <Link
          href="/operator/themes"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:bg-canvas"
        >
          Gallery
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11L11 3M5 3h6v6" />
          </svg>
        </Link>
      </div>

      {!premium && (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-cream/40 px-3.5 py-2.5 text-[0.78rem] text-ink-muted">
          This organization is on{" "}
          <span className="font-medium capitalize text-ink-soft">{tier}</span>.
          Brands can pick gallery themes; bespoke white-label themes unlock on
          Premium or Enterprise.
        </p>
      )}

      <div className="mt-4 space-y-2.5">
        {brands.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
            No brands in this organization yet.
          </p>
        ) : (
          brands.map((brand) => {
            const opts = optionsForBrand(brand.id);
            const busy = savingId === brand.id;
            return (
              <div
                key={brand.id}
                className="rounded-lg border border-border bg-cream/30 p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {brand.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.68rem] text-ink-muted">
                      {brand.default_theme_id
                        ? `${brand.default_theme_name ?? "Theme"}${brand.default_theme_scope === "custom" ? " · bespoke" : ""}`
                        : "Gallery default (inherited)"}
                    </p>
                  </div>
                  <Link
                    href={`/operator/themes?org_id=${orgId}&client_id=${brand.id}&brand=${encodeURIComponent(brand.name)}`}
                    aria-disabled={!premium}
                    tabIndex={premium ? 0 : -1}
                    onClick={(e) => {
                      if (!premium) e.preventDefault();
                    }}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[0.72rem] font-medium transition-colors ${
                      premium
                        ? "border-border text-ink-soft hover:bg-canvas"
                        : "cursor-not-allowed border-border/60 text-ink-faint"
                    }`}
                    title={
                      premium
                        ? "Manage bespoke themes"
                        : "Bespoke themes require Premium or Enterprise"
                    }
                  >
                    Bespoke
                  </Link>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Default theme
                  </label>
                  <select
                    value={brand.default_theme_id ?? ""}
                    disabled={busy}
                    onChange={(e) => assign(brand.id, e.target.value || null)}
                    className="h-9 w-full cursor-pointer rounded-lg border border-border bg-paper px-3 text-sm text-ink-soft outline-none focus:border-cobalt disabled:opacity-50"
                  >
                    <option value="">Gallery default (inherit)</option>
                    {opts.length > 0 && (
                      <optgroup label="Available">
                        {opts.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.scope === "custom" ? " (bespoke)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
            );
          })
        )}
        {galleryThemes.length === 0 && brands.length > 0 && (
          <p className="text-[0.72rem] text-ink-muted">
            No gallery themes exist yet —{" "}
            <Link href="/operator/themes" className="text-cobalt hover:underline">
              create one
            </Link>{" "}
            for brands to inherit.
          </p>
        )}
      </div>
    </div>
  );
}
