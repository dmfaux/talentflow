"use client";

import { useToast } from "@/components/ui/toast-provider";
import type { EmailTemplateMap } from "@/lib/email-slots";
import {
  buildTemplatePrompt,
  type BrandColors,
  type LogoInput,
} from "@/lib/prompt-builder";
import { validateHtmlTemplate } from "@/lib/slots";
import {
  derivePalette,
  type DerivedPalette,
  type ThemeSeeds,
} from "@/lib/theme-colors";
import {
  DEFAULT_EMAIL_COPY,
  DEFAULT_LANDING_COPY,
  type EmailCopyShared,
  type LandingCopy,
} from "@/lib/theme-copy";
import {
  BODY_FONTS,
  DISPLAY_FONTS,
  resolveBodyFont,
  resolveDisplayFont,
} from "@/lib/theme-fonts";
import {
  STARTER_THEME_DRAFT,
  type ThemePaletteKey,
  type ThemeScope,
} from "@/lib/theme-fields";
import { useMemo, useState } from "react";
import {
  ThemeBespokeEmails,
  type PerTypeCopyMap,
} from "./theme-bespoke-emails";
import { ThemeBespokePreview } from "./theme-bespoke-preview";
import {
  ThemeEmailPreview,
  type ThemePreviewPayload,
} from "./theme-email-preview";
import { ThemeLandingPreview } from "./theme-landing-preview";

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
  // CT7 authoring inputs (nullable — legacy rows authored before seed/key
  // authoring carry only the resolved palette/stacks). When present the builder
  // re-seeds the 3 pickers + 2 font dropdowns + copy editors from them.
  seed_primary?: string | null;
  seed_accent?: string | null;
  seed_bg?: string | null;
  font_display_key?: string | null;
  font_body_key?: string | null;
  landing_copy?: LandingCopy | null;
  email_copy?: EmailCopy | null;
  logo_url: string | null;
  logo_background: string;
  logo_position: string;
  show_powered_by: boolean;
  // Bespoke landing override (CT6): a custom theme may carry a hand-authored
  // landing page that supersedes the palette-generated one (resolveEffectiveLanding
  // precedence). Null = fall back to the generated landing. Custom-scope only.
  landing_html: string | null;
  // Bespoke per-template email overrides (CT6): a sparse map keyed by email
  // template type. Custom-scope only; gallery themes stay recolour-only.
  email_templates: EmailTemplateMap | null;
  preview_image_url: string | null;
  client?: { id: string; name: string; slug: string } | null;
  organization?: { id: string; name: string; slug: string } | null;
}

// Structured email copy as the row carries it (shared block + sparse per-type).
interface EmailCopy {
  shared: EmailCopyShared;
  perType: PerTypeCopyMap;
}

// The 3 seed colours an operator picks; the renderers derive the 11 tokens.
const SEED_FIELDS: { key: keyof ThemeSeeds; label: string; hint: string }[] = [
  { key: "primary", label: "Primary", hint: "Buttons, links, headings" },
  { key: "accent", label: "Accent", hint: "Highlights, secondary marks" },
  { key: "bg", label: "Background", hint: "Page canvas behind the card" },
];

// Friendly labels + authoring order for the 11 DERIVED tokens (read-only strip).
const DERIVED_GROUPS: { label: string; keys: ThemePaletteKey[] }[] = [
  { label: "Surfaces", keys: ["bg", "card", "border"] },
  { label: "Brand", keys: ["primary", "primaryDeep", "primaryTint", "accent"] },
  { label: "Text", keys: ["ink", "inkSoft", "inkMuted", "inkFaint"] },
];

