"use client";

import { buildEmailTemplatePrompt } from "@/lib/email-prompt-builder";
import {
  EMAIL_SLOT_SPECS,
  EMAIL_TEMPLATE_TYPES,
  type EmailTemplateMap,
  type EmailTemplateType,
  validateEmailTemplate,
} from "@/lib/email-slots";
import type { BrandColors, LogoInput } from "@/lib/prompt-builder";
import {
  DEFAULT_EMAIL_COPY,
  type EmailCopyPerType,
} from "@/lib/theme-copy";
import { useState } from "react";
import { ThemeBespokePreview } from "./theme-bespoke-preview";

// ── Bespoke per-template email authoring (CT6 · section B) ───────────
//
// One tab per candidate-facing email (EMAIL_TEMPLATE_TYPES). For the selected
// type the operator copies a per-template AI prompt (purpose, tone, slot
// contract + the required action link baked in by buildEmailTemplatePrompt),
// pastes the returned HTML, sees live per-type validation (validateEmailTemplate
// — chatInvitation/chatAccess/chatNudge reject a missing {{action.url}}), and
// renders a server-side preview. The map is sparse: only authored types persist.

const labelClass =
  "mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

/** Tier-flip for the copied prompt (CT4 parity): bespoke emails are Premium+ only,
 *  so the prompt always embeds the brand colours and drops the powered-by footer. */
const PREMIUM_TIER = "premium";

interface PreviewTheme {
  // New (CT7) authoring inputs.
  seeds?: { primary: string; accent: string; bg: string };
  font_display_key?: string;
  font_body_key?: string;
  landing_copy?: unknown;
  email_copy?: unknown;
  // Compatibility mirror.
  palette: Record<string, string>;
  font_display: string;
  font_sans: string;
  logo_url: string | null;
  logo_background: string;
  logo_position: string;
  show_powered_by: boolean;
}

/** The sparse structured per-type copy map authored in this section (CT7). */
export type PerTypeCopyMap = Partial<Record<EmailTemplateType, EmailCopyPerType>>;

