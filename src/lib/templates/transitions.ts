// ── Template status state machine ──────────────────────────────────
//
// Defines the lifecycle transitions for `templates.status`, with per-
// transition guards and the side-effects that must accompany each
// transition (tree snapshots, preview tokens, timestamps).
//
// State model:
//   draft → pending → published → archived
//                  ↑     ↓
//                  ↑   draft
//                  archived → draft (revive)
//
// Key invariant: live campaigns render from `published_block_tree`,
// which is only updated on transitions INTO `published`. Therefore
// taking a published template back to draft does NOT disturb live
// campaigns — they continue rendering the snapshot.

import { randomBytes } from "crypto";
import { parseBlockTree } from "@/templates/blocks/schema";

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
  source: "builtin" | "custom";
  name: string;
  block_tree: unknown; // validated fresh on publishing guards
  published_block_tree: unknown;
}

// ── Patch the state machine emits ──────────────────────────────────

export interface TransitionPatch {
  status: TemplateStatus;
  updated_at: Date;
  // Present only when the transition needs to change these fields.
  preview_token?: string | null;
  preview_token_expires_at?: Date | null;
  published_at?: Date | null;
  published_block_tree?: unknown;
}

export type TransitionResult =
  | { ok: true; patch: TransitionPatch }
  | { ok: false; error: string };

// ── Token generation ───────────────────────────────────────────────

// 24 bytes → 32 base64url chars. Unguessable; collision risk ≈ 2⁻¹⁹².
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

  // Pre-publish / pre-review guards: the block_tree must be a valid
  // tree before a custom template can be shown externally (pending)
  // or go live (published).
  if ((to === "pending" || to === "published") && input.source === "custom") {
    if (!input.block_tree) {
      return {
        ok: false,
        error: `block_tree is required on a custom template before transitioning to "${to}"`,
      };
    }
    const parsed = parseBlockTree(input.block_tree);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `block_tree failed validation: ${parsed.errors.join("; ")}`,
      };
    }
  }

  if (!input.name.trim()) {
    return { ok: false, error: "name is required" };
  }

  // Side-effects per transition.
  if (to === "pending") {
    // Fresh token on every entry into pending.
    patch.preview_token = generatePreviewToken();
    patch.preview_token_expires_at = new Date(
      now.getTime() + PREVIEW_TOKEN_TTL_MS
    );
  } else {
    // Any exit from pending (or re-publish after a reject cycle) clears
    // the token so the old shared link stops working.
    patch.preview_token = null;
    patch.preview_token_expires_at = null;
  }

  if (to === "published") {
    patch.published_at = now;
    // Snapshot current working copy as the live render target. For
    // builtins block_tree is NULL; published_block_tree stays NULL
    // (candidate page uses the code registry for builtins).
    if (input.source === "custom") {
      patch.published_block_tree = input.block_tree;
    }
  }

  return { ok: true, patch };
}
