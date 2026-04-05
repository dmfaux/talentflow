"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface Props {
  activeTab: string;
  shortlistCount: number;
  campaignId: string;
}

export function CampaignTabs({ activeTab, shortlistCount, campaignId }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function setTab(tab: string) {
    const params = new URLSearchParams();
    if (tab !== "candidates") params.set("tab", tab);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-5 flex items-center justify-between">
      <div className="flex gap-1 rounded-lg bg-cream p-1 border border-border">
        <button
          onClick={() => setTab("candidates")}
          className={`rounded-md px-4 py-1.5 text-[0.78rem] font-medium transition-colors cursor-pointer ${
            activeTab === "candidates"
              ? "bg-surface text-charcoal shadow-sm"
              : "text-txt-muted hover:text-txt-secondary"
          }`}
        >
          All Candidates
        </button>
        <button
          onClick={() => setTab("shortlist")}
          className={`rounded-md px-4 py-1.5 text-[0.78rem] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === "shortlist"
              ? "bg-surface text-charcoal shadow-sm"
              : "text-txt-muted hover:text-txt-secondary"
          }`}
        >
          Shortlist
          {shortlistCount > 0 && (
            <span className="inline-flex h-4.5 min-w-[1.125rem] items-center justify-center rounded-full bg-gold/15 px-1.5 font-mono text-[0.6rem] font-semibold text-gold">
              {shortlistCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "shortlist" && shortlistCount > 0 && (
        <a
          href={`/campaigns/${campaignId}/report`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[0.75rem] font-medium text-ink transition-colors hover:bg-accent-light hover:text-white"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
            <path d="M6 5h4M6 8h4M6 11h2" />
          </svg>
          Generate Report
        </a>
      )}
    </div>
  );
}
