"use client";

import { useEffect, useRef, useState } from "react";
import { useThemePreview, type PreviewStatus } from "./use-theme-preview";

// Live email preview rendered through the operator-gated server endpoint
// (POST /api/operator/themes/preview). The returned HTML is dropped into a
// sandboxed <iframe srcDoc>. The fetch + debounce live in useThemePreview; this
// file owns only how that HTML is framed on screen.

// The draft shape posted to the live-preview endpoint. CT7 authoring is
// seed + font-key based (the server contract), but we ALSO send the derived
// `palette` and resolved font stacks so the preview keeps rendering whether the
// route reads the new keys or the legacy fields — the builder owns deriving both
// from the seeds/keys, so they never disagree.
export interface ThemePreviewPayload {
  // New (CT7) authoring inputs — the server derives the palette/stacks from these.
  // OPTIONAL: the live builder sends them, but card thumbnails replay a SAVED row
  // that only carries the resolved palette/stacks, so they may be absent.
  seeds?: { primary: string; accent: string; bg: string };
  // Per-token overrides layered over the seed-derived palette; the server merges
  // them when re-deriving so the preview matches a saved theme exactly.
  palette_overrides?: Partial<Record<string, string>>;
  font_display_key?: string;
  font_body_key?: string;
  // The bespoke email shell (custom themes only); the email preview renders the
  // sample email through it. Absent/null → the in-code default chrome.
  email_shell?: string | null;
  // The brand's real name (e.g. "MTN Networks"), drawn into the sample in place of
  // the default stand-in so the preview reads like this brand's send. Absent (e.g.
  // gallery themes) → the route falls back to its default sample company.
  brand_name?: string;
  // Compatibility mirror — the derived (or saved) 11-token palette + CSS stacks.
  palette: Record<string, string>;
  font_display: string;
  font_sans: string;
  logo_url: string | null;
  logo_background: string;
  logo_position: string;
  show_powered_by: boolean;
}

/** The loading/error veil shared by every preview frame. Loading is translucent
 *  so a re-render dims the prior iframe rather than blanking it; error is opaque. */
export function PreviewStatusOverlay({
  status,
  errorText,
}: {
  status: PreviewStatus;
  errorText: string;
}) {
  if (status === "loading") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[0.7rem] font-medium text-ink-muted">
        Rendering…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white px-4 text-center text-[0.7rem] font-medium text-red">
        {errorText}
      </div>
    );
  }
  return null;
}

/** Pure render of an already-fetched email — the controlled frame used by the
 *  builder (which owns the fetch so the same HTML feeds the new-tab / expand
 *  actions) and, via the wrapper below, by the card thumbnails. */
export function EmailPreviewFrame({
  html,
  status,
  /** Rendered email width in px before scaling. */
  contentWidth = 580,
  /** Visual scale — 1 for the builder, ~0.45 for a card thumbnail. */
  scale = 1,
  /** Visible height of the scaled frame. */
  height = 520,
  /** Auto-fit the full-width email into the container, scaling it down so the
   *  whole email is always visible (never clipped). Overrides `scale`. */
  fit = false,
}: {
  html: string | null;
  status: PreviewStatus;
  contentWidth?: number;
  scale?: number;
  height?: number;
  fit?: boolean;
}) {
  // Fit mode: measure the container and scale the 580px email down to fit it,
  // so the whole email shows at any column width (never clipped, never tiny).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState<number | null>(null);
  useEffect(() => {
    if (!fit) return;
    const el = wrapRef.current;
    if (!el) return;
    const measure = () =>
      setFitScale(Math.min(1, el.clientWidth / contentWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, contentWidth]);

  // The effective scale: the fitted value when fitting, else the explicit prop.
  const effScale = fit ? fitScale ?? scale : scale;
  // A sub-1 scale only means "non-interactive thumbnail" when NOT fitting; a
  // fitted preview is the primary preview and stays perceivable.
  const isThumb = !fit && scale < 1;

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-lg bg-white"
      style={{ height, width: "100%" }}
    >
      {html !== null && (
        <iframe
          srcDoc={html}
          sandbox="allow-same-origin"
          title="Email preview"
          aria-hidden={isThumb}
          tabIndex={isThumb ? -1 : 0}
          style={{
            width: contentWidth,
            height: effScale < 1 ? height / effScale : height,
            border: 0,
            transform: `scale(${effScale})`,
            transformOrigin: "top left",
            pointerEvents: isThumb ? "none" : "auto",
          }}
        />
      )}
      <PreviewStatusOverlay
        status={status}
        errorText="Preview unavailable — check the palette values."
      />
    </div>
  );
}

/** Self-fetching email preview — used by the theme-gallery card thumbnails, which
 *  hand it a saved row's palette/stacks and want it to render on its own. The
 *  builder uses EmailPreviewFrame directly (it owns the fetch). */
export function ThemeEmailPreview({
  payload,
  contentWidth = 580,
  scale = 1,
  height = 520,
  fit = false,
  debounceMs = 280,
}: {
  payload: ThemePreviewPayload;
  contentWidth?: number;
  scale?: number;
  height?: number;
  fit?: boolean;
  debounceMs?: number;
}) {
  const { data, status } = useThemePreview({
    endpoint: "/api/operator/themes/preview",
    body: payload,
    debounceMs,
  });
  return (
    <EmailPreviewFrame
      html={data?.html ?? null}
      status={status}
      contentWidth={contentWidth}
      scale={scale}
      height={height}
      fit={fit}
    />
  );
}