export function ThemeBespokeEmails({
  value,
  onChange,
  perTypeCopy,
  onChangePerTypeCopy,
  brandColors,
  logo,
  previewTheme,
}: {
  /** The sparse authored full-HTML override map (keyed by email template type). */
  value: EmailTemplateMap;
  onChange: (next: EmailTemplateMap) => void;
  /** The sparse structured copy map: per type {subject, body} (CT7). */
  perTypeCopy: PerTypeCopyMap;
  onChangePerTypeCopy: (next: PerTypeCopyMap) => void;
  brandColors: BrandColors | null;
  logo: LogoInput | null;
  /** The current theme draft, posted to the preview endpoint alongside the draft. */
  previewTheme: PreviewTheme;
}) {
  const [active, setActive] = useState<EmailTemplateType>(EMAIL_TEMPLATE_TYPES[0]);
  const [brief, setBrief] = useState("");
  const [copied, setCopied] = useState<EmailTemplateType | null>(null);

  const spec = EMAIL_SLOT_SPECS[active];
  const html = value[active] ?? "";
  // Structured copy for the active type. Subject seeds from the default; body is
  // blank by default and means "use the default copy" when left empty.
  const defaultSubject = DEFAULT_EMAIL_COPY.perType[active]?.subject ?? "";
  const subject = perTypeCopy[active]?.subject ?? defaultSubject;
  const body = perTypeCopy[active]?.body ?? "";
  const validation = html.trim() ? validateEmailTemplate(active, html) : null;
  const authoredCount = EMAIL_TEMPLATE_TYPES.filter((t) =>
    (value[t] ?? "").trim()
  ).length;

  function setHtml(next: string) {
    const out: EmailTemplateMap = { ...value };
    if (next.trim()) out[active] = next;
    else delete out[active];
    onChange(out);
  }

  // Rebuild the active type's structured-copy entry from the two fields. Keep the
  // subject (seeded from the default, always meaningful); omit a blank body. Drop
  // the entry entirely when nothing meaningful is set (subject left at the default
  // and the body blank), so the persisted map stays sparse.
  function writeCopy(nextSubject: string, nextBody: string) {
    const out: PerTypeCopyMap = { ...perTypeCopy };
    const trimmedSubject = nextSubject.trim();
    const trimmedBody = nextBody.trim();
    const entry: EmailCopyPerType = {};
    if (trimmedSubject) entry.subject = trimmedSubject;
    if (trimmedBody) entry.body = trimmedBody;
    const meaningful =
      (trimmedSubject && trimmedSubject !== defaultSubject) || !!trimmedBody;
    if (meaningful) out[active] = entry;
    else delete out[active];
    onChangePerTypeCopy(out);
  }

  function setSubject(next: string) {
    writeCopy(next, body);
  }

  function setBody(next: string) {
    writeCopy(subject, next);
  }

  const copyAuthoredCount = EMAIL_TEMPLATE_TYPES.filter(
    (t) => perTypeCopy[t]?.subject || perTypeCopy[t]?.body
  ).length;

  function copyPrompt() {
    const prompt = buildEmailTemplatePrompt({
      type: active,
      brief: brief.trim() || null,
      brandColors,
      logo,
      tier: PREMIUM_TIER,
    });
    navigator.clipboard?.writeText(prompt).then(() => {
      setCopied(active);
      setTimeout(() => setCopied((c) => (c === active ? null : c)), 2000);
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-base text-ink">Bespoke emails</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            Tune the subject and copy for any of the nine candidate emails, or
            rewrite one entirely. Untouched types fall back to the themed default.
          </p>
        </div>
        {authoredCount + copyAuthoredCount > 0 && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-cobalt-tint px-2.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-cobalt">
            {authoredCount > 0 && `${authoredCount} rewritten`}
            {authoredCount > 0 && copyAuthoredCount > 0 && " · "}
            {copyAuthoredCount > 0 && `${copyAuthoredCount} tuned`}
          </span>
        )}
      </div>

      {/* Type tabs */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {EMAIL_TEMPLATE_TYPES.map((type) => {
          const isActive = type === active;
          const isAuthored =
            (value[type] ?? "").trim().length > 0 ||
            !!perTypeCopy[type]?.subject ||
            !!perTypeCopy[type]?.body;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setActive(type)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[0.72rem] font-medium transition-colors cursor-pointer ${
                isActive
                  ? "border-cobalt bg-cobalt-tint text-cobalt"
                  : "border-border bg-cream/40 text-ink-soft hover:border-border-strong"
              }`}
            >
              {isAuthored && (
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isActive ? "bg-cobalt" : "bg-cobalt/60"
                  }`}
                  aria-hidden="true"
                />
              )}
              {EMAIL_SLOT_SPECS[type].label}
            </button>
          );
        })}
      </div>

      {/* Active type editor */}
      <div className="mt-5 space-y-4">
        <div className="rounded-lg border border-border bg-cream/30 p-3.5">
          <p className="text-[0.78rem] leading-relaxed text-ink-soft">{spec.purpose}</p>
          {spec.required.length > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-vermillion/10 px-2 py-1 text-[0.68rem] font-medium text-vermillion">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 1.5L10.5 9.5h-9L6 1.5z" />
                <path d="M6 5v2" />
                <path d="M6 8.5v.01" />
              </svg>
              Must include {spec.required.map((s) => `{{${s}}}`).join(", ")} — a
              clickable action link, or the candidate dead-ends.
            </p>
          )}
        </div>

        {/* Structured copy (CT7): subject line + optional body override. Lighter
            than the full-HTML rewrite below — recolours the default layout with
            this brand's words. Body blank ⇒ the template's default copy stands. */}
        <div className="rounded-lg border border-border bg-cream/20 p-4">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Copy
          </p>
          <div className="mt-3 space-y-4">
            <div>
              <label htmlFor={`email_subject_${active}`} className={labelClass}>
                Subject line
              </label>
              <input
                id={`email_subject_${active}`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={defaultSubject}
                className="h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20"
              />
              <p className="mt-1 text-[0.68rem] text-ink-faint">
                Slots like{" "}
                <code className="font-mono text-ink-muted">
                  {"{{campaign.role_title}}"}
                </code>{" "}
                are filled at send time.
              </p>
            </div>
            <div>
              <label htmlFor={`email_body_${active}`} className={labelClass}>
                Body copy{" "}
                <span className="font-sans normal-case tracking-normal text-ink-faint">
                  optional
                </span>
              </label>
              <textarea
                id={`email_body_${active}`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Leave blank to use the default copy"
                rows={4}
                className="w-full resize-none rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20"
              />
              {spec.allowed.length > 0 && (
                <p className="mt-1 text-[0.68rem] text-ink-faint">
                  Allowed slots:{" "}
                  {spec.allowed.map((s) => `{{${s}}}`).join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Full-HTML rewrite — the heavier bespoke path, kept as before. */}
        <div className="relative">
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          <p className="relative mx-auto w-fit bg-surface px-3 text-[0.62rem] font-medium uppercase tracking-[0.15em] text-ink-muted">
            Or rewrite the whole email
          </p>
        </div>

        <div>
          <label htmlFor={`email_brief_${active}`} className={labelClass}>
            Brand voice notes{" "}
            <span className="font-sans normal-case tracking-normal text-ink-faint">
              optional
            </span>
          </label>
          <textarea
            id={`email_brief_${active}`}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Tone, phrasing, sign-off… folded into the copied prompt for this email."
            rows={2}
            className="w-full resize-none rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20"
          />
        </div>

        <button
          type="button"
          onClick={copyPrompt}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-cream/40 px-4 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cream hover:border-border-strong cursor-pointer"
        >
          {copied === active ? (
            <>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5L6.5 12L13 4" />
              </svg>
              Copied to clipboard
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="5" width="8" height="8" rx="1.5" />
                <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
              </svg>
              Copy AI prompt for &ldquo;{spec.label}&rdquo;
            </>
          )}
        </button>

        <div className="relative">
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          <p className="relative mx-auto w-fit bg-surface px-3 text-[0.62rem] font-medium uppercase tracking-[0.15em] text-ink-muted">
            Then paste the generated HTML
          </p>
        </div>

        <div>
          <label htmlFor={`email_html_${active}`} className={labelClass}>
            {spec.label} HTML
          </label>
          <textarea
            id={`email_html_${active}`}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="Paste the complete email HTML here…"
            spellCheck={false}
            rows={10}
            className={`w-full resize-none rounded-lg border bg-cream/40 px-3.5 py-2.5 font-mono text-xs text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-muted focus:ring-1 focus:ring-cobalt/20 ${
              validation && !validation.ok
                ? "border-red focus:border-red"
                : validation?.ok
                  ? "border-green focus:border-cobalt"
                  : "border-border focus:border-cobalt"
            }`}
          />
          {validation?.ok && (
            <p className="mt-1 flex items-center gap-1 text-xs text-green">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6.5L5 9l4.5-6" />
              </svg>
              Valid email template ({html.length.toLocaleString()} characters)
            </p>
          )}
          {validation && !validation.ok && (
            <div className="mt-1 space-y-0.5">
              {validation.errors.map((err, i) => (
                <p key={i} className="text-xs text-red">
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>

        {validation?.ok && (
          <ThemeBespokePreview
            request={{
              endpoint: "/api/operator/themes/preview",
              // The route renders the draft override via theme.emailTemplates,
              // so post the type + a single-entry map (its write-path keys), not
              // a loose {type, html}.
              body: {
                template_type: active,
                email_templates: { [active]: html },
                ...previewTheme,
              },
            }}
            height={520}
            label="Preview email"
          />
        )}
      </div>
    </section>
  );
}
