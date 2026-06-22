import { describe, expect, it } from "vitest";
import {
  applicationReceivedEmail,
  chatAccessEmail,
  chatInvitationEmail,
  chatNudgeEmail,
  gatingFailedEmail,
  gatingPassedEmail,
  invitationEmail,
  noResponseEmail,
  passwordResetEmail,
  rejectionConfirmationEmail,
  rejectionEmail,
  resolveEmailSubject,
} from "@/lib/email";
import { DEFAULT_EMAIL_THEME, type EmailTheme } from "@/lib/theme";
import { DEFAULT_EMAIL_COPY, type EmailCopy } from "@/lib/theme-copy";

// ── Byte-identical regression guard (CT1) ────────────────────────────
//
// The crux of CT1's "zero visible change" acceptance: every template must
// render identically before and after the makeEmailKit(theme) refactor when
// fed DEFAULT_EMAIL_THEME. This file is committed with its `.snap` on the
// pre-refactor code; after the refactor the 9 candidate calls below gain a
// leading DEFAULT_EMAIL_THEME arg and the (output-only) snapshot must still
// match — proving the default palette/fonts/wordmark/footer/MSO shell are
// reproduced exactly. The 2 non-campaign templates (password reset, invitation)
// never take a theme and must stay untouched.
//
// Args are fixed + representative, and deliberately include HTML-significant
// free text (quotes, ampersand, angle brackets) so escapeHtml paths are locked.

const NAME = "Thabo Mokoena";
const ROLE = "Senior Backend Engineer";
const CLIENT = "Açme & Co <Pty> Ltd";
const CHAT_URL = "https://app.talentstream.co.za/c/acme/senior-backend/chat?t=abc123";
const RESET_URL = "https://app.talentstream.co.za/reset?token=tok_reset_123";
const ACCEPT_URL = "https://app.talentstream.co.za/invite?token=tok_invite_456";
const MAGIC_URL = "https://app.talentstream.co.za/api/chat/verify?token=tok_magic_789";
const CLOSE_BY = "12 July 2026";
const ADMIN_REASON = "Strong CV, but we've gone with someone closer to the \"must-have\" stack.";

// The 9 candidate templates now take a leading DEFAULT_EMAIL_THEME arg; the
// committed (output-only) snapshot must still match byte-for-byte, proving the
// makeEmailKit refactor changed nothing under the default theme. The 2
// non-campaign templates are unchanged (no theme param).
describe("email templates — byte-identical default render", () => {
  it("applicationReceivedEmail", () => {
    expect(
      applicationReceivedEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT)
    ).toMatchSnapshot();
  });

  it("gatingPassedEmail", () => {
    expect(
      gatingPassedEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT)
    ).toMatchSnapshot();
  });

  it("gatingFailedEmail", () => {
    expect(
      gatingFailedEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT)
    ).toMatchSnapshot();
  });

  it("rejectionEmail", () => {
    expect(
      rejectionEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT)
    ).toMatchSnapshot();
  });

  it("chatInvitationEmail", () => {
    expect(
      chatInvitationEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT, CHAT_URL)
    ).toMatchSnapshot();
  });

  it("chatAccessEmail", () => {
    expect(
      chatAccessEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, MAGIC_URL)
    ).toMatchSnapshot();
  });

  it("chatNudgeEmail", () => {
    expect(
      chatNudgeEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT, CHAT_URL, CLOSE_BY)
    ).toMatchSnapshot();
  });

  it("noResponseEmail", () => {
    expect(
      noResponseEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT)
    ).toMatchSnapshot();
  });

  it("rejectionConfirmationEmail", () => {
    expect(
      rejectionConfirmationEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT, ADMIN_REASON)
    ).toMatchSnapshot();
  });

  // Non-campaign templates — always on the default theme, never parameterised.
  it("passwordResetEmail", () => {
    expect(passwordResetEmail(NAME, RESET_URL)).toMatchSnapshot();
  });

  it("invitationEmail", () => {
    expect(invitationEmail(CLIENT, NAME, ACCEPT_URL)).toMatchSnapshot();
  });
});

