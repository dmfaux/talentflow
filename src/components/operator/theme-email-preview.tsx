"use client";

import { useEffect, useRef, useState } from "react";

// Live email preview rendered through the operator-gated server endpoint
// (POST /api/operator/themes/preview). The endpoint owns the render because
// src/lib/email.ts imports @/db and so can't run in the browser. The returned
// HTML is dropped into a sandboxed <iframe srcDoc>; the fetch is debounced so
// rapid palette edits don't hammer the server.

export interface ThemePreviewPayload {
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
  debounceMs = 280,
}: {
  payload: ThemePreviewPayload;
  contentWidth?: number;
  scale?: number;
  height?: number;
  debounceMs?: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Serialise the payload so the effect only re-fires on a real change.
  const key = JSON.stringify(payload);
  const firstLoad = useRef(true);

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
      className="relative overflow-hidden rounded-lg bg-white"
      style={{ height, width: "100%" }}
    >
      {html !== null && (
        <iframe
          srcDoc={html}
          sandbox="allow-same-origin"
          title="Email preview"
          aria-hidden={scale < 1}
          tabIndex={scale < 1 ? -1 : 0}
          style={{
            width: contentWidth,
            height: scale < 1 ? height / scale : height,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            pointerEvents: scale < 1 ? "none" : "auto",
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
