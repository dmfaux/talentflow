"use client";

import { useEffect, useRef, useState } from "react";

// Shared fetch for the operator theme previews. The render lives on the server
// (src/lib/email.ts + landing.ts import @/db at module scope and can't run in the
// browser), so the builder POSTs an unsaved draft to a preview endpoint and drops
// the returned HTML into a sandboxed <iframe>. This hook is the one place that
// fetch/debounce/abort logic lives, so the inline previews, the card thumbnails,
// and the realistic dialog can never drift apart.

/** The brand/campaign stand-ins the preview routes rendered into the sample,
 *  echoed back so the realistic dialog can label its inbox/browser chrome with
 *  the same values (rather than re-hardcoding them on the client). */
export interface ThemePreviewSample {
  company?: string;
  candidate?: string;
  role?: string;
  department?: string;
  location?: string;
}

export interface ThemePreviewData {
  html: string;
  /** The resolved subject line (email preview only) for the inbox mock. */
  subject?: string;
  sample?: ThemePreviewSample;
}

export type PreviewStatus = "loading" | "ready" | "error";

export function useThemePreview({
  endpoint,
  body,
  debounceMs = 280,
  initialData = null,
}: {
  endpoint: string;
  /** The draft posted to the endpoint; serialised internally to detect changes. */
  body: unknown;
  debounceMs?: number;
  /** Seed the first render (e.g. the dialog reusing the builder's current render),
   *  so opening on the already-loaded surface paints instantly. */
  initialData?: ThemePreviewData | null;
}): { data: ThemePreviewData | null; status: PreviewStatus } {
  const [data, setData] = useState<ThemePreviewData | null>(initialData);
  const [status, setStatus] = useState<PreviewStatus>(
    initialData ? "ready" : "loading"
  );
  // Serialise the body so the fetch effect only re-fires on a real change.
  const key = JSON.stringify(body);
  const firstLoad = useRef(true);

  // A surface switch (the endpoint changes) drops the stale render and forces the
  // next fetch to run immediately — so one surface's HTML never flashes inside the
  // other's frame. Skipped on the initial mount so `initialData` stays on screen.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setData(null);
    setStatus("loading");
    firstLoad.current = true;
  }, [endpoint]);

  useEffect(() => {
    const ctrl = new AbortController();
    const run = () => {
      // Keep the last render visible while a body-only change re-renders (no flash);
      // only fall back to the loading state when there's nothing to show yet.
      setStatus((s) => (s === "ready" ? "ready" : "loading"));
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
        signal: ctrl.signal,
      })
        .then(async (r) => {
          const json = await r.json();
          if (!r.ok) throw new Error(json.error || "Preview failed");
          return json.data as ThemePreviewData;
        })
        .then((d) => {
          setData(d);
          setStatus("ready");
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setStatus("error");
        });
    };
    // No debounce on a first load (mount or surface switch) — show something now.
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
  }, [endpoint, key, debounceMs]);

  return { data, status };
}
