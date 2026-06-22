// ── Campaign Themes: copy data + write-time validation ──────────────
//
// This module holds the TYPES, DEFAULTS, and write-time VALIDATORS for the
// structured copy a theme carries:
//   (a) the landing-page copy slots rendered on the generated landing page;
//   (b) the shared + per-template email copy.
//
// It is data + validation ONLY. Rendering and slot substitution live in
// landing.ts / email.ts — this module never renders anything.
//
// PURE module: the only app dependency is the (also-pure) email-slots template
// catalogue, so the operator theme-builder (client), the theme write routes
// (server), and the renderers all share one contract with no drift.

import {
  EMAIL_TEMPLATE_TYPES,
  EMAIL_SLOT_SPECS,
  isEmailTemplateType,
  type EmailTemplateType,
} from "@/lib/email-slots";
import { SLOT_ALLOW_LIST } from "@/lib/slots";

// Landing copy renders on the PUBLIC page, where an unknown slot survives the
// replaceSlots pass as a visible literal "{{token}}". Restrict embedded slots to
// the landing allow-list at write time so that can't happen silently.
const LANDING_SLOTS = new Set<string>(SLOT_ALLOW_LIST);

// Shared email blocks (greeting/sign-off/footer) render on EVERY template, so a
// shared slot is only safe if EVERY type supplies it — i.e. the intersection of
// all per-type allow-lists (e.g. client.name is excluded because chatAccess has
// no company context, so a "{{client.name}}" sign-off would render empty there).
const SHARED_EMAIL_SLOTS = (() => {
  const sets = EMAIL_TEMPLATE_TYPES.map(
    (t) => new Set<string>(EMAIL_SLOT_SPECS[t].allowed)
  );
  const base = sets[0] ?? new Set<string>();
  return new Set<string>(
    [...base].filter((slot) => sets.every((s) => s.has(slot)))
  );
})();