// ── New branded path (locks the theme-bound rendering) ───────────────
// A bespoke theme: distinct palette, an explicit logo, white-label footer. This
// describe block has its own fresh snapshots (no pre-refactor baseline) and
// exercises the makeEmailKit branches the default theme never hits — branded
// palette interpolation, the <img> brand header, and the dropped powered-by.
const BRANDED_THEME: EmailTheme = {
  palette: {
    bg: "#0b1f14",
    card: "#0f2a1c",
    primary: "#006341",
    primaryDeep: "#004d33",
    primaryTint: "#103a28",
    accent: "#b4c905",
    ink: "#f2f7f4",
    inkSoft: "#d6e4dc",
    inkMuted: "#9fb5a8",
    inkFaint: "#6f8678",
    border: "#1d4533",
  },
  fontDisplay: "Georgia, 'Times New Roman', serif",
  fontSans: "Arial, Helvetica, sans-serif",
  logo: {
    url: "https://cdn.example.com/acme-logo.png",
    background: "dark",
    position: "top-centre",
  },
  showPoweredBy: false,
  // System fonts (Georgia/Arial) → no web-font @import. A real custom theme
  // always carries fontImports (here []); only pre-CT7 snapshots leave it
  // undefined, which back-fills to the Instrument default.
  fontImports: [],
};

describe("email templates — branded theme render", () => {
  it("applicationReceivedEmail carries brand palette + logo, no powered-by", () => {
    const html = applicationReceivedEmail(BRANDED_THEME, NAME, ROLE, CLIENT);
    // Brand palette + logo present; TalentStream attribution gone.
    expect(html).toContain("#006341");
    expect(html).toContain('<img src="https://cdn.example.com/acme-logo.png"');
    expect(html).not.toContain("Sent by TalentStream");
    expect(html).not.toContain("talent<span");
    expect(html).toMatchSnapshot();
  });
});

// ── CT7: shared copy (greeting / sign-off), per-type body, subjects ───
//
// These lock the new emailCopy-driven behaviour added on top of the byte-
// identical default render: the shared greeting is configurable, the sign-off is
// opt-in, a per-type body override swaps ONLY the prose (structural pieces like
// the action button survive), and subjects resolve plain-text from the theme.

/** Build a theme from the default with a patched emailCopy. */
function themeWithCopy(copy: EmailCopy): EmailTheme {
  return { ...DEFAULT_EMAIL_THEME, emailCopy: copy };
}

describe("email copy — shared greeting", () => {
  it("renders a custom shared greeting in place of the default", () => {
    const copy: EmailCopy = {
      ...DEFAULT_EMAIL_COPY,
      shared: {
        ...DEFAULT_EMAIL_COPY.shared,
        greeting: "Dear {{candidate.name}}!",
      },
    };
    const html = applicationReceivedEmail(themeWithCopy(copy), NAME, ROLE, CLIENT);
    expect(html).toContain(`Dear ${NAME}!`);
    // The default greeting is gone.
    expect(html).not.toContain("Hi Thabo Mokoena,");
    // Slot values are still HTML-escaped on the way in (the name has none here,
    // but the company name does and must remain escaped elsewhere).
  });

  it("renders the default greeting byte-equivalently for the default copy", () => {
    const html = applicationReceivedEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT);
    expect(html).toContain(`Hi ${NAME},`);
  });
});

describe("email copy — shared sign-off", () => {
  it("renders a non-empty sign-off as a closing note", () => {
    const copy: EmailCopy = {
      ...DEFAULT_EMAIL_COPY,
      shared: { ...DEFAULT_EMAIL_COPY.shared, signOff: "— The {{client.name}} team" },
    };
    const html = applicationReceivedEmail(themeWithCopy(copy), NAME, ROLE, CLIENT);
    // Slot-substituted + escaped (Açme & Co <Pty> Ltd → &amp; / &lt; / &gt;).
    expect(html).toContain("— The Açme &amp; Co &lt;Pty&gt; Ltd team");
  });

  it("renders NOTHING for an empty sign-off (the default)", () => {
    const html = applicationReceivedEmail(DEFAULT_EMAIL_THEME, NAME, ROLE, CLIENT);
    // The default sign-off is "" → no extra closing note beyond the email's own.
    // The only emailNote in this template is its own "You'll hear from us…" line.
    const noteCount = (html.match(/padding-top:18px;border-top/g) ?? []).length;
    expect(noteCount).toBe(1);
  });
});

