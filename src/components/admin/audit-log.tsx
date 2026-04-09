"use client";

import { useState } from "react";

interface LogEntry {
  id: string;
  scoring_type: string;
  model_version: string;
  score: number | null;
  processing_time_ms: number | null;
  full_prompt: string;
  full_response: string;
  created_at: string;
}

interface Props {
  logs: LogEntry[];
}

export function AuditLog({ logs }: Props) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (logs.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 cursor-pointer"
      >
        <h3 className="text-sm font-semibold text-charcoal">
          Scoring Audit Log
          <span className="ml-2 font-mono text-xs font-normal text-txt-muted">
            {logs.length}
          </span>
        </h3>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`text-txt-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M3.5 5.5L7 9l3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {logs.map((log) => (
            <div key={log.id} className="px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[0.6rem] font-medium ${
                    log.scoring_type === "initial"
                      ? "bg-cream text-txt-secondary"
                      : "bg-accent/10 text-accent"
                  }`}>
                    {log.scoring_type === "initial" ? "Initial" : "Re-assessment"}
                  </span>
                  <span className="font-mono text-txt-muted">
                    {new Date(log.created_at).toLocaleString("en-ZA")}
                  </span>
                  <span className="text-txt-secondary">{log.model_version}</span>
                  {log.processing_time_ms !== null && (
                    <span className="font-mono text-txt-muted">
                      {(log.processing_time_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                  {log.score !== null && (
                    <span className="font-mono font-semibold text-charcoal">
                      {log.score.toFixed(1)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() =>
                    setExpandedId(expandedId === log.id ? null : log.id)
                  }
                  className="text-[0.7rem] font-medium text-accent hover:underline cursor-pointer"
                >
                  {expandedId === log.id ? "Hide" : "View Prompt/Response"}
                </button>
              </div>

              {expandedId === log.id && (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="mb-1 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                      Prompt
                    </p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-cream p-3 font-mono text-[0.7rem] leading-relaxed text-charcoal whitespace-pre-wrap">
                      {log.full_prompt}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                      Response
                    </p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-cream p-3 font-mono text-[0.7rem] leading-relaxed text-charcoal whitespace-pre-wrap">
                      {log.full_response}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
