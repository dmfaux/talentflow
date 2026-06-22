"use client";

import { useEffect, useRef, useState } from "react";
import type { ThemePreviewPayload } from "./theme-email-preview";

// Live landing-page preview — the landing analogue of ThemeEmailPreview. Posts
// the theme draft to POST /api/operator/themes/landing-preview (the server owns
// the render because makeLandingTemplate is paired there with the draft→EmailTheme
// assembly) and drops the returned HTML into a sandboxed <iframe srcDoc>. The
// fetch is debounced so rapid palette/copy edits don't hammer the server.
//
// When a VALID bespoke `landingHtml` is supplied the endpoint renders that pasted
// page (real precedence); otherwise it renders the palette-generated landing from
// the draft — so the right-column preview always shows what a candidate would get.

export function ThemeLandingPreview({
  payload,
  /** A validated bespoke landing to preview instead of the generated page. */
  landingHtml,
  height = 560,
  debounceMs = 280,
}: {
  payload: ThemePreviewPayload;
  landingHtml?: string;
  height?: number;
  debounceMs?: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Only send a bespoke landing when there is one; an empty string would still
  // take the "pasted" branch and 400 on the slot/mount contract.
  const body = landingHtml?.trim()
    ? { ...payload, landing_html: landingHtml }
    : payload;
  const key = JSON.stringify(body);
  const firstLoad = useRef(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const run = () => {
      setStatus((s) => (s === "ready" ? "ready" : "loading"));
      fetch("/api/operator/themes/landing-preview", {
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
          title="Landing preview"
          style={{ width: "100%", height, border: 0 }}
        />
      )}
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[0.7rem] font-medium text-ink-muted">
          Rendering…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white px-4 text-center text-[0.7rem] font-medium text-red">
          Preview unavailable — check the palette and landing copy.
        </div>
      )}
    </div>
  );
}
