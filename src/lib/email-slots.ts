// ── Email types + slot substitution ─────────────────────────────────
//
// The set of candidate-facing transactional emails, plus the {{slot}}
// substitution used to inject dynamic data (candidate name, role, action URL,
// …) into the deterministic email bodies (email.ts) and the default copy /
// subjects (theme-copy.ts). PURE (no @/db, no React) so the email renderer and
// the default-copy module share one contract with no drift.
//
// The two NON-themed system emails (passwordReset, invitation) are out of
// scope: they have no brand context and always render DEFAULT_EMAIL_THEME.

/** The nine candidate-facing campaign emails. Order is the canonical order. */
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

// ── Replacement data ────────────────────────────────────────────────

export interface EmailSlotData {
  candidate?: { name?: string | null };
  campaign?: { role_title?: string | null };
  client?: { name?: string | null };
  action?: { url?: string | null };
  chat?: { close_by_date?: string | null };
  admin?: { reason?: string | null };
}

// ── Replacement ────────────────────────────────────────────────────

const SLOT_REGEX = /\{\{([^}]+)\}\}/g;
const BLOCK_REGEX = /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

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

/**
 * Replace {{slots}} in an email template with real data. Mirrors
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
