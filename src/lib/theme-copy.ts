// ── Default landing + email copy ────────────────────────────────────
//
// The fixed copy the renderers use: landing-page copy (headline / intro /
// highlights / apply heading) and the shared email copy (greeting / sign-off /
// footer) + per-type subjects. This was briefly operator-overridable per theme
// (CT7); that authoring axis was removed — copy is now a single in-code default
// shared by every theme. Rendering + slot substitution live in landing.ts /
// email.ts; this module is data only.
//
// PURE module (only depends on the email-type catalogue), so the renderers
// share one source of truth.

import {
  EMAIL_TEMPLATE_TYPES,
  type EmailTemplateType,
} from "@/lib/email-slots";

// ── Landing copy ────────────────────────────────────────────────
// Rendered on the generated landing page, styled by the theme palette/fonts.
// Strings MAY contain landing slot tokens like {{client.name}}.
export interface LandingCopy {
  headline: string; // hero eyebrow/tagline above the role title
  intro: string; // a lead paragraph shown above the role description
  highlights: string[]; // short selling-point bullets
  // NB: there is no apply-card heading here — ApplicationForm renders its own
  // "Apply for this role" heading + helper, so the landing template adds none
  // (see src/lib/landing.ts). Re-adding one here would duplicate it.
}

export const DEFAULT_LANDING_COPY: LandingCopy = {
  headline: "Join {{client.name}}",
  intro:
    "We're glad you're here. Take a moment to learn about the role below, then apply — it only takes a few minutes.",
  highlights: [
    "A team that values your growth",
    "Meaningful, high-impact work",
    "A fair, transparent hiring process",
  ],
};

// ── Email copy ──────────────────────────────────────────────────
export interface EmailCopyShared {
  greeting: string; // "Hi {{candidate.name}},"
  signOff: string; // optional closing line (empty = each email keeps its own close)
  footer: string; // plain-text footer line
}

export type EmailCopyPerType = {
  subject?: string; // PLAIN TEXT; may contain {{campaign.role_title}} etc.
  body?: string;
};

export interface EmailCopy {
  shared: EmailCopyShared;
  perType: Partial<Record<EmailTemplateType, EmailCopyPerType>>;
}

const DEFAULT_EMAIL_SHARED: EmailCopyShared = {
  greeting: "Hi {{candidate.name}},",
  // Empty by default: each email keeps its own tailored close, and the
  // no-company chatAccess email never renders a broken "{{client.name}}" line.
  signOff: "",
  footer: "Automated message — please do not reply",
};

// Default subjects for every template type. The "—" characters are real em
// dashes (U+2014); each is byte-identical to today's live subject with the role
// title swapped for a {{campaign.role_title}} slot. Body defaults live in email.ts.
const DEFAULT_EMAIL_PER_TYPE: Record<EmailTemplateType, EmailCopyPerType> = {
  applicationReceived: { subject: "Application received — {{campaign.role_title}}" },
  gatingPassed: { subject: "Good news — {{campaign.role_title}}" },
  gatingFailed: { subject: "Application update — {{campaign.role_title}}" },
  rejection: { subject: "Application update — {{campaign.role_title}}" },
  chatInvitation: {
    subject: "We'd like to chat about your application — {{campaign.role_title}}",
  },
  chatAccess: { subject: "Verify your identity — {{campaign.role_title}}" },
  chatNudge: { subject: "Reminder — {{campaign.role_title}}" },
  noResponse: { subject: "Application update — {{campaign.role_title}}" },
  rejectionConfirmation: { subject: "Application update — {{campaign.role_title}}" },
};

export const DEFAULT_EMAIL_COPY: EmailCopy = {
  shared: { ...DEFAULT_EMAIL_SHARED },
  // Spread each entry so callers/tests can't mutate the module-level defaults.
  perType: Object.fromEntries(
    EMAIL_TEMPLATE_TYPES.map((t) => [t, { ...DEFAULT_EMAIL_PER_TYPE[t] }])
  ) as Record<EmailTemplateType, EmailCopyPerType>,
};
