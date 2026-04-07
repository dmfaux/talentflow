import Link from "next/link";

export default function CampaignNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-cream">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#9fb5c4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8" />
            <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-charcoal">Campaign not found</h2>
        <p className="mt-2 text-sm text-txt-secondary">
          This campaign may have been deleted or the URL is incorrect.
        </p>
        <Link
          href="/campaigns"
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-charcoal px-5 text-[0.78rem] font-medium text-white transition-colors hover:bg-charcoal-light"
        >
          Back to Campaigns
        </Link>
      </div>
    </div>
  );
}
