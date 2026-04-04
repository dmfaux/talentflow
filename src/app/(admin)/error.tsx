"use client";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-red-light">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6.5v4M10 13.5v.01" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-charcoal">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-txt-secondary">
          An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
        <button
          onClick={reset}
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-charcoal px-5 text-[0.78rem] font-medium text-white transition-colors hover:bg-charcoal-light cursor-pointer"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
