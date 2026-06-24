import { describe, expect, it } from "vitest";
import {
  applicationReceivedEmail,
  chatInvitationEmail,
} from "@/lib/email";
import { DEFAULT_EMAIL_THEME, type EmailTheme } from "@/lib/theme";
import { BODY_MARKER, validateEmailShell } from "@/lib/email-shell";

// ── Bespoke email shell ──────────────────────────────────────────────
//
// A Premium custom theme carries ONE email "shell": brand chrome with a single
// BODY_MARKER. Every transactional email's DETERMINISTIC body is injected at the
// marker, so the email matches the bespoke landing while keeping a real,
// well-formed body (and its action button). A theme without a shell falls back,
// byte-for-byte, to the in-code default chrome. PURE (no DB).

const NAME = "Thabo Mokoena";
const ROLE = "Senior Backend Engineer";
const CLIENT = "Açme & Co";
const CHAT_URL = "https://app.talentstream.co.za/c/acme/senior-backend/chat?t=abc123";

// A minimal, MSO-ish shell: brand header (slot), the body marker, a footer.
const SHELL = `<!DOCTYPE html><html><body><table role="presentation"><tr><td>BRAND HEADER for {{client.name}}</td></tr><tr><td>${BODY_MARKER}</td></tr><tr><td>bespoke footer line</td></tr></table></body></html>`;

function themeWithShell(shell: string): EmailTheme {
  return { ...DEFAULT_EMAIL_THEME, emailShell: shell };
}

describe("validateEmailShell", () => {
  it("accepts a shell containing the body marker", () => {
    expect(validateEmailShell(SHELL)).toEqual({ ok: true });
  });

  it("rejects an empty shell", () => {
    const res = validateEmailShell("   ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/empty/i);
  });

  it("rejects a non-blank shell missing the body marker", () => {
    const res = validateEmailShell("<html><body>no marker here</body></html>");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toContain(BODY_MARKER);
  });

  it("rejects a shell containing a <script> tag", () => {
    const res = validateEmailShell(`<html><body>${BODY_MARKER}<script>x</script></body></html>`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/script/i);
  });
});

describe("email rendering — bespoke shell", () => {
  it("injects the deterministic body into the shell at the marker", () => {
    const theme = themeWithShell(SHELL);
    const html = applicationReceivedEmail(theme, NAME, ROLE, CLIENT);

    // The marker is replaced — never shipped raw.
    expect(html).not.toContain(BODY_MARKER);
    // The shell's chrome survives, with its own slot substituted (& escaped).
    expect(html).toContain("BRAND HEADER for Açme &amp; Co");
    expect(html).toContain("bespoke footer line");
    // The real body renders inside it: greeting + the confirmation copy.
    expect(html).toContain(`Hi ${NAME},`);
    expect(html).toContain("got your application");
    // The default chrome is gone — the shell replaced it entirely.
    expect(html).not.toContain("Sent by TalentStream");
  });

  it("keeps the action button (deterministic body) inside a bespoke shell", () => {
    const theme = themeWithShell(SHELL);
    const html = chatInvitationEmail(theme, NAME, ROLE, CLIENT, CHAT_URL);
    expect(html).not.toContain(BODY_MARKER);
    // The action link is always present — the shell never carries per-email copy,
    // so an action email can't lose its button to free-form HTML.
    expect(html).toContain(CHAT_URL);
    expect(html).toContain("bespoke footer line");
  });

  it("falls back to the default chrome when the theme has no shell", () => {
    const html = applicationReceivedEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT);
    expect(html).toContain("<table");
    expect(html).toContain("Sent by TalentStream");
    expect(html).toContain("got your application");
    expect(html).toContain(NAME);
    expect(html).not.toContain(BODY_MARKER);
  });

  it("falls back to the default chrome for a blank/whitespace shell", () => {
    const theme = themeWithShell("   \n  ");
    const html = applicationReceivedEmail(theme, NAME, ROLE, CLIENT);
    expect(html).toContain("Sent by TalentStream");
    expect(html).toContain("got your application");
  });
});