describe("email copy — per-type body override", () => {
  it("replaces the prose for chatInvitation but keeps the action button", () => {
    const copy: EmailCopy = {
      ...DEFAULT_EMAIL_COPY,
      perType: {
        ...DEFAULT_EMAIL_COPY.perType,
        chatInvitation: {
          ...DEFAULT_EMAIL_COPY.perType.chatInvitation,
          body: "Quick chat for {{campaign.role_title}}?\n\nIt takes two minutes.",
        },
      },
    };
    const html = chatInvitationEmail(
      themeWithCopy(copy),
      NAME,
      ROLE,
      CLIENT,
      CHAT_URL
    );
    // The override prose appears, split into two paragraphs on the blank line.
    expect(html).toContain(`Quick chat for ${ROLE}?`);
    expect(html).toContain("It takes two minutes.");
    // The DEFAULT prose is gone.
    expect(html).not.toContain("follow-up questions about your application");
    // The structural pieces ALWAYS render — the action button + link survive.
    expect(html).toContain(">Start chat&ensp;");
    expect(html).toContain(`<a href="${CHAT_URL}"`);
    expect(html).toContain(CHAT_URL);
  });

  it("uses the default prose when the override body is blank", () => {
    const copy: EmailCopy = {
      ...DEFAULT_EMAIL_COPY,
      perType: {
        ...DEFAULT_EMAIL_COPY.perType,
        gatingPassed: { ...DEFAULT_EMAIL_COPY.perType.gatingPassed, body: "   \n  " },
      },
    };
    const html = gatingPassedEmail(themeWithCopy(copy), NAME, ROLE, CLIENT);
    expect(html).toContain("you meet the initial requirements");
  });
});

describe("resolveEmailSubject", () => {
  it("defaults match today's inline subjects byte-for-byte", () => {
    const data = { campaign: { role_title: ROLE } };
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "applicationReceived", data)).toBe(
      `Application received — ${ROLE}`
    );
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "gatingPassed", data)).toBe(
      `Good news — ${ROLE}`
    );
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "gatingFailed", data)).toBe(
      `Application update — ${ROLE}`
    );
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "rejection", data)).toBe(
      `Application update — ${ROLE}`
    );
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "chatInvitation", data)).toBe(
      `We'd like to chat about your application — ${ROLE}`
    );
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "chatAccess", data)).toBe(
      `Verify your identity — ${ROLE}`
    );
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "chatNudge", data)).toBe(
      `Reminder — ${ROLE}`
    );
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "noResponse", data)).toBe(
      `Application update — ${ROLE}`
    );
    expect(
      resolveEmailSubject(DEFAULT_EMAIL_THEME, "rejectionConfirmation", data)
    ).toBe(`Application update — ${ROLE}`);
  });

  it("does NOT HTML-escape the subject (plain text)", () => {
    // A role title with HTML-significant chars stays raw in the subject line.
    const data = { campaign: { role_title: "Dev & Ops <lead>" } };
    expect(resolveEmailSubject(DEFAULT_EMAIL_THEME, "applicationReceived", data)).toBe(
      "Application received — Dev & Ops <lead>"
    );
  });

  it("honours a per-type subject override", () => {
    const copy: EmailCopy = {
      ...DEFAULT_EMAIL_COPY,
      perType: {
        ...DEFAULT_EMAIL_COPY.perType,
        applicationReceived: { subject: "We got it — {{campaign.role_title}}" },
      },
    };
    expect(
      resolveEmailSubject(themeWithCopy(copy), "applicationReceived", {
        campaign: { role_title: ROLE },
      })
    ).toBe(`We got it — ${ROLE}`);
  });
});

describe("email fonts — RD-1 fontImports back-fill", () => {
  it("back-fills the Instrument @import when a pre-CT7 snapshot has no fontImports", () => {
    const legacy: EmailTheme = { ...DEFAULT_EMAIL_THEME };
    delete (legacy as Partial<EmailTheme>).fontImports;
    const html = applicationReceivedEmail(legacy, NAME, ROLE, CLIENT);
    expect(html).toContain("@import url('");
    expect(html).toContain("Instrument");
  });

  it("emits no @import for a theme that explicitly chose system fonts ([])", () => {
    const sys: EmailTheme = { ...DEFAULT_EMAIL_THEME, fontImports: [] };
    const html = applicationReceivedEmail(sys, NAME, ROLE, CLIENT);
    expect(html).not.toContain("@import");
  });
});
