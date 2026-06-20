// ── Bespoke-email slot system (CT6) ─────────────────────────────────
//
// The landing page has ONE free-form template (slots.ts). Transactional
// emails are different: there are nine distinct candidate-facing templates,
// each with its own dynamic data and — for the action emails — a link the
// candidate MUST be able to click or the flow dead-ends. So bespoke email
// uses a PER-TEMPLATE slot contract: every template declares the slots it
// may use (`allowed`) and the slots it cannot render without (`required`).
//
// This module is PURE (no @/db, no React) so it is shared by the operator
// theme-builder (client), the operator theme routes (server), the email
// prompt builder, and the email kit (email.ts) — one contract, no drift.
//
// The two NON-themed system emails (passwordReset, invitation) are out of
// scope: they have no brand context and always render DEFAULT_EMAIL_THEME.

// ── Template catalogue ─────────────────────────────────────────────

/** The nine candidate-facing campaign emails that a bespoke theme may override.
 *  Order is the canonical authoring order used by the operator console. */
export const EMAIL_TEMPLATE_TYPES = [
  "applicationReceived",
  "gatingPassed",
  "gatingFailed",
  "rejection",
  "chatInvitation",
  "chatAccess",
  "chatNudge",
  "noResponse",
  "rejectionConfirmation",
] as const;

export type EmailTemplateType = (typeof EMAIL_TEMPLATE_TYPES)[number];

/** The sparse per-theme override map persisted on `themes.email_templates`:
 *  only the template types the operator has authored are present. */
export type EmailTemplateMap = Partial<Record<EmailTemplateType, string>>;

const EMAIL_TEMPLATE_TYPE_SET = new Set<string>(EMAIL_TEMPLATE_TYPES);

export function isEmailTemplateType(v: unknown): v is EmailTemplateType {
  return typeof v === "string" && EMAIL_TEMPLATE_TYPE_SET.has(v);
}

// ── Slot allow-list (the union across all templates) ────────────────

export const EMAIL_SLOT_ALLOW_LIST = [
  "candidate.name",
  "campaign.role_title",
  "client.name",
  // The single primary call-to-action link. Maps to the chat URL / verify
  // magic-link depending on the template; always goes inside an <a href>.
  "action.url",
  // chatNudge only: the date after which the application auto-closes.
  "chat.close_by_date",
  // rejectionConfirmation only: the recruiter's optional free-text note.
  "admin.reason",
] as const;

export type EmailSlotName = (typeof EMAIL_SLOT_ALLOW_LIST)[number];

/** Human-readable docs surfaced in the AI prompt so the model places each
 *  slot correctly. Keyed by slot name. */
export const EMAIL_SLOT_DESCRIPTIONS: Record<EmailSlotName, string> = {
  "candidate.name": 'The candidate’s first name (short text, e.g. "Sam").',
  "campaign.role_title":
    'The job title (short text, e.g. "Senior Software Engineer").',
  "client.name": 'The hiring company name (short text, e.g. "Acme Corp").',
  "action.url":
    "The primary call-to-action URL. Put it in the href of a single, prominent button or link — the candidate cannot continue without it.",
  "chat.close_by_date":
    'A pre-formatted close-by date (e.g. "12 July 2026") after which the application is closed.',
  "admin.reason":
    "An optional recruiter note. It may be empty — wrap it in a conditional block so the surrounding sentence disappears when absent.",
};

// ── Per-template contract ───────────────────────────────────────────

export interface EmailSlotSpec {
  /** Operator-facing label for the console tab. */
  label: string;
  /** What the email is for + the tone the copy must hold. Fed to the AI so a
   *  rejection never reads cheerful and a confirmation never reads cold. */
  purpose: string;
  /** A short gist of the default copy the AI may adapt (NOT verbatim filler). */
  referenceCopy: string;
  /** Slots this template may reference. */
  allowed: readonly EmailSlotName[];
  /** Slots the template is broken without (enforced by validateEmailTemplate).
   *  Used only for the action link today: a missing link = a dead-end candidate. */
  required: readonly EmailSlotName[];
}

