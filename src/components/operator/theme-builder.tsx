"use client";

import { useToast } from "@/components/ui/toast-provider";
import { validateHtmlTemplate } from "@/lib/slots";
import {
  STARTER_THEME_DRAFT,
  THEME_PALETTE_KEYS,
  type ThemePaletteKey,
  type ThemeScope,
} from "@/lib/theme-fields";
import { useMemo, useState } from "react";
import {
  ThemeEmailPreview,
  type ThemePreviewPayload,
} from "./theme-email-preview";

// ── The saved theme row shape (subset returned by the operator routes) ──
export interface OperatorThemeRow {
  id: string;
  org_id: string | null;
  client_id: string | null;
  name: string;
  scope: ThemeScope;
  palette: Record<string, string>;
  font_display: string;
  font_sans: string;
  logo_url: string | null;
  logo_background: string;
  logo_position: string;
  show_powered_by: boolean;
  landing_html: string | null;
  preview_image_url: string | null;
  client?: { id: string; name: string; slug: string } | null;
  organization?: { id: string; name: string; slug: string } | null;
}

// Friendly labels + grouping for the 11 palette tokens.
const PALETTE_GROUPS: { label: string; keys: ThemePaletteKey[] }[] = [
  { label: "Surfaces", keys: ["bg", "card", "border"] },
  { label: "Brand", keys: ["primary", "primaryDeep", "primaryTint", "accent"] },
  { label: "Text", keys: ["ink", "inkSoft", "inkMuted", "inkFaint"] },
];

const PALETTE_LABELS: Record<ThemePaletteKey, string> = {
  bg: "Page background",
  card: "Card surface",
  border: "Border",
  primary: "Primary",
  primaryDeep: "Primary · deep",
  primaryTint: "Primary · tint",
  accent: "Accent",
  ink: "Ink · headings",
  inkSoft: "Ink · body",
  inkMuted: "Ink · muted",
  inkFaint: "Ink · faint",
};

