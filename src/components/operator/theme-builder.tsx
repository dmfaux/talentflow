"use client";

import { useToast } from "@/components/ui/toast-provider";
import {
  buildBespokeKitPrompt,
  type BrandColors,
  type LogoInput,
} from "@/lib/prompt-builder";
import { validateHtmlTemplate } from "@/lib/slots";
import { validateEmailShell } from "@/lib/email-shell";
import { normaliseHexColor } from "@/lib/utils";
import {
  derivePalette,
  type DerivedPalette,
  type ThemeSeeds,
} from "@/lib/theme-colors";
import {
  BODY_FONTS,
  DISPLAY_FONTS,
  resolveBodyFont,
  resolveDisplayFont,
} from "@/lib/theme-fonts";
import {
  STARTER_THEME_DRAFT,
  THEME_PALETTE_KEYS,
  type ThemePaletteKey,
  type ThemeScope,
} from "@/lib/theme-fields";
import { useMemo, useState } from "react";
import {
  EmailPreviewFrame,
  type ThemePreviewPayload,
} from "./theme-email-preview";
import { LandingPreviewFrame } from "./theme-landing-preview";
import { ThemePreviewDialog } from "./theme-preview-dialog";
import { useThemePreview } from "./use-theme-preview";

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
  // The 3 seeds + 2 font keys the builder re-seeds its pickers from (nullable on
  // legacy rows authored before seed/key authoring — those carry only the
  // resolved palette/stacks).
  seed_primary?: string | null;
  seed_accent?: string | null;
  seed_bg?: string | null;
  // Per-token overrides the operator pinned over the derived palette (partial map;
  // null/absent = pure derivation). Re-seeds the builder's override pickers.
  palette_overrides?: Record<string, string> | null;
  font_display_key?: string | null;
  font_body_key?: string | null;
  logo_url: string | null;
  logo_background: string;
  logo_position: string;
  show_powered_by: boolean;
  // Bespoke landing page (custom/Premium themes only) — supersedes the
  // palette-generated landing for campaigns on this theme. Null = generated.
  landing_html: string | null;
  // Bespoke email shell (custom/Premium themes only) — the matching wrapper every
  // transactional email renders into. Null = the in-code default chrome.
  email_shell: string | null;
  preview_image_url: string | null;
  client?: { id: string; name: string; slug: string } | null;
  organization?: { id: string; name: string; slug: string } | null;
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

// ── Section navigation (the left-rail "theme outline") ──────────────
// Gallery themes are recolour-only: Basics, Colour, Type. A custom (Premium)
// theme adds one advanced section — the bespoke kit (landing + matching email).
type BuilderSection = "basics" | "colour" | "type" | "bespoke";
type PreviewSurface = "email" | "landing";

const CORE_SECTIONS: { key: BuilderSection; label: string }[] = [
  { key: "basics", label: "Basics" },
  { key: "colour", label: "Colour" },
  { key: "type", label: "Type" },
];
const ADVANCED_SECTIONS: { key: BuilderSection; label: string }[] = [
  { key: "bespoke", label: "Bespoke kit" },
];

// The surface the live preview snaps to when a section opens (the manual switcher
// can still override it). Type + the bespoke kit lean landing; the rest lean email.
const SECTION_SURFACE: Record<BuilderSection, PreviewSurface> = {
  basics: "email",
  colour: "email",
  type: "landing",
  bespoke: "landing",
};

const labelClass =
  "mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";
const inputClass =
  "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
const textareaClass =
  "w-full resize-none rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
const selectClass =
  "h-10 w-full cursor-pointer rounded-lg border border-border bg-cream/40 px-3 text-sm text-ink-soft outline-none focus:border-cobalt";

/** Coerce a stored override map to a partial of only the 11 known tokens, so a
 *  stale/unknown key on a saved row can never leak into the builder's state. */