const CANDIDATE_ROLE_COMPANY: readonly EmailSlotName[] = [
  "candidate.name",
  "campaign.role_title",
  "client.name",
];

export const EMAIL_SLOT_SPECS: Record<EmailTemplateType, EmailSlotSpec> = {
  applicationReceived: {
    label: "Application received",
    purpose:
      "Warm, professional confirmation that the candidate's application has been received and is now under review. Reassuring, not effusive.",
    referenceCopy:
      "Thank the candidate for applying, confirm the application is received and being reviewed, restate the role and company, and say they'll hear about next steps soon.",
    allowed: CANDIDATE_ROLE_COMPANY,
    required: [],
  },
  gatingPassed: {
    label: "Passed screening",
    purpose:
      "Positive update telling the candidate they meet the initial requirements and are moving forward. Encouraging but measured — not an offer.",
    referenceCopy:
      "Share the good news that they meet the initial requirements for the role at the company and the team is now reviewing; promise an update shortly.",
    allowed: CANDIDATE_ROLE_COMPANY,
    required: [],
  },
  gatingFailed: {
    label: "Did not pass screening",
    purpose:
      "Polite, blameless notice that the candidate does not meet the specific requirements for this role. Respectful and encouraging about future roles — never harsh.",
    referenceCopy:
      "Thank them for their interest in the role at the company, explain their profile doesn't meet the specific requirements this time, and encourage future applications.",
    allowed: CANDIDATE_ROLE_COMPANY,
    required: [],
  },
  rejection: {
    label: "Rejection",
    purpose:
      "Respectful notice that, after consideration, the team will not move forward. Dignified and appreciative — no false hope, no coldness.",
    referenceCopy:
      "Thank them for their interest in the role at the company, say that after careful consideration you won't proceed at this time, appreciate their effort, and wish them well.",
    allowed: CANDIDATE_ROLE_COMPANY,
    required: [],
  },
  chatInvitation: {
    label: "Chat invitation",
    purpose:
      "Invites the candidate to a short follow-up chat. Must drive the click. The chat link is the whole point of the email.",
    referenceCopy:
      "Tell them there are a few quick follow-up questions about their application, restate the role and company, and prompt them to start the chat via the button.",
    allowed: [...CANDIDATE_ROLE_COMPANY, "action.url"],
    required: ["action.url"],
  },
  chatAccess: {
    label: "Chat access (verify)",
    purpose:
      "An identity-verification magic link to access the chat. Security-flavoured, time-sensitive (expires in 1 hour). NOTE: this email does NOT have the company name available.",
    referenceCopy:
      "Say a request was received to access their chat for the role, ask them to verify identity via the button to continue, note the link expires in 1 hour, and add a safe-to-ignore line.",
    allowed: ["candidate.name", "campaign.role_title", "action.url"],
    required: ["action.url"],
  },
  chatNudge: {
    label: "Chat reminder",
    purpose:
      "A gentle reminder to a non-responsive candidate to continue the chat before the application auto-closes. Honest, not an ultimatum.",
    referenceCopy:
      "Say you're still interested in their application for the role at the company but haven't heard back; note that if they don't respond by the close-by date the application will be closed; prompt them to continue via the button.",
    allowed: [...CANDIDATE_ROLE_COMPANY, "action.url", "chat.close_by_date"],
    required: ["action.url"],
  },
  noResponse: {
    label: "No response (closed)",
    purpose:
      "Blameless terminal note that the application has been closed because the candidate never engaged with the follow-up chat. No judgment — explicitly not a rejection.",
    referenceCopy:
      "Explain you reached out with follow-up questions for the role at the company but didn't hear back, so the application has been closed; thank them and wish them well.",
    allowed: CANDIDATE_ROLE_COMPANY,
    required: [],
  },
  rejectionConfirmation: {
    label: "Rejection confirmation",
    purpose:
      "A short written record confirming a rejection already delivered in chat. Plain and brief — the warmth happened in the conversation. May carry an optional recruiter note.",
    referenceCopy:
      "Confirm in writing that the team for the role at the company has decided not to move forward; if a recruiter note is present, share it; close appreciatively.",
    allowed: [...CANDIDATE_ROLE_COMPANY, "admin.reason"],
    required: [],
  },
};

