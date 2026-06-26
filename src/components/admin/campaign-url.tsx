"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast-provider";

interface Props {
  /**
   * The landing-page URL as built server-side: absolute (https://…) in
   * production, root-relative (/c/…) in development. We resolve relative URLs
   * against the current origin on copy so the clipboard always holds a complete,
   * shareable link.
   */
  url: string;
}

export function CampaignUrl({ url }: Props) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const display = url.replace(/^https?:\/\//, "");

  async function copy() {
    const absolute = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      toast("Landing page URL copied", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't copy — select the link to copy it manually", "error");
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-cobalt hover:underline"
      >
        {display}
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy landing page URL"
        title={copied ? "Copied" : "Copy landing page URL"}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-muted transition-colors hover:bg-canvas hover:text-ink cursor-pointer"
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-moss">
            <path d="M3 7.5L6 10l5-6" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="5" y="5" width="7" height="7" rx="1" />
            <path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" />
          </svg>
        )}
      </button>
    </span>
  );
}
