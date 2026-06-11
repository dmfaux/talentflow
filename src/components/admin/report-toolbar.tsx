"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  campaignId: string;
}

export function ReportToolbar({ campaignId }: Props) {
  const [copied, setCopied] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const target = document.getElementById("admin-header-slot");
    const defaultContent = document.getElementById("admin-header-default");
    if (defaultContent) defaultContent.style.display = "none";
    setSlot(target);
    return () => {
      if (defaultContent) defaultContent.style.display = "";
    };
  }, []);

  function handlePrint() {
    window.print();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const toolbar = (
    <div className="flex items-center gap-2 print:hidden">
      <button
        onClick={copyLink}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-[0.78rem] font-medium text-txt-secondary shadow-sm transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
      >
        {copied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#067340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5L6 10l5-6" /></svg>
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
      <a
        href={`/api/admin/campaigns/${campaignId}/cvs.zip`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-[0.78rem] font-medium text-txt-secondary shadow-sm transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 2v7M4 6l3 3 3-3" />
          <path d="M2.5 10.5v1a1 1 0 001 1h7a1 1 0 001-1v-1" />
        </svg>
        Download CVs
      </a>
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

  if (!slot) return null;
  return createPortal(toolbar, slot);
}
