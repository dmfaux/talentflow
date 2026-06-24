"use client";

import {
  ThemeBuilder,
  type OperatorThemeRow,
} from "@/components/operator/theme-builder";
import { ThemeEmailPreview } from "@/components/operator/theme-email-preview";
import { EmptyState } from "@/components/ui/empty-state";
import type { BrandColors, LogoInput } from "@/lib/prompt-builder";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

type BuilderState =
  | { open: false }
  | {
      open: true;
      scope: "gallery" | "custom";
      orgId?: string;
      clientId?: string;
      brandName?: string;
      /** The brand's configured kit (custom themes only), threaded to the builder
       *  so the bespoke landing/email AI prompts embed the real brand colours. */
      brandColors?: BrandColors | null;
      logo?: LogoInput | null;
      initial?: OperatorThemeRow;
    };

// The brand-kit feed for the active brand (colours + logo) backing the bespoke
// prompts. Loaded once per brand from the brand row; null until resolved. Tagged
// with the brand it belongs to so a stale kit from a previous brand is ignored.
interface BrandKit {
  clientId: string;
  brandColors: BrandColors | null;
  logo: LogoInput | null;
}

function previewPayload(row: OperatorThemeRow) {
  return {
    palette: row.palette,
    font_display: row.font_display,
    font_sans: row.font_sans,
    logo_url: row.logo_url,
    logo_background: row.logo_background,
    logo_position: row.logo_position,
    show_powered_by: row.show_powered_by,
  };
}

