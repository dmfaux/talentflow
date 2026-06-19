// ── Shared theme card (CT3) ──────────────────────────────────────────
// A selectable theme tile used by both the campaign wizard's theme picker and
// the brand-settings default selector. Pure presentational; selection state and
// availability (tier-locking) are decided by the caller. Admin palette.

/** The card fields GET /api/admin/themes returns. */
export interface Theme {
  id: string;
  name: string;
  scope: "gallery" | "custom";
  preview_image_url: string | null;
  show_powered_by: boolean;
  /** The theme's landing-page default (CT4); null when the theme provides none. */
  landing_html: string | null;
}

export const themeBadgeClass =
  "inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-accent-light";

export function ThemeCard({
  selected,
  disabled,
  onClick,
  title,
  subtitle,
  badge,
  previewImageUrl,
  hint,
  inherit,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  badge?: string;
  previewImageUrl?: string | null;
  hint?: string;
  inherit?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all ${
        selected
          ? "border-accent ring-2 ring-accent/25"
          : "border-border hover:border-txt-muted"
      } ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-cream/60">
        {previewImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center ${
              inherit
                ? "bg-[repeating-linear-gradient(135deg,transparent,transparent_9px,rgba(17,18,60,0.04)_9px,rgba(17,18,60,0.04)_10px)]"
                : ""
            }`}
          >
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-txt-muted"
            >
              <rect x="2.5" y="5" width="19" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
        )}
        {selected && (
          <span className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow-sm">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.2L5 8.5l4.5-5" />
            </svg>
          </span>
        )}
      </div>
      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[0.82rem] font-medium text-charcoal">{title}</p>
          <p className="mt-0.5 text-[0.63rem] uppercase tracking-[0.1em] text-txt-muted">
            {subtitle}
          </p>
          {hint && <p className="mt-1 text-[0.65rem] text-txt-muted">{hint}</p>}
        </div>
        {badge && <span className={themeBadgeClass}>{badge}</span>}
      </div>
    </button>
  );
}
