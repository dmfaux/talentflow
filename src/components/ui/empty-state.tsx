import Link from "next/link";

interface Props {
  icon: "campaigns" | "candidates" | "shortlist" | "messages";
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}

const ICONS: Record<string, React.ReactNode> = {
  campaigns: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8e96ad" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  ),
  candidates: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8e96ad" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
    </svg>
  ),
  shortlist: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8e96ad" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.2H22l-6 4.5 2.3 7.3L12 16.5 5.7 21l2.3-7.3-6-4.5h7.6z" />
    </svg>
  ),
  messages: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8e96ad" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H8l-4 4V6a2 2 0 012-2z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  ),
};

export function EmptyState({ icon, title, description, actionLabel, actionHref }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-cream">
        {ICONS[icon]}
      </div>
      <h3 className="text-sm font-semibold text-charcoal">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-txt-muted">
        {description}
      </p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 inline-flex h-8 items-center rounded-lg bg-accent px-4 text-[0.75rem] font-medium text-white transition-colors hover:bg-accent-light"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