function ThemeCard({
  row,
  onEdit,
}: {
  row: OperatorThemeRow;
  onEdit: () => void;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong">
      <div className="flex justify-center border-b border-border bg-canvas/60 p-4">
        <div
          className="overflow-hidden rounded-lg border border-border shadow-sm"
          style={{ width: 267 }}
        >
          {row.preview_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.preview_image_url}
              alt={`${row.name} preview`}
              style={{ width: 267, height: 168, objectFit: "cover", objectPosition: "top" }}
            />
          ) : (
            <ThemeEmailPreview
              payload={previewPayload(row)}
              contentWidth={580}
              scale={0.46}
              height={168}
            />
          )}
        </div>
      </div>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{row.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {row.scope === "gallery" ? (
              <span className="inline-flex items-center rounded-full bg-cobalt-tint px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-cobalt">
                Gallery
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-vermillion/10 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-vermillion">
                Bespoke
              </span>
            )}
            {!row.show_powered_by && (
              <span className="inline-flex items-center rounded-full bg-canvas-2 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                White-label
              </span>
            )}
            {row.scope === "custom" && row.client && (
              <span className="truncate font-mono text-[0.62rem] text-ink-muted">
                {row.client.slug}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[0.72rem] font-medium text-ink-soft transition-colors hover:bg-canvas cursor-pointer"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function ThemesConsole() {
  const params = useSearchParams();
  const orgId = params.get("org_id") ?? undefined;
  const clientId = params.get("client_id") ?? undefined;
  const brandName = params.get("brand") ?? undefined;
  const brandScoped = !!(orgId && clientId);

  const [themes, setThemes] = useState<OperatorThemeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [builder, setBuilder] = useState<BuilderState>({ open: false });
  // The active brand's configured kit (colours + logo) for the bespoke prompts.
  // Loaded once per brand; null when unavailable, in which case the builder falls
  // back to the theme's own palette/logo so the prompt still embeds real colours.
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (orgId) qs.set("org_id", orgId);
    if (clientId) qs.set("client_id", clientId);
    setLoading(true);
    fetch(`/api/operator/themes?${qs.toString()}`)
      .then((r) => r.json())
      .then((res) => setThemes(res.data ?? []))
      .catch(() => setThemes([]))
      .finally(() => setLoading(false));
  }, [orgId, clientId]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolve the brand's CORPORATE colours + logo for the bespoke AI prompt and
  // the new-theme seed defaults. Loaded from the brand record
  // (clients.brand_*_color + branding_logo_url) so a Premium brand's bespoke
  // landing + matching email use its REAL corporate identity; the builder falls
  // back to the theme's own seed palette only when the brand has no defined
  // colours. Tagged with its clientId so a stale kit from a previous brand is
  // ignored at read time (the effect only setState()s once the fetch resolves).
  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    fetch(`/api/operator/clients/${clientId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((res) => {
        const b = res.data;
        if (!b) {
          setBrandKit({ clientId, brandColors: null, logo: null });
          return;
        }
        // Only claim brand colours when a primary is actually set, so a brand
        // with no defined palette falls through to the theme's own seeds.
        const brandColors: BrandColors | null = b.brand_primary_color
          ? {
              primary: b.brand_primary_color,
              secondary: b.brand_secondary_color ?? "#f0f3f7",
              accent: b.brand_accent_color,
              text: b.brand_text_color ?? "#11123c",
            }
          : null;
        const logo: LogoInput | null = b.branding_logo_url
          ? {
              url: b.branding_logo_url,
              background: b.logo_background || "light",
              position: b.logo_position || "top-left",
            }
          : null;
        setBrandKit({ clientId, brandColors, logo });
      })
      .catch((err) => {
        if (err.name !== "AbortError") setBrandKit(null);
      });
    return () => controller.abort();
  }, [clientId]);

  // Only trust the kit when it belongs to the brand currently in scope.
  const activeKit = brandKit?.clientId === clientId ? brandKit : null;

  const gallery = themes.filter((t) => t.scope === "gallery");
  const bespoke = themes.filter(
    (t) => t.scope === "custom" && t.client_id === clientId
  );

  function closeBuilder(saved: boolean) {
    setBuilder({ open: false });
    if (saved) load();
  }

  if (builder.open) {
    return (
      <ThemeBuilder
        scope={builder.scope}
        orgId={builder.orgId}
        clientId={builder.clientId}
        brandName={builder.brandName}
        // Pass the brand kit LIVE (not the click-time snapshot) so a builder
        // opened before the async fetch resolved still receives the brand's
        // corporate colours once they load; the builder re-seeds reactively.
        brandColors={
          builder.scope === "custom"
            ? activeKit?.brandColors ?? builder.brandColors ?? null
            : null
        }
        logo={
          builder.scope === "custom"
            ? activeKit?.logo ?? builder.logo ?? null
            : null
        }
        initial={builder.initial}
        onDone={closeBuilder}
      />
    );
  }

  return (
    <div>
      {brandScoped && (
        <div className="mb-5 flex items-center gap-2 text-xs text-ink-muted">
          <Link href="/operator" className="hover:text-ink transition-colors">
            Organisations
          </Link>
          <span>/</span>
          <Link
            href={`/operator/orgs/${orgId}`}
            className="hover:text-ink transition-colors"
          >
            {brandName ?? "Organisation"}
          </Link>
          <span>/</span>
          <span className="text-ink-soft">Bespoke themes</span>
        </div>
      )}

      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-ink-muted">
            Control plane
          </p>
          <h1 className="mt-1 font-serif text-2xl text-ink">
            {brandScoped ? `${brandName ?? "Brand"} themes` : "Theme gallery"}
          </h1>
          <p className="mt-1 text-xs text-ink-muted">
            {brandScoped
              ? "The shared gallery plus this brand's bespoke, white-label themes."
              : "Shared themes every tenant can pick. Bespoke themes are built per brand from an organisation."}
          </p>
        </div>
      </div>

      {/* Gallery */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg text-ink">Gallery</h2>
          <button
            type="button"
            onClick={() => setBuilder({ open: true, scope: "gallery" })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cobalt px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-cobalt-deep cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            New gallery theme
          </button>
        </div>
        {loading ? (
          <div className="rounded-xl border border-border bg-surface py-16 text-center text-sm text-ink-muted">
            Loading themes…
          </div>
        ) : gallery.length === 0 ? (
          <EmptyState
            icon="campaigns"
            title="No gallery themes yet"
            description="Create a shared theme that every tenant can pick from."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((row) => (
              <ThemeCard
                key={row.id}
                row={row}
                onEdit={() =>
                  setBuilder({ open: true, scope: "gallery", initial: row })
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Bespoke (only when scoped to a brand) */}
      {brandScoped && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-lg text-ink">
              Bespoke for {brandName ?? "brand"}
            </h2>
            <button
              type="button"
              onClick={() =>
                setBuilder({
                  open: true,
                  scope: "custom",
                  orgId,
                  clientId,
                  brandName,
                  brandColors: activeKit?.brandColors ?? null,
                  logo: activeKit?.logo ?? null,
                })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cobalt bg-cobalt-tint px-4 text-[0.8rem] font-medium text-cobalt transition-colors hover:bg-cobalt-tint/70 cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M7 2v10M2 7h10" />
              </svg>
              New bespoke theme
            </button>
          </div>
          {loading ? null : bespoke.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-surface px-5 py-8 text-center text-sm text-ink-muted">
              No bespoke themes for this brand yet. Bespoke themes can be
              white-labelled (no TalentStream footer).
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bespoke.map((row) => (
                <ThemeCard
                  key={row.id}
                  row={row}
                  onEdit={() =>
                    setBuilder({
                      open: true,
                      scope: "custom",
                      orgId,
                      clientId,
                      brandName,
                      brandColors: activeKit?.brandColors ?? null,
                      logo: activeKit?.logo ?? null,
                      initial: row,
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function OperatorThemesPage() {
  return (
    <Suspense
      fallback={
        <div className="py-24 text-center text-sm text-ink-muted">Loading…</div>
      }
    >
      <ThemesConsole />
    </Suspense>
  );
}
