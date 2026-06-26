"use client";

import { useRouter, usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";

interface Props {
  activeTab: string;
  shortlistCount: number;
  campaignId: string;
}

const TABS = [
  { key: "candidates", label: "All candidates" },
  { key: "shortlist", label: "Shortlist" },
  { key: "spend", label: "AI spend" },
] as const;

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
      <div role="tablist" className="flex gap-1 rounded-lg border border-rule bg-canvas p-1">
        {TABS.map(({ key, label }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[0.78rem] font-medium transition-colors cursor-pointer ${
                active
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink-soft"
              }`}
            >
              {label}
              {key === "shortlist" && shortlistCount > 0 && (
                <span className="inline-flex h-4.5 min-w-[1.125rem] items-center justify-center rounded-full bg-moss-soft px-1.5 font-mono text-[0.6rem] font-semibold text-moss-deep">
                  {shortlistCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === "shortlist" && shortlistCount > 0 && (
        <a
          href={`/campaigns/${campaignId}/report`}
          className={buttonVariants({ size: "sm" })}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
            <path d="M6 5h4M6 8h4M6 11h2" />
          </svg>
          Generate report
        </a>
      )}
    </div>
  );
}