// Distinct slot names referenced by a copy string, stripping the `#`/`/` block
// delimiters (so `{{#admin.reason}}…{{/admin.reason}}` and `{{admin.reason}}`
// both report "admin.reason"). Mirrors email-slots' internal scan.
const SLOT_SCAN = /\{\{([^}]+)\}\}/g;
function referencedSlots(s: string): string[] {
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(SLOT_SCAN.source, "g");
  while ((m = re.exec(s)) !== null) {
    seen.add(m[1].trim().replace(/^[#/]/, ""));
  }
  return [...seen];
}

// ── Landing copy ────────────────────────────────────────────────
// Theme-level default copy rendered on the generated landing page, styled by the
// theme palette/fonts. Strings MAY contain landing slot tokens like {{client.name}}.
export interface LandingCopy {
  headline: string; // hero eyebrow/tagline above the role title
  intro: string; // a lead paragraph shown above the role description
  highlights: string[]; // short selling-point bullets (0..6)
  applyHeading: string; // heading on the apply card, e.g. "Apply for this role"
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
  applyHeading: "Apply for this role",
};

// ── Email copy ──────────────────────────────────────────────────
export interface EmailCopyShared {
  greeting: string; // default "Hi {{candidate.name}},"  (a {{candidate.name}} slot is allowed)
  signOff: string; // default closing line
  footer: string; // default footer line (plain text)
}

export type EmailCopyPerType = {
  subject?: string; // overrides the default subject (PLAIN TEXT; may contain {{campaign.role_title}} etc.)
  body?: string; // overrides the default body copy (light text/markup; may contain allowed slots)
};

export interface EmailCopy {
  shared: EmailCopyShared;
  perType: Partial<Record<EmailTemplateType, EmailCopyPerType>>;
}

const DEFAULT_EMAIL_SHARED: EmailCopyShared = {
  greeting: "Hi {{candidate.name}},",
  // Empty by default = opt-in. A non-empty sign-off renders as a signature line
  // appended to every email; leaving it blank preserves each template's own
  // tailored closing and keeps the no-company chatAccess email from rendering a
  // broken "{{client.name}}" signature. Operators can set e.g. "— The team".
  signOff: "",
  footer: "Automated message — please do not reply",
};

// Default subjects for every template type. These mirror the live subjects
// exactly, with the role title swapped for a {{campaign.role_title}} slot.
// The "—" characters are real em dashes (U+2014). Body defaults live in
// email.ts; only subjects are defaulted here.
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

// ── Validators (used by the theme write contract) ───────────────

const MAX_HIGHLIGHTS = 6;
const SCRIPT_REGEX = /<script/i;

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; message: string };

function hasScript(s: string): boolean {
  return SCRIPT_REGEX.test(s);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalise theme-level landing copy.
 *   null/undefined         → { ok: true, value: null }  ("use defaults")
 *   wrong field TYPES       → { ok: false, message }
 *   blank string field      → falls back to the DEFAULT for that field
 * A partial object is completed by merging over DEFAULT_LANDING_COPY. Pure;
 * never throws.
 */
export function normaliseLandingCopy(
  input: unknown
): Ok<LandingCopy | null> | Err {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (!isPlainObject(input)) {
    return { ok: false, message: "landingCopy must be an object" };
  }

  const out: LandingCopy = {
    headline: DEFAULT_LANDING_COPY.headline,
    intro: DEFAULT_LANDING_COPY.intro,
    highlights: [...DEFAULT_LANDING_COPY.highlights],
    applyHeading: DEFAULT_LANDING_COPY.applyHeading,
  };

  // Simple string fields: type-check, trim, blank → default, reject <script.
  const stringFields = ["headline", "intro", "applyHeading"] as const;
  for (const field of stringFields) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (typeof raw !== "string") {
      return { ok: false, message: `landingCopy.${field} must be a string` };
    }
    if (hasScript(raw)) {
      return {
        ok: false,
        message: `landingCopy.${field} must not contain <script>`,
      };
    }
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const bad = referencedSlots(trimmed).find((s) => !LANDING_SLOTS.has(s));
      if (bad) {
        return {
          ok: false,
          message: `landingCopy.${field} uses unknown slot "{{${bad}}}". Allowed: ${SLOT_ALLOW_LIST.join(
            ", "
          )}`,
        };
      }
    }
    out[field] = trimmed === "" ? DEFAULT_LANDING_COPY[field] : trimmed;
  }

  if ("highlights" in input) {
    const raw = input.highlights;
    if (!Array.isArray(raw)) {
      return { ok: false, message: "landingCopy.highlights must be an array" };
    }
    const cleaned: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") {
        return {
          ok: false,
          message: "landingCopy.highlights must be an array of strings",
        };
      }
      if (hasScript(item)) {
        return {
          ok: false,
          message: "landingCopy.highlights must not contain <script>",
        };
      }
      const trimmed = item.trim();
      if (trimmed === "") continue; // drop blank entries
      const badSlot = referencedSlots(trimmed).find((s) => !LANDING_SLOTS.has(s));
      if (badSlot) {
        return {
          ok: false,
          message: `landingCopy.highlights uses unknown slot "{{${badSlot}}}". Allowed: ${SLOT_ALLOW_LIST.join(
            ", "
          )}`,
        };
      }
      if (cleaned.length >= MAX_HIGHLIGHTS) continue; // cap at 6
      cleaned.push(trimmed);
    }
    // An explicitly-provided (possibly empty after cleaning) array replaces the
    // default — the operator chose their bullets, including "none".
    out.highlights = cleaned;
  }

  return { ok: true, value: out };
}

/**
 * Normalise email copy.
 *   null/undefined → { ok: true, value: null }  ("use defaults")
 *   otherwise → a fully-populated EmailCopy: `shared` is always complete from
 *   defaults (blank fields fall back to default); `perType` is sparse.
 * Unknown perType keys, wrong types, and <script> in any subject/body are
 * rejected. Pure; never throws.
 */
