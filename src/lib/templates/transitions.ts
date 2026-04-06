// ── Template status state machine ──────────────────────────────────
//
// Defines the lifecycle transitions for `templates.status`, with per-
// transition guards and the side-effects that must accompany each
// transition (HTML snapshots, preview tokens, timestamps).
//
// State model:
//   draft → pending → published → archived
//                  ↑     ↓
//                  ↑   draft
//                  archived → draft (revive)
//
// Key invariant: live campaigns render from `published_html_template`,
// which is only updated on transitions INTO `published`. Therefore
// taking a published template back to draft does NOT disturb live
// campaigns — they continue rendering the snapshot.

import { randomBytes } from "crypto";
import { validateHtmlTemplate } from "./slots";

export type TemplateStatus = "draft" | "pending" | "published" | "archived";

export const TEMPLATE_STATUSES: readonly TemplateStatus[] = [
  "draft",
  "pending",
  "published",
  "archived",
] as const;

export function isTemplateStatus(v: unknown): v is TemplateStatus {
  return (
    typeof v === "string" &&
    (TEMPLATE_STATUSES as readonly string[]).includes(v)
  );
}

// ── Allowed transitions ─────────────────────────────────────────────

const ALLOWED: Record<TemplateStatus, readonly TemplateStatus[]> = {
  draft: ["pending", "archived"],
  pending: ["draft", "published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransition(
  from: TemplateStatus,
  to: TemplateStatus
): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTransitionsFrom(
  from: TemplateStatus
): readonly TemplateStatus[] {
  return ALLOWED[from];
}

// ── Row shape (narrow view of the templates table) ─────────────────

export interface TransitionInput {
  status: TemplateStatus;
  name: string;
  html_template: string | null;
  published_html_template: string | null;
}

// ── Patch the state machine emits ──────────────────────────────────

export interface TransitionPatch {
  status: TemplateStatus;
  updated_at: Date;
  preview_token?: string | null;
  preview_token_expires_at?: Date | null;
  published_at?: Date | null;
  published_html_template?: string | null;
}

export type TransitionResult =
  | { ok: true; patch: TransitionPatch }
  | { ok: false; error: string };

// ── Token generation ───────────────────────────────────────────────

function generatePreviewToken(): string {
  return randomBytes(24).toString("base64url");
}

const PREVIEW_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ── Main entry point ────────────────────────────────────────────────

export function computeTransition(
  input: TransitionInput,
  to: TemplateStatus
): TransitionResult {
  const from = input.status;

  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: `Cannot transition template from "${from}" to "${to}". Allowed: ${allowedTransitionsFrom(from).join(", ") || "(none)"}.`,
    };
  }

  const now = new Date();
  const patch: TransitionPatch = { status: to, updated_at: now };

  // Pre-publish / pre-review guards: the html_template must be valid
  // before a template can be shown externally (pending) or go live
  // (published).
  if (to === "pending" || to === "published") {
    if (!input.html_template) {
      return {
        ok: false,
        error: `html_template is required before transitioning to "${to}"`,
      };
    }
    const validated = validateHtmlTemplate(input.html_template);
    if (!validated.ok) {
      return {
        ok: false,
        error: `html_template validation failed: ${validated.errors.join("; ")}`,
      };
    }
  }

  if (!input.name.trim()) {
    return { ok: false, error: "name is required" };
  }

  // Side-effects per transition.
  if (to === "pending") {
    patch.preview_token = generatePreviewToken();
    patch.preview_token_expires_at = new Date(
      now.getTime() + PREVIEW_TOKEN_TTL_MS
    );
  } else {
    patch.preview_token = null;
    patch.preview_token_expires_at = null;
  }

  if (to === "published") {
    patch.published_at = now;
    patch.published_html_template = input.html_template;
  }

  return { ok: true, patch };
}