function initialOverrides(
  raw: Record<string, string> | null | undefined
): Partial<Record<ThemePaletteKey, string>> {
  const out: Partial<Record<ThemePaletteKey, string>> = {};
  if (!raw) return out;
  for (const key of THEME_PALETTE_KEYS) {
    const v = raw[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

/** Expand 3-digit hex to 6 so <input type="color"> can display it. */
function to6(hex: string): string {
  const v = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  }
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : "#000000";
}

/**
 * Map the theme's derived palette onto the prompt builder's BrandColors shape, so
 * the bespoke-kit prompt embeds "use these exact colours" and the AI's landing +
 * email match the theme being authored. This is the SOLE source of the prompt's
 * colours, so the operator's live seeds + overrides flow straight through.
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
   *  Absent for gallery themes — the bespoke section is then hidden anyway. */
  brandColors?: BrandColors | null;
  /** The brand's configured logo (custom themes only); threaded from the page. */
  logo?: LogoInput | null;
  initial?: OperatorThemeRow;
  onDone: (saved: boolean) => void;
}) {
  const { toast } = useToast();
  const isGallery = scope === "gallery";
  const editing = !!initial;

  // Pre-fill a real, editable default name for a NEW bespoke theme. The field is
  // required (save() bails on an empty name), and a brand-anchored placeholder
  // reads like a value, so an operator who never typed a name used to hit a
  // silent bounce back to Basics. Seeding the actual state — not just the
  // placeholder — makes "Create theme" work out of the box and removes the trap.
  const [name, setName] = useState(
    initial?.name ?? (!isGallery && brandName ? `${brandName} — Bespoke` : "")
  );

  // ── Seeds: 3 colours the palette is derived from ──
  const [seeds, setSeeds] = useState<ThemeSeeds>(() => {
    // Editing an existing theme → re-seed from its stored seeds. A LEGACY row has
    // null seed columns (authored before seed-based editing); back-fill those from
    // its stored palette.primary/accent/bg so the derived starting point matches
    // the saved look rather than drifting to STARTER on the next save (the
    // contract documented on the schema's seed columns).
    if (initial) {
      return {
        primary:
          initial.seed_primary ??
          initial.palette?.primary ??
          STARTER_THEME_DRAFT.seeds.primary,
        accent:
          initial.seed_accent ??
          initial.palette?.accent ??
          STARTER_THEME_DRAFT.seeds.accent,
        bg:
          initial.seed_bg ??
          initial.palette?.bg ??
          STARTER_THEME_DRAFT.seeds.bg,
      };
    }
    // A NEW bespoke theme starts from the brand's CORPORATE colours so the derived
    // palette — which styles the email body rendered inside the bespoke shell, and
    // the generated-landing fallback — matches the brand from the first render.
    // Falls back to the starter seeds when the brand has no defined palette.
    if (!isGallery && brandColors) {
      return {
        primary: brandColors.primary,
        accent: brandColors.accent ?? STARTER_THEME_DRAFT.seeds.accent,
        bg: brandColors.secondary,
      };
    }
    return { ...STARTER_THEME_DRAFT.seeds };
  });
  // ── Palette: derived from the seeds, with per-token overrides on top ──
  // `overrides` holds only the tokens the operator pinned by hand. The pure
  // derivation recomputes live as seeds change; the effective palette layers the
  // overrides over it, so a pinned token stays put while the rest track the seeds.
  const [overrides, setOverrides] = useState<
    Partial<Record<ThemePaletteKey, string>>
  >(() => initialOverrides(initial?.palette_overrides));
  const derivedPalette = useMemo(() => derivePalette(seeds), [seeds]);
  const palette: DerivedPalette = useMemo(
    () => ({ ...derivedPalette, ...overrides }),
    [derivedPalette, overrides]
  );
  const overrideCount = Object.keys(overrides).length;
  // The token editor opens itself when re-editing a theme that already has overrides.
  const [tokensOpen, setTokensOpen] = useState(
    () => Object.keys(initialOverrides(initial?.palette_overrides)).length > 0
  );
  // The hex text field being typed into (uncommitted): its raw keystrokes show
  // here so a half-typed value like "#2c5b" never enters `overrides` (which would
  // 400 the live preview and the save). Only a value that NORMALISES is committed
  // as an override — live — so the preview keeps tracking valid edits.
  const [tokenDraft, setTokenDraft] = useState<{
    key: ThemePaletteKey;
    value: string;
  } | null>(null);

  // Tracks a manual seed edit so the brand-colour re-seed below never clobbers
  // the operator's own choices once they've started tweaking.
  const [seedsTouched, setSeedsTouched] = useState(false);

  // Re-seed a NEW bespoke theme from the brand's corporate colours when they
  // arrive (the parent fetches them async, so they may land after mount). Done
  // with React's "adjust state while rendering" pattern — comparing against the
  // last brandColors we consumed — rather than a setState-in-effect, which risks a
  // cascading re-render. Fires once per actual brandColors change and only until
  // the operator edits a seed; no-op when the brand has no palette.
  const [seededBrand, setSeededBrand] = useState(brandColors);
  if (brandColors !== seededBrand) {
    setSeededBrand(brandColors);
    if (!initial && !isGallery && !seedsTouched && brandColors) {
      setSeeds({
        primary: brandColors.primary,
        accent: brandColors.accent ?? STARTER_THEME_DRAFT.seeds.accent,
        bg: brandColors.secondary,
      });
    }
  }

  // ── Fonts: registry keys, not raw stacks ──
  const [fontDisplayKey, setFontDisplayKey] = useState(
    () => resolveDisplayFont(initial?.font_display_key).key
  );
  const [fontBodyKey, setFontBodyKey] = useState(
    () => resolveBodyFont(initial?.font_body_key).key
  );
  const displayFont = resolveDisplayFont(fontDisplayKey);
  const bodyFont = resolveBodyFont(fontBodyKey);

  const [logoUrl, setLogoUrl] = useState(initial?.logo_url ?? "");
  const [logoBackground, setLogoBackground] = useState(
    initial?.logo_background ?? "light"
  );
  const [logoPosition, setLogoPosition] = useState(
    initial?.logo_position ?? "top-left"
  );
  // Gallery is forced powered-by=true; white-label is bespoke-only.
  const [showPoweredBy, setShowPoweredBy] = useState(
    isGallery ? true : initial?.show_powered_by ?? true
  );
  const [previewImageUrl, setPreviewImageUrl] = useState(
    initial?.preview_image_url ?? ""
  );

  // ── Bespoke kit (custom only): one brief → one prompt → two pasted artifacts ──
  const [kitBrief, setKitBrief] = useState("");
  const [kitCopied, setKitCopied] = useState(false);
  const [landingHtml, setLandingHtml] = useState(initial?.landing_html ?? "");
  const [emailShell, setEmailShell] = useState(initial?.email_shell ?? "");

  const [saving, setSaving] = useState(false);
  // Set once "Create theme" is pressed, so the required-name error surfaces
  // inline (not just as a transient toast) and then clears live as the operator
  // types — mirroring the landing/email fields' live validation.
  const [attemptedSave, setAttemptedSave] = useState(false);
  const nameMissing = attemptedSave && !name.trim();

  // ── Section navigation + preview surface ──
  const [section, setSection] = useState<BuilderSection>("basics");
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>("email");

  // The preview draft. The server derives palette + stacks from the seeds/keys; we
  // ALSO send the derived palette + resolved stacks so the live preview renders
  // against the route contract. The bespoke email_shell rides through so the email
  // preview shows the real chrome (custom only; gallery sends none).
  const previewPayload: ThemePreviewPayload = {
    seeds,
    font_display_key: fontDisplayKey,
    font_body_key: fontBodyKey,
    email_shell: isGallery ? null : emailShell.trim() || null,
    palette: { ...palette },
    // The server re-derives from seeds + these overrides; sending the merged
    // `palette` too keeps the preview faithful whichever the route reads.
    palette_overrides: overrides,
    font_display: displayFont.stack,
    font_sans: bodyFont.stack,
    logo_url: logoUrl.trim() || null,
    logo_background: logoBackground,
    logo_position: logoPosition,
    show_powered_by: isGallery ? true : showPoweredBy,
    // The brand's real name flows into the sample so the preview reads like this
    // brand's send; absent (gallery) → the route falls back to its default sample.
    brand_name: brandName?.trim() || undefined,
  };

  // Live validation of the pasted bespoke artifacts (only surfaced once pasted).
  const landingValidation = landingHtml.trim()
    ? validateHtmlTemplate(landingHtml)
    : null;
  const emailShellValidation = emailShell.trim()
    ? validateEmailShell(emailShell)
    : null;

  // ── Live preview render (lifted here so the inline frame, the open-in-new-tab
  // action, and the realistic dialog all share one fetch of one HTML) ──
  const isEmailSurface = previewSurface === "email";
  // The bespoke landing previews only once it validates; an empty/invalid paste
  // falls through to the palette-generated landing (matching real precedence).
  const activeLandingHtml =
    !isGallery && landingValidation?.ok ? landingHtml : undefined;
  const previewEndpoint = isEmailSurface
    ? "/api/operator/themes/preview"
    : "/api/operator/themes/landing-preview";
  const previewBody = isEmailSurface
    ? previewPayload
    : activeLandingHtml?.trim()
      ? { ...previewPayload, landing_html: activeLandingHtml }
      : previewPayload;
  const { data: previewData, status: previewStatus } = useThemePreview({
    endpoint: previewEndpoint,
    body: previewBody,
  });
  const previewHtml = previewData?.html ?? null;
  const [expanded, setExpanded] = useState(false);

  // Open the current render in a new browser tab as a Blob URL — no extra server
  // route; it's the exact HTML already on screen.
  function openPreviewTab() {
    if (!previewHtml) return;
    const url = URL.createObjectURL(
      new Blob([previewHtml], { type: "text/html" })
    );
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      URL.revokeObjectURL(url);
      toast("Allow pop-ups to open the preview in a new tab", "error");
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // The colours fed to the AI prompt come from the LIVE theme palette, so the
  // operator's Colour edits (seeds + overrides) flow straight into the copied
  // prompt and the bespoke landing/email the AI returns already matches the theme.
  // (The brand's threaded corporate colours only SEED the palette — see the seeds
  // initialiser above — they are not embedded directly.)
  const promptBrandColors: BrandColors = paletteToBrandColors(palette);
  const promptLogo: LogoInput | null =
    logo ??
    (logoUrl.trim()
      ? { url: logoUrl.trim(), background: logoBackground, position: logoPosition }
      : null);

  // What the copied prompt embeds as "use these exact colours" — sourced from the
  // same promptBrandColors above so this manifest can never drift from the prompt.
  const promptColours: { label: string; value: string }[] = [
    { label: "Primary", value: promptBrandColors.primary },
    { label: "Surface", value: promptBrandColors.secondary },
    { label: "Accent", value: promptBrandColors.accent ?? palette.accent },
    { label: "Text", value: promptBrandColors.text },
  ];

  // Open a rail section and snap the preview to its natural surface.
  function goSection(next: BuilderSection) {
    setSection(next);
    setPreviewSurface(SECTION_SURFACE[next]);
  }

  function setSeed(key: keyof ThemeSeeds, value: string) {
    setSeedsTouched(true);
    setSeeds((s) => ({ ...s, [key]: value }));
  }

  // Pin a derived token to an explicit value (becomes an override).
  function setToken(key: ThemePaletteKey, value: string) {
    setOverrides((o) => ({ ...o, [key]: value }));
  }
  // Drop a single override — that token reverts to tracking the seeds.
  function resetToken(key: ThemePaletteKey) {
    setOverrides((o) => {
      const next = { ...o };
      delete next[key];
      return next;
    });
  }
  // Drop every override — the whole palette reverts to pure derivation.
  function resetAllTokens() {
    setOverrides({});
  }

  // Typing into a token's hex field: keep the raw text as the live draft, but only
  // commit it as an override once it parses to a real colour. Half-typed values
  // stay in the draft, so neither the preview nor the saved overrides ever see them.
  function editToken(key: ThemePaletteKey, value: string) {
    setTokenDraft({ key, value });
    const normalised = normaliseHexColor(value.trim());
    if (normalised) setToken(key, normalised);
  }
  // Native colour-picker change is always a valid hex — commit it and clear any
  // stale text draft for this token so the field reflects the picked value.
  function pickToken(key: ThemePaletteKey, value: string) {
    setToken(key, value);
    setTokenDraft((d) => (d?.key === key ? null : d));
  }
  // Leaving the hex field: an emptied field clears the override (back to derived);
  // a left-over invalid draft is discarded, snapping the field back to the
  // committed value. A valid value has already been committed live by editToken.
  function finishTokenEdit() {
    if (tokenDraft && !tokenDraft.value.trim()) resetToken(tokenDraft.key);
    setTokenDraft(null);
  }

  function copyKitPrompt() {
    const prompt = buildBespokeKitPrompt({
      name: name.trim() || `${brandName ?? "Brand"} bespoke theme`,
      brief:
        kitBrief.trim() ||
        `A bespoke, white-label brand for ${brandName ?? "the brand"} — a job-application landing page and matching transactional emails.`,
      brandColors: promptBrandColors,
      logo: promptLogo,
    });
    navigator.clipboard?.writeText(prompt).then(() => {
      setKitCopied(true);
      setTimeout(() => setKitCopied(false), 2000);
    });
  }

  async function save() {
    setAttemptedSave(true);
    if (!name.trim()) {
      toast("Give the theme a name", "error");
      goSection("basics");
      return;
    }
    // The bespoke artifacts must satisfy their contracts before we save (the
    // server re-validates, but fail fast with a precise message).
    if (!isGallery && landingValidation && !landingValidation.ok) {
      toast(`Fix the bespoke landing: ${landingValidation.errors[0]}`, "error");
      goSection("bespoke");
      return;
    }
    if (!isGallery && emailShellValidation && !emailShellValidation.ok) {
      toast(`Fix the email shell: ${emailShellValidation.errors[0]}`, "error");
      goSection("bespoke");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        scope,
        ...(isGallery ? {} : { org_id: orgId, client_id: clientId }),
        // The write path takes 3 seeds + 2 font keys; the server derives the
        // 11-token palette and resolves the CSS stacks. The override map pins any
        // tokens the operator hand-tuned (empty = pure derivation).
        seeds,
        palette_overrides: overrides,
        font_display_key: fontDisplayKey,
        font_body_key: fontBodyKey,
        logo_url: logoUrl.trim() || null,
        logo_background: logoBackground,
        logo_position: logoPosition,
        show_powered_by: isGallery ? true : showPoweredBy,
        // Bespoke landing + matching email shell (custom only). Gallery sends null
        // so a scope-flip can't smuggle bespoke structure (the server forces null
        // for gallery regardless).
        landing_html: isGallery ? null : landingHtml.trim() || null,
        email_shell: isGallery ? null : emailShell.trim() || null,
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
              <>
                <div className="mb-1 mt-3 flex items-center gap-2 px-2">
                  <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                    Premium · bespoke
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-0.5">{ADVANCED_SECTIONS.map(railItem)}</div>
              </>
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
                  {isGallery
                    ? "Name the theme. Gallery themes are one shared layout in a distinct colour way — every brand can pick them."
                    : "Name the theme. Set its colour, type and logo, then build the bespoke kit."}
                </p>
              </div>

              <label htmlFor="theme_name" className={labelClass}>
                Theme name
              </label>
              <input
                id="theme_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isGallery ? "e.g. Aurora" : `e.g. ${brandName ?? "Brand"} — Bespoke`}
                aria-invalid={nameMissing}
                className={`${inputClass}${
                  nameMissing ? " border-red focus:border-red focus:ring-red/20" : ""
                }`}
              />
              {nameMissing && (
                <p className="mt-1 text-xs text-red">A theme name is required.</p>
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
                Any token can be overridden by hand; the rest keep tracking your
                seeds.
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
                        style={{ backgroundColor: to6(seeds[field.key]) }}
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

              {/* Derived tokens — editable: each is seed-derived by default and can
                  be pinned to an explicit value. Tucked behind a disclosure that
                  opens itself when a theme already carries overrides. */}
              <details
                className="mt-4"
                open={tokensOpen}
                onToggle={(e) =>
                  setTokensOpen((e.currentTarget as HTMLDetailsElement).open)
                }
              >
                <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[0.76rem] text-ink-muted hover:text-ink-soft">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`text-ink-faint transition-transform ${tokensOpen ? "rotate-90" : ""}`}>
                    <path d="M4 2.5L8 6l-4 3.5" />
                  </svg>
                  Fine-tune the 11 derived tokens
                  {overrideCount > 0 && (
                    <span className="rounded-full bg-cobalt-tint px-1.5 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-cobalt">
                      {overrideCount} overridden
                    </span>
                  )}
                </summary>
                <div className="mt-3 space-y-4 rounded-lg border border-dashed border-border bg-cream/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[0.66rem] leading-snug text-ink-muted">
                      Each token is derived from your three seeds. Override any of
                      them — the rest keep tracking the seeds.
                    </p>
                    {overrideCount > 0 && (
                      <button
                        type="button"
                        onClick={resetAllTokens}
                        className="shrink-0 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[0.62rem] font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink-soft cursor-pointer"
                      >
                        Reset all to derived
                      </button>
                    )}
                  </div>
                  {DERIVED_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="mb-1.5 text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {group.keys.map((key) => {
                          const overridden = key in overrides;
                          return (
                            <div
                              key={key}
                              className={`flex items-center gap-2 rounded-md border bg-surface px-2 py-1.5 transition-colors ${
                                overridden ? "border-cobalt/50" : "border-border"
                              }`}
                            >
                              <label
                                className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded border border-border"
                                style={{ backgroundColor: to6(palette[key]) }}
                                title={`Edit ${DERIVED_LABELS[key]}`}
                              >
                                <input
                                  type="color"
                                  value={to6(palette[key])}
                                  onChange={(e) => pickToken(key, e.target.value)}
                                  className="absolute -inset-2 cursor-pointer opacity-0"
                                  aria-label={`${DERIVED_LABELS[key]} colour`}
                                />
                              </label>
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1 truncate text-[0.62rem] font-medium text-ink-soft">
                                  {DERIVED_LABELS[key]}
                                  {overridden && (
                                    <span
                                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt"
                                      title="Overridden"
                                      aria-hidden="true"
                                    />
                                  )}
                                </p>
                                <input
                                  value={
                                    tokenDraft?.key === key
                                      ? tokenDraft.value
                                      : palette[key]
                                  }
                                  onChange={(e) => editToken(key, e.target.value)}
                                  onBlur={finishTokenEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                  }}
                                  spellCheck={false}
                                  aria-label={`${DERIVED_LABELS[key]} hex`}
                                  className="w-full bg-transparent font-mono text-[0.58rem] text-ink-faint outline-none focus:text-ink"
                                />
                              </div>
                              {overridden && (
                                <button
                                  type="button"
                                  onClick={() => resetToken(key)}
                                  title={`Reset to derived (${derivedPalette[key]})`}
                                  aria-label={`Reset ${DERIVED_LABELS[key]} to derived`}
                                  className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-canvas hover:text-ink-soft cursor-pointer"
                                >
                                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 7a4 4 0 1 1 1.2 2.85" />
                                    <path d="M3 4.2V7h2.8" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          );
                        })}
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

          {/* BESPOKE KIT (custom only) — one prompt, two matching artifacts */}
          {!isGallery && section === "bespoke" && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-serif text-base text-ink">Bespoke kit</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                One prompt designs the brand and returns two matching pieces — a
                landing page and the email shell every candidate email is sent in.
                Your theme&rsquo;s colours and logo are written into it, so what the
                AI returns already matches. Copy it into Claude or ChatGPT, refine
                against the live previews, then paste each artifact below. Leave both
                blank to fall back to the palette-generated landing and default
                email chrome.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="kit_brief" className={labelClass}>
                    Design brief{" "}
                    <span className="font-sans normal-case tracking-normal text-ink-faint">
                      optional
                    </span>
                  </label>
                  <textarea
                    id="kit_brief"
                    value={kitBrief}
                    onChange={(e) => setKitBrief(e.target.value)}
                    placeholder="Tone, layout style, signature motifs, sections to include… folded into the copied prompt."
                    rows={3}
                    className={textareaClass}
                  />
                </div>

                {/* What the prompt carries — the theme's colours + logo, live from
                    the sections that set them. Fused with the Copy action below so
                    it reads as "these ingredients → copy the prompt that holds them". */}
                <div className="overflow-hidden rounded-xl border border-border bg-cream/30">
                  <div className="space-y-3.5 p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                        Carried into the prompt
                      </span>
                      <span className="h-px flex-1 bg-border" />
                      <span className="font-mono text-[0.56rem] uppercase tracking-[0.1em] text-ink-faint">
                        live from your theme
                      </span>
                    </div>

                    {/* Colour — chips mirror the live theme palette */}
                    <div>
                      <button
                        type="button"
                        onClick={() => goSection("colour")}
                        className="group/src mb-1.5 inline-flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-cobalt cursor-pointer"
                      >
                        Colour
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint transition-colors group-hover/src:text-cobalt">
                          <path d="M3.5 8.5L8.5 3.5M4.5 3.5h4v4" />
                        </svg>
                      </button>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        {promptColours.map((c) => (
                          <div
                            key={c.label}
                            className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5"
                            title={`${c.label} · ${c.value}`}
                          >
                            <span
                              className="h-5 w-5 shrink-0 rounded border border-border"
                              style={{ backgroundColor: to6(c.value) }}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-[0.62rem] font-medium text-ink-soft">
                                {c.label}
                              </p>
                              <p className="font-mono text-[0.58rem] text-ink-faint">
                                {c.value}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Brand mark — the logo (or styled-name fallback) the prompt embeds */}
                    <div>
                      <button
                        type="button"
                        onClick={() => goSection("basics")}
                        className="group/src mb-1.5 inline-flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-cobalt cursor-pointer"
                      >
                        Brand mark
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint transition-colors group-hover/src:text-cobalt">
                          <path d="M3.5 8.5L8.5 3.5M4.5 3.5h4v4" />
                        </svg>
                      </button>
                      <div className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-2">
                        {promptLogo ? (
                          <>
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border ${
                                promptLogo.background === "dark"
                                  ? "bg-ink"
                                  : promptLogo.background === "transparent"
                                    ? "bg-canvas"
                                    : "bg-white"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={promptLogo.url}
                                alt=""
                                className="max-h-6 max-w-6 object-contain"
                              />
                            </span>
                            <p className="text-[0.7rem] text-ink-soft">
                              Logo ·{" "}
                              <span className="text-ink-muted">
                                {promptLogo.position.replace("-", " ")} on a{" "}
                                {promptLogo.background} background
                              </span>
                            </p>
                          </>
                        ) : (
                          <>
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-border font-serif text-[0.72rem] text-ink-muted">
                              Aa
                            </span>
                            <p className="text-[0.7rem] text-ink-soft">
                              No logo —{" "}
                              <span className="text-ink-muted">
                                the brand name is styled as text
                              </span>
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Copy — the card footer, so it's unmistakable the prompt holds
                      the colours + logo shown above. */}
                  <button
                    type="button"
                    onClick={copyKitPrompt}
                    className="flex h-11 w-full items-center justify-center gap-2 border-t border-border bg-surface px-4 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cream cursor-pointer"
                  >
                    {kitCopied ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green">
                          <path d="M3 8.5L6.5 12L13 4" />
                        </svg>
                        Copied — prompt carries your theme
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="5" width="8" height="8" rx="1.5" />
                          <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
                        </svg>
                        Copy the brand-kit prompt
                      </>
                    )}
                  </button>
                </div>

                <div className="relative">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                  <p className="relative mx-auto w-fit bg-surface px-3 text-[0.62rem] font-medium uppercase tracking-[0.15em] text-ink-muted">
                    Then paste both artifacts
                  </p>
                </div>

                {/* Landing artifact */}
                <div>
                  <label htmlFor="landing_html" className={labelClass}>
                    Landing page HTML
                  </label>
                  <textarea
                    id="landing_html"
                    value={landingHtml}
                    onChange={(e) => setLandingHtml(e.target.value)}
                    placeholder="Paste the complete landing-page HTML here…"
                    spellCheck={false}
                    rows={8}
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
                      Valid landing page ({landingHtml.length.toLocaleString()}{" "}
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

                {/* Email-shell artifact */}
                <div>
                  <label htmlFor="email_shell" className={labelClass}>
                    Matching email shell HTML
                  </label>
                  <textarea
                    id="email_shell"
                    value={emailShell}
                    onChange={(e) => setEmailShell(e.target.value)}
                    placeholder="Paste the matching email-shell HTML here…"
                    spellCheck={false}
                    rows={8}
                    className={`w-full resize-none rounded-lg border bg-cream/40 px-3.5 py-2.5 font-mono text-xs text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-muted focus:ring-1 focus:ring-cobalt/20 ${
                      emailShellValidation && !emailShellValidation.ok
                        ? "border-red focus:border-red"
                        : emailShellValidation?.ok
                          ? "border-green focus:border-cobalt"
                          : "border-border focus:border-cobalt"
                    }`}
                  />
                  {emailShellValidation?.ok && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-green">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 6.5L5 9l4.5-6" />
                      </svg>
                      Valid email shell ({emailShell.length.toLocaleString()}{" "}
                      characters)
                    </p>
                  )}
                  {emailShellValidation && !emailShellValidation.ok && (
                    <div className="mt-1 space-y-0.5">
                      {emailShellValidation.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red">
                          {err}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
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
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  disabled={!previewHtml}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[0.62rem] font-medium text-ink-soft transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 2H12v3.5M5.5 12H2V8.5M12 8.5V12H8.5M2 5.5V2h3.5" />
                  </svg>
                  Expand
                </button>
                <button
                  type="button"
                  onClick={openPreviewTab}
                  disabled={!previewHtml}
                  aria-label="Open preview in a new tab"
                  title="Open in a new tab"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-ink-soft transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.5 3H3.4A1.4 1.4 0 0 0 2 4.4v6.2A1.4 1.4 0 0 0 3.4 12h6.2A1.4 1.4 0 0 0 11 10.6V7.5" />
                    <path d="M8.5 2H12v3.5M12 2 6.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>

            {isEmailSurface ? (
              <EmailPreviewFrame
                html={previewHtml}
                status={previewStatus}
                fit
                height={600}
              />
            ) : (
              <LandingPreviewFrame
                html={previewHtml}
                status={previewStatus}
                height={600}
              />
            )}
            <p className="mt-2.5 text-[0.68rem] leading-relaxed text-ink-muted">
              {isEmailSurface
                ? "The sample invitation email, rendered through the real send path."
                : "The candidate apply page, rendered through the real send path."}{" "}
              Expand or open in a new tab for a true-to-size view.
            </p>
          </div>
        </div>
      </div>
      </div>

      {expanded && (
        <ThemePreviewDialog
          initialSurface={previewSurface}
          initialData={previewData}
          payload={previewPayload}
          landingHtml={activeLandingHtml}
          brandName={brandName}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
