"use client";

import { useState } from "react";

export function ReportToolbar() {
  const [copied, setCopied] = useState(false);

  function handlePrint() {
    window.print();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // TODO: Generate a public share link with a time-limited token
  // so clients can view the report without admin auth.

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2 print:hidden">
      <button
        onClick={copyLink}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-[0.78rem] font-medium text-txt-secondary shadow-sm transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
      >
        {copied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5L6 10l5-6" /></svg>
            Copied
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="5" width="7" height="7" rx="1" />
              <path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" />
            </svg>
            Copy Link
          </>
        )}
      </button>
      <button
        onClick={handlePrint}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.78rem] font-medium text-white shadow-sm transition-colors hover:bg-accent-light cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 5V2h7v3M3.5 10H2.5a1 1 0 01-1-1V6.5a1 1 0 011-1h9a1 1 0 011 1V9a1 1 0 01-1 1h-1" />
          <rect x="3.5" y="8.5" width="7" height="4" rx="0.5" />
        </svg>
        Print Report
      </button>
    </div>
  );
}
