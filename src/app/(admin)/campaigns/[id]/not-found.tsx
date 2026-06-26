import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function CampaignNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
            <circle cx="10" cy="10" r="8" />
            <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-ink">Campaign not found</h2>
        <p className="mt-2 text-sm text-ink-soft">
          This campaign may have been deleted or the URL is incorrect.
        </p>
        <Link href="/campaigns" className={`mt-5 ${buttonVariants({ size: "md" })}`}>
          Back to campaigns
        </Link>
      </div>
    </div>
  );
}