const FONT_DISPLAY_PRESETS: { label: string; value: string }[] = [
  { label: "TalentStream Serif", value: STARTER_THEME_DRAFT.font_display },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Palatino", value: "'Palatino Linotype', Palatino, Georgia, serif" },
  { label: "Helvetica (sans)", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
];

const FONT_SANS_PRESETS: { label: string; value: string }[] = [
  { label: "TalentStream Sans", value: STARTER_THEME_DRAFT.font_sans },
  { label: "System", value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { label: "Helvetica", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Georgia (serif)", value: "Georgia, 'Times New Roman', serif" },
];

const LOGO_BACKGROUNDS = ["light", "dark", "transparent"] as const;
const LOGO_POSITIONS = ["top-left", "top-centre"] as const;

const labelClass =
  "mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";
const inputClass =
  "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
const selectClass =
  "h-10 w-full cursor-pointer rounded-lg border border-border bg-cream/40 px-3 text-sm text-ink-soft outline-none focus:border-cobalt";

/** Expand 3-digit hex to 6 so <input type="color"> can display it. */
function to6(hex: string): string {
  const v = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  }
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : "#000000";
}

export function ThemeBuilder({
  scope,
  orgId,
  clientId,
  brandName,
  initial,
  onDone,
}: {
  scope: ThemeScope;
  orgId?: string;
  clientId?: string;
  brandName?: string;
  initial?: OperatorThemeRow;
  onDone: (saved: boolean) => void;
}) {
  const { toast } = useToast();
  const isGallery = scope === "gallery";
  const editing = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [palette, setPalette] = useState<Record<ThemePaletteKey, string>>(() => {
    const seed = (initial?.palette ?? STARTER_THEME_DRAFT.palette) as Record<string, string>;
    return Object.fromEntries(
      THEME_PALETTE_KEYS.map((k) => [k, seed[k] ?? STARTER_THEME_DRAFT.palette[k]])
    ) as Record<ThemePaletteKey, string>;
  });
  const [fontDisplay, setFontDisplay] = useState(
    initial?.font_display ?? STARTER_THEME_DRAFT.font_display
  );
  const [fontSans, setFontSans] = useState(
    initial?.font_sans ?? STARTER_THEME_DRAFT.font_sans
  );
  const [logoUrl, setLogoUrl] = useState(initial?.logo_url ?? "");
  const [logoBackground, setLogoBackground] = useState(
    initial?.logo_background ?? "light"
  );
  const [logoPosition, setLogoPosition] = useState(
    initial?.logo_position ?? "top-left"
  );
  // Gallery is forced powered-by=true (D-4); white-label is bespoke-only.
  const [showPoweredBy, setShowPoweredBy] = useState(
    isGallery ? true : initial?.show_powered_by ?? true
  );
  const [landingHtml, setLandingHtml] = useState(initial?.landing_html ?? "");
  const [previewImageUrl, setPreviewImageUrl] = useState(
    initial?.preview_image_url ?? ""
  );
  const [saving, setSaving] = useState(false);

  const landingValidation = useMemo(() => {
    if (!landingHtml.trim()) return null;
    return validateHtmlTemplate(landingHtml);
  }, [landingHtml]);

  const previewPayload: ThemePreviewPayload = {
    palette,
    font_display: fontDisplay,
    font_sans: fontSans,
    logo_url: logoUrl.trim() || null,
    logo_background: logoBackground,
    logo_position: logoPosition,
    show_powered_by: isGallery ? true : showPoweredBy,
  };

  function setColor(key: ThemePaletteKey, value: string) {
    setPalette((p) => ({ ...p, [key]: value }));
  }

  // Ensure preset selects always include the current (possibly custom) value.
  const displayOptions = FONT_DISPLAY_PRESETS.some((o) => o.value === fontDisplay)
    ? FONT_DISPLAY_PRESETS
    : [{ label: "Current", value: fontDisplay }, ...FONT_DISPLAY_PRESETS];
  const sansOptions = FONT_SANS_PRESETS.some((o) => o.value === fontSans)
    ? FONT_SANS_PRESETS
    : [{ label: "Current", value: fontSans }, ...FONT_SANS_PRESETS];

  async function save() {
    if (!name.trim()) {
      toast("Give the theme a name", "error");
      return;
    }
    if (landingHtml.trim() && landingValidation && !landingValidation.ok) {
      toast("Fix the landing HTML before saving", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        scope,
        ...(isGallery ? {} : { org_id: orgId, client_id: clientId }),
        palette,
        font_display: fontDisplay,
        font_sans: fontSans,
        logo_url: logoUrl.trim() || null,
        logo_background: logoBackground,
        logo_position: logoPosition,
        show_powered_by: isGallery ? true : showPoweredBy,
        landing_html: landingHtml.trim() ? landingHtml : null,
        preview_image_url: previewImageUrl.trim() || null,
      };
      const res = await fetch(
        editing ? `/api/operator/themes/${initial!.id}` : "/api/operator/themes",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const { error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not save the theme", "error");
        return;
      }
      toast(editing ? "Theme updated" : "Theme created", "success");
      onDone(true);
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Builder header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-ink-muted">
            {editing ? "Edit theme" : "New theme"}
          </p>
          <h2 className="mt-1 font-serif text-xl text-ink">
            {isGallery ? "Gallery theme" : `Bespoke theme`}
          </h2>
          {!isGallery && (
            <p className="mt-0.5 text-xs text-ink-muted">
              for <span className="font-medium text-ink-soft">{brandName ?? "brand"}</span>
              {" · "}white-label available
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDone(false)}
          className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[0.8rem] font-medium text-ink-soft transition-colors hover:bg-canvas cursor-pointer"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* ── Form column ─────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Identity */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <label htmlFor="theme_name" className={labelClass}>
              Theme name
            </label>
            <input
              id="theme_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isGallery ? "e.g. Aurora" : `${brandName ?? "Brand"} — Primary`}
              className={inputClass}
            />
            <div className="mt-4">
              <label htmlFor="preview_image_url" className={labelClass}>
                Card thumbnail URL{" "}
                <span className="font-sans normal-case tracking-normal text-ink-faint">
                  optional
                </span>
              </label>
              <input
                id="preview_image_url"
                value={previewImageUrl}
                onChange={(e) => setPreviewImageUrl(e.target.value)}
                placeholder="Defaults to a live render of the email"
                spellCheck={false}
                className={`${inputClass} font-mono text-xs`}
              />
            </div>
          </section>

          {/* Palette */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="font-serif text-base text-ink">Palette</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              The 11 colour tokens the email kit renders from.
            </p>
            <div className="mt-4 space-y-5">
              {PALETTE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                    {group.label}
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {group.keys.map((key) => (
                      <div
                        key={key}
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-cream/40 px-2.5 py-2"
                      >
                        <label
                          className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border"
                          style={{ backgroundColor: palette[key] }}
                        >
                          <input
                            type="color"
                            value={to6(palette[key])}
                            onChange={(e) => setColor(key, e.target.value)}
                            className="absolute -inset-2 cursor-pointer opacity-0"
                            aria-label={PALETTE_LABELS[key]}
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.7rem] font-medium text-ink-soft">
                            {PALETTE_LABELS[key]}
                          </p>
                          <input
                            value={palette[key]}
                            onChange={(e) => setColor(key, e.target.value)}
                            spellCheck={false}
                            className="w-full bg-transparent font-mono text-[0.72rem] text-ink-muted outline-none focus:text-ink"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Typography */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="font-serif text-base text-ink">Typography</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Display font</label>
                <select
                  value={fontDisplay}
                  onChange={(e) => setFontDisplay(e.target.value)}
                  className={selectClass}
                >
                  {displayOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Body font</label>
                <select
                  value={fontSans}
                  onChange={(e) => setFontSans(e.target.value)}
                  className={selectClass}
                >
                  {sansOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Logo */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="font-serif text-base text-ink">Logo</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              {isGallery
                ? "Leave the URL blank so each brand's own logo is adopted at send time."
                : "A bespoke logo URL, or blank to adopt the brand's configured logo."}
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="logo_url" className={labelClass}>
                  Logo URL
                </label>
                <input
                  id="logo_url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://cdn.example.com/logo.png"
                  spellCheck={false}
                  className={`${inputClass} font-mono text-xs`}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Logo background</label>
                  <select
                    value={logoBackground}
                    onChange={(e) => setLogoBackground(e.target.value)}
                    className={`${selectClass} capitalize`}
                  >
                    {LOGO_BACKGROUNDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Logo position</label>
                  <select
                    value={logoPosition}
                    onChange={(e) => setLogoPosition(e.target.value)}
                    className={selectClass}
                  >
                    {LOGO_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {p.replace("-", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Footer / white-label */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-serif text-base text-ink">Powered-by footer</h3>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {isGallery
                    ? "Gallery themes always carry the TalentStream footer."
                    : "Turn off for a fully white-labelled email."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showPoweredBy}
                disabled={isGallery}
                onClick={() => setShowPoweredBy((v) => !v)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
                  showPoweredBy ? "bg-cobalt" : "bg-border-strong"
                } ${isGallery ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    showPoweredBy ? "translate-x-[1.375rem]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Landing HTML (CT4) */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="font-serif text-base text-ink">
              Landing template{" "}
              <span className="font-sans text-xs font-normal text-ink-muted">
                optional
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              Must contain{" "}
              <code className="rounded bg-canvas-2 px-1 font-mono text-[0.7rem] text-ink-soft">
                &lt;div id=&quot;application-form&quot;&gt;&lt;/div&gt;
              </code>{" "}
              and no scripts.
            </p>
            <textarea
              value={landingHtml}
              onChange={(e) => setLandingHtml(e.target.value)}
              rows={6}
              placeholder="Paste a landing-page HTML template…"
              spellCheck={false}
              className={`mt-3 w-full resize-none rounded-lg border bg-cream/40 px-3.5 py-2.5 font-mono text-xs text-ink outline-none transition-colors focus:ring-1 focus:ring-cobalt/20 ${
                landingValidation && !landingValidation.ok
                  ? "border-red focus:border-red"
                  : landingValidation?.ok
                    ? "border-green focus:border-green"
                    : "border-border focus:border-cobalt"
              }`}
            />
            {landingValidation?.ok && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-green">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.5L5 9l4.5-6" />
                </svg>
                Valid landing template
              </p>
            )}
            {landingValidation && !landingValidation.ok && (
              <div className="mt-1.5 space-y-0.5">
                {landingValidation.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red">
                    {err}
                  </p>
                ))}
              </div>
            )}
          </section>

          {/* Save bar */}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onDone(false)}
              className="inline-flex h-10 items-center rounded-lg border border-border px-5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-cobalt px-6 text-sm font-medium text-white transition-colors hover:bg-cobalt-deep disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {saving && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {editing ? "Save changes" : "Create theme"}
            </button>
          </div>
        </div>

        {/* ── Live preview column (sticky) ────────────────────── */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Live email preview
              </p>
              <span className="rounded-full bg-canvas-2 px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-ink-muted">
                Application received
              </span>
            </div>
            <ThemeEmailPreview payload={previewPayload} height={560} />
            <p className="mt-2.5 text-[0.68rem] leading-relaxed text-ink-muted">
              Rendered through the real send-path template with sample data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
