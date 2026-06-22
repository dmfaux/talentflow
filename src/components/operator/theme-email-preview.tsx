"use client";

import { useEffect, useRef, useState } from "react";

// Live email preview rendered through the operator-gated server endpoint
// (POST /api/operator/themes/preview). The endpoint owns the render because
// src/lib/email.ts imports @/db and so can't run in the browser. The returned
// HTML is dropped into a sandboxed <iframe srcDoc>; the fetch is debounced so
// rapid palette edits don't hammer the server.

// The draft shape posted to the live-preview endpoint. CT7 authoring is
// seed + font-key + structured-copy based (the new server contract), but we
// ALSO send the derived `palette` and resolved font stacks so the preview keeps
// rendering whether the route reads the new keys or the legacy fields — the
// builder owns deriving both from the seeds/keys, so they never disagree.
export interface ThemePreviewPayload {
  // New (CT7) authoring inputs — the server derives the palette/stacks from these.
  // OPTIONAL: the live builder sends them, but card thumbnails replay a SAVED row
  // that only carries the resolved palette/stacks, so they may be absent.
  seeds?: { primary: string; accent: string; bg: string };
  font_display_key?: string;
  font_body_key?: string;
  landing_copy?: unknown;
  email_copy?: unknown;
  // Compatibility mirror — the derived (or saved) 11-token palette + CSS stacks.
  palette: Record<string, string>;
  font_display: string;
  font_sans: string;
  logo_url: string | null;
  logo_background: string;
  logo_position: string;
  show_powered_by: boolean;
}

export function ThemeEmailPreview({
  payload,
  /** Rendered email width in px before scaling. */
  contentWidth = 580,
  /** Visual scale — 1 for the builder, ~0.45 for a card thumbnail. */
  scale = 1,
  /** Visible height of the scaled frame. */
  height = 520,
  /** Auto-fit the full-width email into the container, scaling it down so the
   *  whole email is always visible (never clipped). Overrides `scale`. */
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
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Serialise the payload so the effect only re-fires on a real change.
  const key = JSON.stringify(payload);
  const firstLoad = useRef(true);

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

  useEffect(() => {
    const ctrl = new AbortController();
    const run = () => {
      setStatus((s) => (s === "ready" ? "ready" : "loading"));
      fetch("/api/operator/themes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
        signal: ctrl.signal,
      })
        .then(async (r) => {
          const json = await r.json();
          if (!r.ok) throw new Error(json.error || "Preview failed");
          return json.data.html as string;
        })
        .then((h) => {
          setHtml(h);
          setStatus("ready");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setStatus("error");
        });
    };
    // No debounce on the very first render — show something immediately.
    if (firstLoad.current) {
      firstLoad.current = false;
      run();
      return () => ctrl.abort();
    }
    const t = setTimeout(run, debounceMs);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [key, debounceMs]);

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
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[0.7rem] font-medium text-ink-muted">
          Rendering…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white px-4 text-center text-[0.7rem] font-medium text-red">
          Preview unavailable — check the palette values.
        </div>
      )}
    </div>
  );
}
