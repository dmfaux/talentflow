"use client";

import { useState } from "react";

// On-demand preview for a bespoke draft (CT6). Unlike ThemeEmailPreview — which
// debounces a live render of the *palette* through the send-path kit — this posts
// the operator's pasted DRAFT HTML to a server endpoint, gets back the rendered
// result (slots resolved with sample data on the server, which owns the render
// because the kits import @/db), and drops it into a sandboxed <iframe srcDoc>.
// The operator clicks "Preview" explicitly: the draft is large and changes in
// bursts, so a debounced live render would be wasteful and jumpy.

export interface BespokePreviewRequest {
  endpoint: string;
  /** The JSON body posted to the endpoint (draft HTML + render context). */
  body: Record<string, unknown>;
}

export function ThemeBespokePreview({
  request,
  height = 520,
  label = "Preview",
}: {
  request: BespokePreviewRequest;
  height?: number;
  label?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  async function run() {
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch(request.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(json.error || "Could not render the preview");
        return;
      }
      setHtml(json.data?.html ?? "");
      setStatus("ready");
    } catch {
      setStatus("error");
      setMessage("Something went wrong");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={run}
          disabled={status === "loading"}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-cream/40 px-4 text-[0.78rem] font-medium text-ink-soft transition-colors hover:bg-cream hover:border-border-strong disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {status === "loading" ? (
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          )}
          {status === "ready" ? "Refresh preview" : label}
        </button>
        {status === "error" && (
          <span className="text-[0.72rem] text-red">{message}</span>
        )}
      </div>

      {status !== "idle" && html !== null && (
        <div
          className="relative overflow-hidden rounded-lg border border-border bg-white"
          style={{ height }}
        >
          <iframe
            srcDoc={html}
            sandbox="allow-same-origin"
            title="Bespoke preview"
            style={{ width: "100%", height: "100%", border: 0 }}
          />
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[0.72rem] font-medium text-ink-muted">
              Rendering…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
