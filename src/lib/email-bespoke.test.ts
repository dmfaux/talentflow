import { describe, expect, it } from "vitest";
import {
  applicationReceivedEmail,
  chatInvitationEmail,
} from "@/lib/email";
import { DEFAULT_EMAIL_THEME, type EmailTheme } from "@/lib/theme";
import type { EmailTemplateMap } from "@/lib/email-slots";

// ── Bespoke email dispatch (CT6) ─────────────────────────────────────
//
// PURE tests (no DB): the nine themed email helpers render an operator-authored
// bespoke template when the theme carries one on `emailTemplates`, and otherwise
// fall back UNCHANGED to the generated email kit. A theme without emailTemplates
// (gallery/default) must be byte-identical to pre-CT6.

const NAME = "Thabo Mokoena";
const ROLE = "Senior Backend Engineer";
const CLIENT = "Açme & Co";
const CHAT_URL = "https://app.talentstream.co.za/c/acme/senior-backend/chat?t=abc123";

/** A custom theme carrying a bespoke applicationReceived override. Built on the
 *  default theme so only the bespoke branch differs. */
function themeWith(templates: EmailTemplateMap): EmailTheme {
  return { ...DEFAULT_EMAIL_THEME, emailTemplates: templates };
}

describe("bespoke email dispatch (CT6)", () => {
  it("renders the operator template with slot substitution, wrapped in the shared shell", () => {
    const theme = themeWith({
      applicationReceived:
        "<p>Hi {{candidate.name}} — {{campaign.role_title}}</p>",
    });
    const html = applicationReceivedEmail(theme, NAME, ROLE, CLIENT);
    // CT7: the bespoke body now fills only the BODY REGION of the one shared
    // wrapper (palette / fonts / footer) — it is no longer a standalone document.
    expect(html).toContain(`<p>Hi ${NAME} — ${ROLE}</p>`);
    // The shared wrapper surrounds it: full document shell + brand card + footer.
    expect(html).toContain("<!DOCTYPE");
    expect(html).toContain("<table");
    expect(html).toContain("Sent by TalentStream");
    // The kit's OWN default copy is gone — the bespoke body replaced the whole
    // body region (heading + greeting + message + extras + sign-off).
    expect(html).not.toContain("got your application");
    expect(html).not.toContain("Hi Thabo Mokoena,");
  });

  it("falls back to the kit output when the theme carries no emailTemplates", () => {
    // Same theme, but no bespoke override at all → unchanged kit render.
    const html = applicationReceivedEmail(
      DEFAULT_EMAIL_THEME,
      NAME,
      ROLE,
      CLIENT
    );
    // Kit markers: the table-based HTML shell and the confirmation copy.
    expect(html).toContain("<table");
    expect(html).toContain("got your application");
    expect(html).toContain(NAME);
    expect(html).toContain(ROLE);
  });

  it("falls back to the kit when this type is absent but others are present", () => {
    // emailTemplates is non-null but lacks applicationReceived → fall back.
    const theme = themeWith({
      rejection: "<p>Bespoke rejection</p>",
    });
    const html = applicationReceivedEmail(theme, NAME, ROLE, CLIENT);
    expect(html).toContain("<table");
    expect(html).toContain("got your application");
  });

  it("falls back to the kit when the stored template is blank/whitespace", () => {
    const theme = themeWith({ applicationReceived: "   \n  " });
    const html = applicationReceivedEmail(theme, NAME, ROLE, CLIENT);
    expect(html).toContain("<table");
    expect(html).toContain("got your application");
  });

  it("renders {{action.url}} for a bespoke chatInvitation template, wrapped in the shared shell", () => {
    const theme = themeWith({
      chatInvitation:
        '<a href="{{action.url}}">Start the chat with {{candidate.name}}</a>',
    });
    const html = chatInvitationEmail(theme, NAME, ROLE, CLIENT, CHAT_URL);
    // The action link is slot-substituted inside the shared wrapper's body region.
    expect(html).toContain(
      `<a href="${CHAT_URL}">Start the chat with ${NAME}</a>`
    );
    expect(html).toContain(CHAT_URL);
    // Wrapper present (document shell + footer); kit's own default copy gone.
    expect(html).toContain("<!DOCTYPE");
    expect(html).toContain("Sent by TalentStream");
    expect(html).not.toContain("follow-up questions");
  });
});