export function normaliseEmailCopy(input: unknown): Ok<EmailCopy | null> | Err {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (!isPlainObject(input)) {
    return { ok: false, message: "emailCopy must be an object" };
  }

  // ── shared ──
  const shared: EmailCopyShared = { ...DEFAULT_EMAIL_SHARED };
  if ("shared" in input && input.shared !== undefined) {
    const rawShared = input.shared;
    if (!isPlainObject(rawShared)) {
      return { ok: false, message: "emailCopy.shared must be an object" };
    }
    const sharedFields = ["greeting", "signOff", "footer"] as const;
    for (const field of sharedFields) {
      if (!(field in rawShared)) continue;
      const raw = rawShared[field];
      if (typeof raw !== "string") {
        return {
          ok: false,
          message: `emailCopy.shared.${field} must be a string`,
        };
      }
      if (hasScript(raw)) {
        return {
          ok: false,
          message: `emailCopy.shared.${field} must not contain <script>`,
        };
      }
      const trimmed = raw.trim();
      if (trimmed !== "") {
        const bad = referencedSlots(trimmed).find(
          (s) => !SHARED_EMAIL_SLOTS.has(s)
        );
        if (bad) {
          return {
            ok: false,
            message: `emailCopy.shared.${field} uses slot "{{${bad}}}", which is not available on every email type. Shared copy may only use: ${[
              ...SHARED_EMAIL_SLOTS,
            ].join(", ")}`,
          };
        }
      }
      shared[field] = trimmed === "" ? DEFAULT_EMAIL_SHARED[field] : trimmed;
    }
  }

  // ── perType ──
  const perType: Partial<Record<EmailTemplateType, EmailCopyPerType>> = {};
  if ("perType" in input && input.perType !== undefined) {
    const rawPerType = input.perType;
    if (!isPlainObject(rawPerType)) {
      return { ok: false, message: "emailCopy.perType must be an object" };
    }
    for (const key of Object.keys(rawPerType)) {
      if (!isEmailTemplateType(key)) {
        return {
          ok: false,
          message: `Unknown email template type "${key}". Allowed: ${EMAIL_TEMPLATE_TYPES.join(
            ", "
          )}`,
        };
      }
      const rawEntry = rawPerType[key];
      if (!isPlainObject(rawEntry)) {
        return {
          ok: false,
          message: `emailCopy.perType.${key} must be an object`,
        };
      }
      const entry: EmailCopyPerType = {};
      for (const field of ["subject", "body"] as const) {
        if (!(field in rawEntry)) continue;
        const raw = rawEntry[field];
        if (raw === undefined) continue;
        if (typeof raw !== "string") {
          return {
            ok: false,
            message: `emailCopy.perType.${key}.${field} must be a string`,
          };
        }
        if (hasScript(raw)) {
          return {
            ok: false,
            message: `emailCopy.perType.${key}.${field} must not contain <script>`,
          };
        }
        const trimmed = raw.trim();
        if (trimmed === "") continue; // a blank override is no override
        // Slot parity with bespoke email HTML: an override may only reference the
        // slots this template actually supplies. Otherwise e.g. {{action.url}} in
        // an applicationReceived subject/body would silently render empty at send.
        const allowed = new Set<string>(EMAIL_SLOT_SPECS[key].allowed);
        const bad = referencedSlots(trimmed).find((s) => !allowed.has(s));
        if (bad) {
          return {
            ok: false,
            message: `emailCopy.perType.${key}.${field} uses slot "{{${bad}}}" which ${key} does not provide. Allowed: ${
              EMAIL_SLOT_SPECS[key].allowed.join(", ") || "(none)"
            }`,
          };
        }
        entry[field] = trimmed;
      }
      // Drop entries that end up with neither subject nor body.
      if (entry.subject !== undefined || entry.body !== undefined) {
        perType[key] = entry;
      }
    }
  }

  return { ok: true, value: { shared, perType } };
}
