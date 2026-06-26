import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { COMPANY } from "./company";

/** A single entry in the "On this page" contents list — `id` must match the
 *  matching `<section id>` / heading anchor in the page body. */
export interface TocItem {
  id: string;
  label: string;
}

interface LegalPageProps {
  /** Small uppercase tag above the title (defaults to "Legal"). */
  eyebrow?: string;
  title: string;
  /** Human-readable effective/last-updated date. */
  updated: string;
  /** Lead paragraph(s) shown beneath the title. */
  intro: React.ReactNode;
  /** Optional table of contents rendered as anchor links. */
  toc?: TocItem[];
  /** Route of the current document, so the cross-doc nav can mark it active. */
  current: "/privacy" | "/popia" | "/terms";
  /** The document body — plain semantic HTML, styled by `.legal-prose`. */
  children: React.ReactNode;
}

const DOCUMENTS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/popia", label: "POPIA Notice" },
  { href: "/terms", label: "Terms & Conditions" },
] as const;

/**
 * Shared chrome for the public legal pages (Privacy, POPIA, Terms). Provides the
 * masthead, title block, cross-document navigation, an optional contents list and
 * a consistent closing disclaimer, then renders the document body inside the
 * `.legal-prose` reading styles defined in globals.css.
 */
export function LegalPage({
  eyebrow = "Legal",
  title,
  updated,
  intro,
  toc,
  current,
  children,
}: LegalPageProps) {
  return (
    <div className="bg-canvas min-h-screen text-pretty">
      <header className="sticky top-0 z-40 border-b border-rule bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1080px] items-center justify-between px-6 sm:px-10">
          <Logo size="md" href="/" animate={false} />
          <Link
            href="/"
            className="link-underline text-[0.85rem] text-ink-muted transition-colors hover:text-cobalt"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-16 sm:px-10 sm:py-20">
        <p className="eyebrow mb-4 text-cobalt">{eyebrow}</p>
        <h1 className="font-display text-4xl leading-[1.05] text-ink sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 font-mono text-[0.72rem] uppercase tracking-wide text-ink-muted">
          Last updated {updated}
        </p>

        <div className="mt-7 text-[1.02rem] leading-[1.7] text-ink-soft [&_a]:text-cobalt [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-4">
          {intro}
        </div>

        <nav
          aria-label="Legal documents"
          className="mt-8 flex flex-wrap gap-2"
        >
          {DOCUMENTS.map((doc) => {
            const active = doc.href === current;
            return (
              <Link
                key={doc.href}
                href={doc.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-full border border-cobalt bg-cobalt-tint px-3.5 py-1.5 text-[0.8rem] font-medium text-cobalt-deep"
                    : "rounded-full border border-rule bg-paper px-3.5 py-1.5 text-[0.8rem] text-ink-soft transition-colors hover:border-cobalt hover:text-cobalt"
                }
              >
                {doc.label}
              </Link>
            );
          })}
        </nav>

        {toc && toc.length > 0 && (
          <nav
            aria-label="On this page"
            className="mt-10 rounded-xl border border-rule bg-paper p-6"
          >
            <p className="eyebrow mb-3 text-ink-muted">On this page</p>
            <ol className="space-y-2">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-[0.9rem] text-ink-soft transition-colors hover:text-cobalt"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <article className="legal-prose mt-12">{children}</article>

        <footer className="mt-16 border-t border-rule pt-8">
          <p className="text-[0.82rem] leading-[1.65] text-ink-muted">
            This document forms part of {COMPANY.shortName}&rsquo;s online legal
            terms and is published for transparency and compliance with South
            African law. It does not constitute legal advice. If anything here is
            unclear, or to exercise a right described in our{" "}
            <Link href="/popia" className="text-cobalt underline underline-offset-2">
              POPIA Notice
            </Link>
            , contact us at{" "}
            <a
              href={`mailto:${COMPANY.privacyEmail}`}
              className="text-cobalt underline underline-offset-2"
            >
              {COMPANY.privacyEmail}
            </a>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}
