// ── Bespoke email shell contract (Themes redesign) ──────────────────
//
// A Premium bespoke theme carries ONE email "shell": a complete, MSO-safe
// HTML email document whose brand chrome (header / footer / colours / type)
// matches the theme's bespoke landing page, with a single BODY_MARKER where
// the transactional message content is injected at send time. The nine
// deterministic email bodies (email.ts) render INTO this shell, so the shell
// never carries per-email copy — only the surrounding frame, and the action
// button stays deterministic (no dead-link risk → no per-type slot contract).
//
// PURE, db-free: shared by the write routes (server), the theme-builder
// (client), the email renderer, and the AI prompt builder — one contract, no
// drift. Mirrors validateHtmlTemplate in slots.ts.

/** The placeholder the bespoke email shell must contain. At send time the
 *  assembled transactional body replaces this exact marker. It is an HTML
 *  comment so it survives slot substitution untouched and stays invisible if
 *  ever left unreplaced. */
export const BODY_MARKER = "<!--TS:BODY-->";

const SCRIPT_REGEX = /<script[\s>]/i;

/**
 * Validate an operator/AI-authored bespoke email shell. The shell MUST carry
 * the BODY_MARKER (else the transactional content has nowhere to render) and,
 * like every email, must not contain <script> (clients strip it). Lenient
 * otherwise — the MSO-safe table structure is guided by the prompt, not enforced
 * here (consistent with the no-sanitiser stance on bespoke landing HTML).
 */
export function validateEmailShell(
  html: string
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!html.trim()) {
    errors.push("Email shell is empty");
    return { ok: false, errors };
  }

  if (!html.includes(BODY_MARKER)) {
    errors.push(
      `Email shell must contain ${BODY_MARKER} where the message content will be inserted`
    );
  }

  if (SCRIPT_REGEX.test(html)) {
    errors.push(
      "Email shell must not contain <script> tags — email clients strip them and they will not run"
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