const DERIVED_LABELS: Record<ThemePaletteKey, string> = {
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

const LOGO_BACKGROUNDS = ["light", "dark", "transparent"] as const;
const LOGO_POSITIONS = ["top-left", "top-centre"] as const;

const MAX_HIGHLIGHTS = 6;

// ── Section navigation (the left-rail "theme outline") ──────────────
// The form is split into a short core path (every theme needs it) and an
// opt-in advanced group (bespoke landing/emails, custom-scope only). The rail
// navigates between panels so an operator only ever sees the depth they want.
type BuilderSection =
  | "basics"
  | "colour"
  | "type"
  | "words"
  | "bespoke-landing"
  | "bespoke-emails";
type PreviewSurface = "email" | "landing";
type WordsTab = "landing" | "emails";

const CORE_SECTIONS: { key: BuilderSection; label: string }[] = [
  { key: "basics", label: "Basics" },
  { key: "colour", label: "Colour" },
  { key: "type", label: "Type" },
  { key: "words", label: "Words" },
];
const ADVANCED_SECTIONS: { key: BuilderSection; label: string }[] = [
  { key: "bespoke-landing", label: "Bespoke landing" },
  { key: "bespoke-emails", label: "Bespoke emails" },
];

// The surface the live preview snaps to when a section opens (a manual switcher
// can still override it). Type/Words/landing lean landing; the rest lean email.
const SECTION_SURFACE: Record<BuilderSection, PreviewSurface> = {
  basics: "email",
  colour: "email",
  type: "landing",
  words: "landing",
  "bespoke-landing": "landing",
  "bespoke-emails": "email",
};

const labelClass =
  "mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";
const inputClass =
  "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
const textareaClass =
  "w-full resize-none rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
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

/**
 * Map the theme's derived palette onto the prompt builders' BrandColors shape.
 * The bespoke prompt embeds these as "use these exact colours", so the generated
 * landing/email matches the theme being authored. Used when the page can't supply
 * the brand's configured colours; the threaded brandColors prop takes precedence.
 */
function paletteToBrandColors(palette: DerivedPalette): BrandColors {
  return {
    primary: palette.primary,
    secondary: palette.bg,
    accent: palette.accent,
    text: palette.ink,
  };
}

export function ThemeBuilder({
  scope,
  orgId,
  clientId,
  brandName,
  brandColors,
  logo,
  initial,
  onDone,
}: {
  scope: ThemeScope;
  orgId?: string;
  clientId?: string;
  brandName?: string;
  /** The brand's configured colours (custom themes only); threaded from the page.
   *  Absent for gallery themes — the bespoke sections are then hidden anyway. */
  brandColors?: BrandColors | null;
  /** The brand's configured logo (custom themes only); threaded from the page. */
  logo?: LogoInput | null;
  initial?: OperatorThemeRow;
  onDone: (saved: boolean) => void;
}) {
  const { toast } = useToast();
  const isGallery = scope === "gallery";
  const editing = !!initial;

  const [name, setName] = useState(initial?.name ?? "");

  // ── Seeds (CT7): 3 colours the palette is derived from ──
  const [seeds, setSeeds] = useState<ThemeSeeds>(() => ({
    primary: initial?.seed_primary ?? STARTER_THEME_DRAFT.seeds.primary,
    accent: initial?.seed_accent ?? STARTER_THEME_DRAFT.seeds.accent,
    bg: initial?.seed_bg ?? STARTER_THEME_DRAFT.seeds.bg,
  }));
  // The 11 derived tokens — recomputed live as seeds change; shown read-only.
  const palette = useMemo(() => derivePalette(seeds), [seeds]);

  // ── Fonts (CT7): registry keys, not raw stacks ──
  const [fontDisplayKey, setFontDisplayKey] = useState(
    () => resolveDisplayFont(initial?.font_display_key).key
  );
  const [fontBodyKey, setFontBodyKey] = useState(
    () => resolveBodyFont(initial?.font_body_key).key
  );
  const displayFont = resolveDisplayFont(fontDisplayKey);
  const bodyFont = resolveBodyFont(fontBodyKey);

  // ── Landing copy (CT7) ──
  const [landingCopy, setLandingCopy] = useState<LandingCopy>(() => ({
    headline: initial?.landing_copy?.headline ?? DEFAULT_LANDING_COPY.headline,
    intro: initial?.landing_copy?.intro ?? DEFAULT_LANDING_COPY.intro,
    highlights: initial?.landing_copy?.highlights
      ? [...initial.landing_copy.highlights]
      : [...DEFAULT_LANDING_COPY.highlights],
    applyHeading:
      initial?.landing_copy?.applyHeading ?? DEFAULT_LANDING_COPY.applyHeading,
  }));

  // ── Email copy (CT7): shared block + sparse per-type {subject, body} ──
  const [emailShared, setEmailShared] = useState<EmailCopyShared>(() => ({
    greeting:
      initial?.email_copy?.shared?.greeting ??
      DEFAULT_EMAIL_COPY.shared.greeting,
    signOff:
      initial?.email_copy?.shared?.signOff ?? DEFAULT_EMAIL_COPY.shared.signOff,
    footer:
      initial?.email_copy?.shared?.footer ?? DEFAULT_EMAIL_COPY.shared.footer,
  }));
  const [emailPerType, setEmailPerType] = useState<PerTypeCopyMap>(
    () => initial?.email_copy?.perType ?? {}
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
  const [previewImageUrl, setPreviewImageUrl] = useState(
    initial?.preview_image_url ?? ""
  );
  // Bespoke landing override (CT6, custom-only).
  const [landingHtml, setLandingHtml] = useState(initial?.landing_html ?? "");
  const [landingBrief, setLandingBrief] = useState("");
  const [landingCopied, setLandingCopied] = useState(false);
  // Bespoke per-template email overrides (CT6, custom-only) — a sparse map.
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateMap>(
    () => initial?.email_templates ?? {}
  );
  const [saving, setSaving] = useState(false);

  // ── Section navigation + preview surface (redesign shell) ──
  // The rail drives which panel shows; the preview follows the open section
  // unless the operator flips the surface switcher by hand.
  const [section, setSection] = useState<BuilderSection>("basics");
  const [wordsTab, setWordsTab] = useState<WordsTab>("landing");
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>("email");
  // Recipe is a soft hint, not a gate: "recolour" rests the advanced rail group;
  // an existing theme that already carries bespoke structure opens on "bespoke".
  const hasBespoke =
    Boolean(initial?.landing_html) ||
    Boolean(
      initial?.email_templates && Object.keys(initial.email_templates).length
    );
  const [recipe, setRecipe] = useState<"recolour" | "bespoke">(
    hasBespoke ? "bespoke" : "recolour"
  );
  // Sign-off two-state: blank = "no signature line" (the default); Customise
  // reveals the input. Start open when an existing theme already carries one.
  const [signOffEditing, setSignOffEditing] = useState<boolean>(
    Boolean(initial?.email_copy?.shared?.signOff)
  );

  // The structured email copy as the write contract / preview expect it.
  const emailCopy: EmailCopy = useMemo(
    () => ({ shared: emailShared, perType: emailPerType }),
    [emailShared, emailPerType]
  );

  // The preview draft. The server (post-CT7) derives palette + stacks from the
  // seeds/keys; we ALSO send the derived palette + resolved stacks so the live
  // preview renders against either the new or the legacy route contract.
  const previewPayload: ThemePreviewPayload = {
    seeds,
    font_display_key: fontDisplayKey,
    font_body_key: fontBodyKey,
    landing_copy: landingCopy,
    email_copy: emailCopy,
    palette: { ...palette },
    font_display: displayFont.stack,
    font_sans: bodyFont.stack,
    logo_url: logoUrl.trim() || null,
    logo_background: logoBackground,
    logo_position: logoPosition,
    show_powered_by: isGallery ? true : showPoweredBy,
  };

  // Live validation of the pasted bespoke landing (mirrors campaign-wizard) —
  // only surfaced when something has been pasted.
  const landingValidation = landingHtml.trim()
    ? validateHtmlTemplate(landingHtml)
    : null;

  // The brand colours/logo fed to the AI prompts. Prefer what the page threaded
  // (the brand's configured kit); fall back to the theme's own palette + logo so
  // the prompt always reflects the bespoke colours being authored.
  const promptBrandColors: BrandColors =
    brandColors ?? paletteToBrandColors(palette);
  const promptLogo: LogoInput | null =
    logo ??
    (logoUrl.trim()
      ? { url: logoUrl.trim(), background: logoBackground, position: logoPosition }
      : null);

  // Open a rail section and snap the preview to its natural surface.
  function goSection(next: BuilderSection) {
    setSection(next);
    setPreviewSurface(
      next === "words"
        ? wordsTab === "emails"
          ? "email"
          : "landing"
        : SECTION_SURFACE[next]
    );
  }

  // Switch the Words sub-tab and follow it with the preview surface.
  function goWordsTab(tab: WordsTab) {
    setWordsTab(tab);
    setPreviewSurface(tab === "emails" ? "email" : "landing");
  }

  function setSeed(key: keyof ThemeSeeds, value: string) {
    setSeeds((s) => ({ ...s, [key]: value }));
  }

  function setHighlight(index: number, value: string) {
    setLandingCopy((c) => {
      const highlights = [...c.highlights];
      highlights[index] = value;
      return { ...c, highlights };
    });
  }

  function addHighlight() {
    setLandingCopy((c) =>
      c.highlights.length >= MAX_HIGHLIGHTS
        ? c
        : { ...c, highlights: [...c.highlights, ""] }
    );
  }

  function removeHighlight(index: number) {
    setLandingCopy((c) => ({
      ...c,
      highlights: c.highlights.filter((_, i) => i !== index),
    }));
  }

  function copyLandingPrompt() {
    const prompt = buildTemplatePrompt({
      name: name.trim() || `${brandName ?? "Brand"} landing page`,
      brief:
        landingBrief.trim() ||
        `A bespoke, white-label job-application landing page for ${brandName ?? "the brand"}.`,
      brandColors: promptBrandColors,
      logo: promptLogo,
      // Bespoke landings are custom/Premium+ only: brand colours, no powered-by.
      tier: "premium",
    });
    navigator.clipboard?.writeText(prompt).then(() => {
      setLandingCopied(true);
      setTimeout(() => setLandingCopied(false), 2000);
    });
  }

  async function save() {
    if (!name.trim()) {
      toast("Give the theme a name", "error");
      // The name lives on the Basics panel — surface it if we're elsewhere.
      goSection("basics");
      return;
    }
    // Bespoke landing must satisfy the slot/mount contract before we save it (the
    // server re-validates, but fail fast with a precise message).
    if (!isGallery && landingValidation && !landingValidation.ok) {
      toast(`Fix the bespoke landing: ${landingValidation.errors[0]}`, "error");
      goSection("bespoke-landing");
      return;
    }
    setSaving(true);
    try {
      // Trim blank highlights so we never persist empty bullets; the server caps
      // and re-validates regardless (normaliseLandingCopy).
      const highlights = landingCopy.highlights
        .map((h) => h.trim())
        .filter(Boolean)
        .slice(0, MAX_HIGHLIGHTS);

      const body = {
        name: name.trim(),
        scope,
        ...(isGallery ? {} : { org_id: orgId, client_id: clientId }),
        // CT7: the new write path — 3 seeds + 2 font keys. The server derives the
        // 11-token palette and resolves the CSS stacks; we no longer send those.
        seeds,
        font_display_key: fontDisplayKey,
        font_body_key: fontBodyKey,
        logo_url: logoUrl.trim() || null,
        logo_background: logoBackground,
        logo_position: logoPosition,
        show_powered_by: isGallery ? true : showPoweredBy,
        // Structured copy (CT7) — allowed on gallery + custom alike (recolour layer).
        landing_copy: { ...landingCopy, highlights },
        email_copy: emailCopy,
        // Bespoke landing + emails (CT6) — custom-scope only. Gallery sends null
        // so a scope-flip can't smuggle bespoke structure (the server forces null
        // for gallery regardless). Empty map → null, so we don't persist {}.
        landing_html: isGallery ? null : landingHtml.trim() || null,
        email_templates: isGallery
          ? null
          : Object.keys(emailTemplates).length
            ? emailTemplates
            : null,
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

  // ── Rail item button ──
  function railItem({ key, label }: { key: BuilderSection; label: string }) {
    const active = section === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => goSection(key)}
        aria-current={active ? "page" : undefined}
        className={`relative flex w-full items-center rounded-lg py-2 pl-3.5 pr-3 text-left text-sm transition-colors cursor-pointer ${
          active
            ? "bg-cobalt-tint font-medium text-ink"
            : "text-ink-muted hover:bg-canvas hover:text-ink-soft"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-cobalt" />
        )}
        {label}
      </button>
    );
  }

  return (
    // The builder is a wide editing surface — break out of the operator
    // layout's centred max-w-6xl so the rail + canvas + preview each get room,
    // then re-cap at a comfortable width so it never sprawls on huge monitors.
    <div className="mx-[calc(50%-50vw)] px-6 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
      {/* Header / action bar — Save stays reachable from any section */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onDone(false)}
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[0.8rem] font-medium text-ink-soft transition-colors hover:bg-canvas cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-cobalt px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-cobalt-deep disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
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

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)_minmax(360px,440px)]">
        {/* ── Rail (the theme outline) ───────────────────────── */}
        <nav className="space-y-3 lg:sticky lg:top-24 lg:self-start" aria-label="Theme sections">
          <div className="rounded-xl border border-border bg-surface p-2.5">
            <div className="mb-1 flex items-center gap-2 px-2">
              <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                The theme
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-0.5">{CORE_SECTIONS.map(railItem)}</div>

            {!isGallery && (
              <div
                className={
                  recipe === "recolour"
                    ? "opacity-55 transition-opacity hover:opacity-100 focus-within:opacity-100"
                    : "transition-opacity"
                }
              >
                <div className="mb-1 mt-3 flex items-center gap-2 px-2">
                  <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                    Advanced · opt-in
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-0.5">{ADVANCED_SECTIONS.map(railItem)}</div>
              </div>
            )}
          </div>

          {/* Powered-by footer — the white-label lever */}
          <div className="rounded-xl border border-border bg-surface p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.82rem] font-medium text-ink-soft">
                  Powered-by footer
                </p>
                <p className="mt-0.5 text-[0.66rem] text-ink-faint">
                  {isGallery ? "Always on for gallery themes" : "Off = fully white-label"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showPoweredBy}
                aria-label="Powered-by footer"
                disabled={isGallery}
                onClick={() => setShowPoweredBy((v) => !v)}
                className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  showPoweredBy ? "bg-cobalt" : "bg-border-strong"
                } ${isGallery ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    showPoweredBy ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        </nav>

        {/* ── Canvas (the active panel) ──────────────────────── */}
        <div className="min-w-0">
          {/* BASICS */}
          {section === "basics" && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-4">
                <h3 className="font-serif text-base text-ink">Basics</h3>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Name the theme, then pick the path you&rsquo;re on. You can switch
                  later — nothing locks.
                </p>
              </div>

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

              {!isGallery && (
                <div className="mt-4">
                  <span className={labelClass}>What are you building?</span>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {(
                      [
                        {
                          value: "recolour" as const,
                          title: "On-brand recolour",
                          sub: "Colour, type and words. Fast — most brands stop here.",
                        },
                        {
                          value: "bespoke" as const,
                          title: "Fully hand-authored",
                          sub: "White-label landing + emails, built with AI. Opens the advanced steps.",
                        },
                      ]
                    ).map((opt) => {
                      const on = recipe === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setRecipe(opt.value)}
                          className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                            on
                              ? "border-cobalt bg-cobalt-tint/50"
                              : "border-border hover:border-border-strong"
                          }`}
                        >
                          <span className="flex items-center gap-2 text-sm font-medium text-ink">
                            <span
                              className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-[1.5px] ${
                                on ? "border-cobalt" : "border-border-strong"
                              }`}
                            >
                              {on && <span className="h-1.5 w-1.5 rounded-full bg-cobalt" />}
                            </span>
                            {opt.title}
                          </span>
                          <span className="mt-1 block text-[0.7rem] leading-snug text-ink-muted">
                            {opt.sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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
          )}

          {/* COLOUR */}
          {section === "colour" && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-serif text-base text-ink">Colour</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                Pick three. The kit derives the full eleven-token palette —
                surfaces, ink ramp and borders — with contrast checked for you.
              </p>

              {/* Seed pickers */}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {SEED_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className="rounded-lg border border-border bg-cream/40 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <label
                        className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border"
                        style={{ backgroundColor: seeds[field.key] }}
                      >
                        <input
                          type="color"
                          value={to6(seeds[field.key])}
                          onChange={(e) => setSeed(field.key, e.target.value)}
                          className="absolute -inset-2 cursor-pointer opacity-0"
                          aria-label={`${field.label} seed colour`}
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.78rem] font-medium text-ink-soft">
                          {field.label}
                        </p>
                        <input
                          value={seeds[field.key]}
                          onChange={(e) => setSeed(field.key, e.target.value)}
                          spellCheck={false}
                          className="w-full bg-transparent font-mono text-[0.72rem] text-ink-muted outline-none focus:text-ink"
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-[0.66rem] leading-snug text-ink-faint">
                      {field.hint}
                    </p>
                  </div>
                ))}
              </div>

              {/* Derived tokens — read-only output, tucked behind a disclosure */}
              <details className="mt-4">
                <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[0.76rem] text-ink-muted hover:text-ink-soft">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint">
                    <path d="M4 2.5L8 6l-4 3.5" />
                  </svg>
                  Show the 11 derived tokens
                </summary>
                <div className="mt-3 space-y-4 rounded-lg border border-dashed border-border bg-cream/20 p-4">
                  {DERIVED_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="mb-1.5 text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        {group.keys.map((key) => (
                          <div
                            key={key}
                            className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5"
                            title={`${DERIVED_LABELS[key]} · ${palette[key]}`}
                          >
                            <span
                              className="h-5 w-5 shrink-0 rounded border border-border"
                              style={{ backgroundColor: palette[key] }}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-[0.62rem] font-medium text-ink-soft">
                                {DERIVED_LABELS[key]}
                              </p>
                              <p className="font-mono text-[0.58rem] text-ink-faint">
                                {palette[key]}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}

          {/* TYPE */}
          {section === "type" && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-serif text-base text-ink">Type</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                A display face for headings and a body face for copy. The real web
                font loads on landing pages; emails fall back to a safe family.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="font_display" className={labelClass}>
                    Display font
                  </label>
                  <select
                    id="font_display"
                    value={fontDisplayKey}
                    onChange={(e) => setFontDisplayKey(e.target.value)}
                    className={selectClass}
                  >
                    {DISPLAY_FONTS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <p
                    className="mt-2 truncate rounded-md border border-border bg-cream/30 px-3 py-2 text-lg leading-tight text-ink"
                    style={{ fontFamily: displayFont.stack }}
                  >
                    {brandName ?? "Northwind Studio"}
                  </p>
                </div>
                <div>
                  <label htmlFor="font_body" className={labelClass}>
                    Body font
                  </label>
                  <select
                    id="font_body"
                    value={fontBodyKey}
                    onChange={(e) => setFontBodyKey(e.target.value)}
                    className={selectClass}
                  >
                    {BODY_FONTS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <p
                    className="mt-2 rounded-md border border-border bg-cream/30 px-3 py-2 text-[0.82rem] leading-snug text-ink-soft"
                    style={{ fontFamily: bodyFont.stack }}
                  >
                    The quick brown fox jumps over the lazy dog.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* WORDS — landing + shared email copy under one roof */}
          {section === "words" && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-serif text-base text-ink">Words</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                Copy for the generated landing page and the candidate emails. Slots
                like{" "}
                <code className="font-mono text-ink-muted">{"{{client.name}}"}</code>{" "}
                are filled per campaign.
              </p>

              {/* Sub-tabs */}
              <div className="mt-4 inline-flex gap-1 rounded-lg border border-border bg-cream/60 p-1">
                {(
                  [
                    { key: "landing" as const, label: "Landing" },
                    { key: "emails" as const, label: "Emails" },
                  ]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => goWordsTab(t.key)}
                    className={`rounded-md px-3.5 py-1.5 text-[0.8rem] transition-colors cursor-pointer ${
                      wordsTab === t.key
                        ? "bg-surface font-medium text-ink shadow-sm"
                        : "text-ink-muted hover:text-ink-soft"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Landing copy */}
              {wordsTab === "landing" && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="landing_headline" className={labelClass}>
                      Headline
                    </label>
                    <input
                      id="landing_headline"
                      value={landingCopy.headline}
                      onChange={(e) =>
                        setLandingCopy((c) => ({ ...c, headline: e.target.value }))
                      }
                      placeholder={DEFAULT_LANDING_COPY.headline}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="landing_intro" className={labelClass}>
                      Intro
                    </label>
                    <textarea
                      id="landing_intro"
                      value={landingCopy.intro}
                      onChange={(e) =>
                        setLandingCopy((c) => ({ ...c, intro: e.target.value }))
                      }
                      placeholder={DEFAULT_LANDING_COPY.intro}
                      rows={3}
                      className={textareaClass}
                    />
                  </div>

                  {/* Highlights list */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className={`${labelClass} mb-0`}>
                        Highlights{" "}
                        <span className="font-sans normal-case tracking-normal text-ink-faint">
                          {landingCopy.highlights.length}/{MAX_HIGHLIGHTS}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={addHighlight}
                        disabled={landingCopy.highlights.length >= MAX_HIGHLIGHTS}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[0.7rem] font-medium text-ink-soft transition-colors hover:bg-canvas disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M6 2v8M2 6h8" />
                        </svg>
                        Add
                      </button>
                    </div>
                    {landingCopy.highlights.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[0.74rem] text-ink-muted">
                        No highlights — the apply page shows none.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {landingCopy.highlights.map((h, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              value={h}
                              onChange={(e) => setHighlight(i, e.target.value)}
                              placeholder={`Selling point ${i + 1}`}
                              className={inputClass}
                            />
                            <button
                              type="button"
                              onClick={() => removeHighlight(i)}
                              aria-label={`Remove highlight ${i + 1}`}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted transition-colors hover:border-vermillion/40 hover:text-vermillion cursor-pointer"
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                                <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label htmlFor="landing_apply" className={labelClass}>
                      Apply card heading
                    </label>
                    <input
                      id="landing_apply"
                      value={landingCopy.applyHeading}
                      onChange={(e) =>
                        setLandingCopy((c) => ({
                          ...c,
                          applyHeading: e.target.value,
                        }))
                      }
                      placeholder={DEFAULT_LANDING_COPY.applyHeading}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {/* Shared email copy */}
              {wordsTab === "emails" && (
                <div className="mt-4 space-y-4">
                  <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                    Shared on every email
                  </p>
                  <div>
                    <label htmlFor="email_greeting" className={labelClass}>
                      Greeting
                    </label>
                    <input
                      id="email_greeting"
                      value={emailShared.greeting}
                      onChange={(e) =>
                        setEmailShared((s) => ({ ...s, greeting: e.target.value }))
                      }
                      placeholder={DEFAULT_EMAIL_COPY.shared.greeting}
                      className={inputClass}
                    />
                  </div>

                  {/* Sign-off — two-state default (blank = no signature line) */}
                  <div>
                    <label htmlFor="email_signoff" className={labelClass}>
                      Sign-off
                    </label>
                    {signOffEditing ? (
                      <>
                        <input
                          id="email_signoff"
                          value={emailShared.signOff}
                          onChange={(e) =>
                            setEmailShared((s) => ({ ...s, signOff: e.target.value }))
                          }
                          placeholder="e.g. — The team"
                          autoFocus
                          className={inputClass}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEmailShared((s) => ({ ...s, signOff: "" }));
                            setSignOffEditing(false);
                          }}
                          className="mt-1.5 text-[0.74rem] text-cobalt hover:underline cursor-pointer"
                        >
                          Reset to default
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-cream/30 px-3.5 py-2.5">
                        <span className="text-[0.78rem] italic text-ink-muted">
                          Using the default — no signature line. Each email keeps its
                          own closing.
                        </span>
                        <button
                          type="button"
                          onClick={() => setSignOffEditing(true)}
                          className="shrink-0 text-[0.74rem] font-medium text-cobalt hover:underline cursor-pointer"
                        >
                          Customise
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label htmlFor="email_footer" className={labelClass}>
                      Footer
                    </label>
                    <input
                      id="email_footer"
                      value={emailShared.footer}
                      onChange={(e) =>
                        setEmailShared((s) => ({ ...s, footer: e.target.value }))
                      }
                      placeholder={DEFAULT_EMAIL_COPY.shared.footer}
                      className={inputClass}
                    />
                  </div>

                  {!isGallery && (
                    <p className="rounded-lg border border-dashed border-border bg-cream/20 px-3.5 py-2.5 text-[0.74rem] text-ink-muted">
                      Per-email subjects and bodies live under{" "}
                      <button
                        type="button"
                        onClick={() => goSection("bespoke-emails")}
                        className="font-medium text-cobalt hover:underline cursor-pointer"
                      >
                        Bespoke emails
                      </button>
                      .
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* BESPOKE LANDING (custom only) */}
          {!isGallery && section === "bespoke-landing" && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-serif text-base text-ink">Bespoke landing page</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                A hand-authored landing page that supersedes the palette-generated
                one for campaigns on this theme. Copy the prompt into Claude or
                ChatGPT, refine the live preview, then paste the final HTML. Leave
                blank to use the generated landing.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="landing_brief" className={labelClass}>
                    Design brief{" "}
                    <span className="font-sans normal-case tracking-normal text-ink-faint">
                      optional
                    </span>
                  </label>
                  <textarea
                    id="landing_brief"
                    value={landingBrief}
                    onChange={(e) => setLandingBrief(e.target.value)}
                    placeholder="Layout style, tone, sections to include… folded into the copied prompt."
                    rows={2}
                    className={textareaClass}
                  />
                </div>

                <button
                  type="button"
                  onClick={copyLandingPrompt}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-cream/40 px-4 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cream hover:border-border-strong cursor-pointer"
                >
                  {landingCopied ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.5L6.5 12L13 4" />
                      </svg>
                      Copied to clipboard
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="5" width="8" height="8" rx="1.5" />
                        <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
                      </svg>
                      Copy AI prompt for the landing page
                    </>
                  )}
                </button>

                <div className="relative">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                  <p className="relative mx-auto w-fit bg-surface px-3 text-[0.62rem] font-medium uppercase tracking-[0.15em] text-ink-muted">
                    Then paste the generated HTML
                  </p>
                </div>

                <div>
                  <label htmlFor="landing_html" className={labelClass}>
                    Landing HTML
                  </label>
                  <textarea
                    id="landing_html"
                    value={landingHtml}
                    onChange={(e) => setLandingHtml(e.target.value)}
                    placeholder="Paste the complete HTML page here…"
                    spellCheck={false}
                    rows={10}
                    className={`w-full resize-none rounded-lg border bg-cream/40 px-3.5 py-2.5 font-mono text-xs text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-muted focus:ring-1 focus:ring-cobalt/20 ${
                      landingValidation && !landingValidation.ok
                        ? "border-red focus:border-red"
                        : landingValidation?.ok
                          ? "border-green focus:border-cobalt"
                          : "border-border focus:border-cobalt"
                    }`}
                  />
                  {landingValidation?.ok && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-green">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 6.5L5 9l4.5-6" />
                      </svg>
                      Valid landing template ({landingHtml.length.toLocaleString()}{" "}
                      characters)
                    </p>
                  )}
                  {landingValidation && !landingValidation.ok && (
                    <div className="mt-1 space-y-0.5">
                      {landingValidation.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red">
                          {err}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {landingValidation?.ok && (
                  <ThemeBespokePreview
                    request={{
                      endpoint: "/api/operator/themes/landing-preview",
                      // The route reads landing_html (paste branch) and the
                      // seed/font/copy draft (generated branch) — send both.
                      body: { landing_html: landingHtml, ...previewPayload },
                    }}
                    height={560}
                    label="Preview landing page"
                  />
                )}
              </div>
            </section>
          )}

          {/* BESPOKE EMAILS (custom only) */}
          {!isGallery && section === "bespoke-emails" && (
            <ThemeBespokeEmails
              value={emailTemplates}
              onChange={setEmailTemplates}
              perTypeCopy={emailPerType}
              onChangePerTypeCopy={setEmailPerType}
              brandColors={promptBrandColors}
              logo={promptLogo}
              previewTheme={previewPayload}
            />
          )}

          {/* Logo — brand identity, so it rides under Basics rather than owning a
              rail slot of its own. */}
          {section === "basics" && (
            <section className="mt-6 rounded-xl border border-border bg-surface p-5">
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
          )}
        </div>

        {/* ── Live preview column (sticky, follows the open section) ── */}
        <div className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="inline-flex gap-0.5 rounded-lg border border-border bg-cream/60 p-0.5">
                {(["email", "landing"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPreviewSurface(s)}
                    className={`rounded-md px-2.5 py-1 font-mono text-[0.58rem] uppercase tracking-[0.1em] transition-colors cursor-pointer ${
                      previewSurface === s
                        ? "bg-surface text-ink shadow-sm"
                        : "text-ink-muted hover:text-ink-soft"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <span className="rounded-full bg-canvas-2 px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-ink-muted">
                {previewSurface === "landing" ? "Apply page" : "Application received"}
              </span>
            </div>

            {previewSurface === "email" ? (
              <ThemeEmailPreview payload={previewPayload} fit height={600} />
            ) : (
              <ThemeLandingPreview
                payload={previewPayload}
                landingHtml={
                  !isGallery && landingValidation?.ok ? landingHtml : undefined
                }
                height={600}
              />
            )}
            <p className="mt-2.5 text-[0.68rem] leading-relaxed text-ink-muted">
              Rendered through the real send-path template with sample data.
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
