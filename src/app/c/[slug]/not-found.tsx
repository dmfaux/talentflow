export default function CampaignPageNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-border">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6.5v4M10 13.5v.01" />
          </svg>
        </div>
        <h1 className="font-serif text-xl italic text-charcoal">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-txt-secondary">
          The campaign page you&apos;re looking for doesn&apos;t exist. Please check the URL or contact the employer for the correct link.
        </p>
      </div>
    </div>
  );
}