// ── Replacement data ────────────────────────────────────────────────

export interface EmailSlotData {
  candidate?: { name?: string | null };
  campaign?: { role_title?: string | null };
  client?: { name?: string | null };
  action?: { url?: string | null };
  chat?: { close_by_date?: string | null };
  admin?: { reason?: string | null };
}

// ── Validation ─────────────────────────────────────────────────────

const SLOT_REGEX = /\{\{([^}]+)\}\}/g;
const SCRIPT_REGEX = /<script[\s>]/i;

/** Collect the distinct slot names referenced by a template (stripping the
 *  `#`/`/` block delimiters), so both validation and required-checks share one
 *  scan. */
function referencedSlots(html: string): Set<string> {
  const seen = new Set<string>();
  const re = new RegExp(SLOT_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    seen.add(match[1].trim().replace(/^[#/]/, ""));
  }
  return seen;
}

/**
 * Validate an operator/AI-authored email template for a given type. Unlike the
 * landing validator (slots.ts) there is no form-mount requirement, but there IS
 * a per-type required-slot check: an action email without its `action.url` is a
 * dead-end for the candidate, so it is rejected. Slots must come from the
 * template's own allow-list (a stricter, per-type list than the union).
 */
export function validateEmailTemplate(
  type: EmailTemplateType,
  html: string
): { ok: true } | { ok: false; errors: string[] } {
  const spec = EMAIL_SLOT_SPECS[type];
  const errors: string[] = [];

  if (!html.trim()) {
    return { ok: false, errors: ["Email template is empty"] };
  }

  if (SCRIPT_REGEX.test(html)) {
    errors.push(
      "Email template must not contain <script> tags — email clients strip them and they will not run"
    );
  }

  const used = referencedSlots(html);
  const allowed = new Set<string>(spec.allowed);
  for (const name of used) {
    if (!allowed.has(name)) {
      errors.push(
        `Unknown slot "{{${name}}}" for ${spec.label}. Allowed: ${spec.allowed.join(", ") || "(none)"}`
      );
    }
  }

  for (const req of spec.required) {
    if (!used.has(req)) {
      errors.push(
        `Missing required slot "{{${req}}}" — ${spec.label} cannot function without it`
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── Replacement ────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveEmailSlot(name: string, data: EmailSlotData): string {
  const path: Record<string, string | null | undefined> = {
    "candidate.name": data.candidate?.name,
    "campaign.role_title": data.campaign?.role_title,
    "client.name": data.client?.name,
    "action.url": data.action?.url,
    "chat.close_by_date": data.chat?.close_by_date,
    "admin.reason": data.admin?.reason,
  };
  const raw = path[name];
  if (raw === null || raw === undefined) return "";
  return escapeHtml(String(raw));
}

const BLOCK_REGEX = /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

/**
 * Replace {{slots}} in a bespoke email template with real data. Mirrors
 * slots.replaceSlots: conditional `{{#slot}}...{{/slot}}` blocks are stripped
 * when the slot is empty, then standalone markers are substituted. All values
 * are HTML-escaped (every email slot is plain text, including the action URL
 * which lands in an href attribute).
 */
export function replaceEmailSlots(html: string, data: EmailSlotData): string {
  let result = html.replace(BLOCK_REGEX, (_, name: string, inner: string) => {
    return resolveEmailSlot(name.trim(), data) ? inner : "";
  });
  result = result.replace(SLOT_REGEX, (_, name: string) =>
    resolveEmailSlot(name.trim(), data)
  );
  return result;
}
