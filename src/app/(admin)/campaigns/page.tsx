"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";

interface Campaign {
  id: string;
  client_name: string | null;
  client_slug: string | null;
  slug: string;
  role_title: string;
  department: string | null;
  location: string | null;
  status: string;
  campaign_start: string | null;
  campaign_end: string | null;
  created_at: string;
}

const TABS = ["all", "active", "draft", "closed"] as const;
type Tab = (typeof TABS)[number];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream text-txt-secondary",
  active: "bg-green-light text-green",
  paused: "bg-warning-light text-warning",
  closed: "bg-red-light text-red",
  archived: "bg-cream text-txt-muted",
};

function daysRemaining(end: string | null): string {
  if (!end) return "No end date";
  const diff = Math.ceil(
    (new Date(end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return "Ended";
  if (diff === 0) return "Ends today";
  return `${diff}d remaining`;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    fetch("/api/admin/campaigns")
      .then((r) => r.json())
      .then((res) => setCampaigns(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered =
    tab === "all"
      ? campaigns
      : campaigns.filter((c) => c.status === tab);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Campaigns</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            {loading ? "Loading..." : `${campaigns.length} total`}
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          New Campaign
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="mb-5 flex gap-1 rounded-lg bg-cream p-1 w-fit border border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-[0.78rem] font-medium capitalize transition-colors cursor-pointer ${
              tab === t
                ? "bg-surface text-charcoal shadow-sm"
                : "text-txt-muted hover:text-txt-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Campaign cards */}
      {loading ? (
        <div className="py-20 text-center text-sm text-txt-muted">
          Loading campaigns...
        </div>
      ) : filtered.length === 0 ? (
        tab === "all" ? (
          <EmptyState
            icon="campaigns"
            title="No campaigns yet"
            description="Create your first campaign to start screening candidates with AI-powered assessments."
            actionLabel="Create Campaign"
            actionHref="/campaigns/new"
          />
        ) : (
          <EmptyState
            icon="campaigns"
            title={`No ${tab} campaigns`}
            description={`There are no campaigns with "${tab}" status right now.`}
          />
        )
      ) : (
        <div className="space-y-3">
          {filtered.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.id}`}
              className="group block rounded-xl border border-border bg-surface p-5 transition-all hover:border-border-strong hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-sm font-semibold text-charcoal group-hover:text-accent transition-colors">
                      {campaign.role_title}
                    </h3>
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium ${
                        STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft
                      }`}
                    >
                      {campaign.status}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-txt-secondary">
                    <span>{campaign.client_name ?? "No client"}</span>
                    {campaign.department && (
                      <>
                        <span className="text-txt-muted">&middot;</span>
                        <span>{campaign.department}</span>
                      </>
                    )}
                    {campaign.location && (
                      <>
                        <span className="text-txt-muted">&middot;</span>
                        <span>{campaign.location}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="ml-6 flex flex-col items-end gap-1 shrink-0">
                  <span className="font-mono text-xs text-txt-muted">
                    {daysRemaining(campaign.campaign_end)}
                  </span>
                  <span className="font-mono text-[0.65rem] text-txt-muted">
                    {campaign.client_slug}/{campaign.slug}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
