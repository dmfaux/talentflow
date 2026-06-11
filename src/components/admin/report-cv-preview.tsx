"use client";

import { useEffect, useState } from "react";

interface Props {
  candidateId: string;
  filename: string;
  expandedByDefault: boolean;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; url: string; isPdf: boolean }
  | { kind: "error"; message: string };

function isPdf(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

export function ReportCvPreview({ candidateId, filename, expandedByDefault }: Props) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });

  async function ensureLoaded() {
    // Errors stay retryable — only skip when a load is in flight or done.
    if (load.kind === "loading" || load.kind === "ready") return;
    setLoad({ kind: "loading" });
    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}/cv`);
      if (!res.ok) {
        setLoad({ kind: "error", message: "Could not load CV" });
        return;
      }
      const payload = (await res.json()) as { data?: { url?: string } };
      const url = payload.data?.url;
      if (!url) {
        setLoad({ kind: "error", message: "Could not load CV" });
        return;
      }
      setLoad({ kind: "ready", url, isPdf: isPdf(filename) });
    } catch {
      setLoad({ kind: "error", message: "Could not load CV" });
    }
  }

  useEffect(() => {
    if (expandedByDefault) void ensureLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) void ensureLoaded();
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="eyebrow text-txt-muted">Curriculum Vitae</span>
          <span className="font-mono text-[0.72rem] text-txt-muted">{filename}</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="cursor-pointer font-mono text-[0.7rem] uppercase tracking-[0.12em] text-txt-secondary transition-colors hover:text-charcoal print:hidden"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 print:hidden">
          {load.kind === "loading" && (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-paper">
              <span className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-txt-muted">
                Loading CV…
              </span>
            </div>
          )}

          {load.kind === "error" && (
            <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-paper">
              <span className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-red">
                {load.message}
              </span>
              <button
                type="button"
                onClick={() => void ensureLoaded()}
                className="cursor-pointer font-mono text-[0.7rem] uppercase tracking-[0.12em] text-txt-secondary transition-colors hover:text-charcoal"
              >
                Retry
              </button>
            </div>
          )}

          {load.kind === "ready" && load.isPdf && (
            <iframe
              src={`${load.url}#toolbar=0&navpanes=0`}
              title={`CV for ${filename}`}
              className="h-[720px] w-full rounded-lg border border-border bg-paper"
            />
          )}

          {load.kind === "ready" && !load.isPdf && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-paper px-6 py-10">
              <p className="text-center text-[0.85rem] leading-relaxed text-txt-secondary">
                Inline preview is only available for PDF CVs.
                <br />
                Download the original file to view it.
              </p>
              <a
                href={load.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
              >
                Download CV
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
