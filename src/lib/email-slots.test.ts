import { describe, expect, it } from "vitest";
import {
  replaceEmailSlots,
  validateEmailTemplate,
  type EmailSlotData,
} from "@/lib/email-slots";

// ── CT6 · bespoke-email slot contract (PURE) ─────────────────────────
//
// The landing has ONE free-form template; emails have nine, each with a
// per-type allow-list and (for the action emails) a required {{action.url}} or
// the candidate dead-ends. These exercise that per-type contract + the
// conditional-block / HTML-escaping replacement, with no DB and no React.

describe("validateEmailTemplate — allow-list + script guard", () => {
  it("accepts a valid template using only the type's allowed slots", () => {
    const html =
      "<p>Hi {{candidate.name}}, your application for {{campaign.role_title}} at {{client.name}} is received.</p>";
    expect(validateEmailTemplate("applicationReceived", html)).toEqual({
      ok: true,
    });
  });

  it("rejects an empty template", () => {
    const result = validateEmailTemplate("applicationReceived", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/empty/i);
  });

  it("rejects a slot not on the template's own allow-list", () => {
    // action.url is a real slot, but applicationReceived does not allow it.
    const result = validateEmailTemplate(
      "applicationReceived",
      '<a href="{{action.url}}">go</a>'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/action\.url/);
  });

  it("rejects an entirely unknown slot", () => {
    const result = validateEmailTemplate(
      "applicationReceived",
      "<p>{{candidate.shoe_size}}</p>"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/candidate\.shoe_size/);
  });

  it("rejects a template containing a <script> tag", () => {
    const result = validateEmailTemplate(
      "applicationReceived",
      "<p>Hi {{candidate.name}}</p><script>alert(1)</script>"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/script/i);
  });
});

describe("validateEmailTemplate — required action.url safeguard", () => {
  const ACTION_TYPES = ["chatInvitation", "chatAccess", "chatNudge"] as const;

  for (const type of ACTION_TYPES) {
    it(`rejects ${type} when {{action.url}} is missing (dead-end candidate)`, () => {
      const result = validateEmailTemplate(
        type,
        "<p>Hi {{candidate.name}}, please continue.</p>"
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toMatch(/action\.url/);
    });

    it(`accepts ${type} once {{action.url}} is present in an href`, () => {
      const result = validateEmailTemplate(
        type,
        '<p>Hi {{candidate.name}}</p><a href="{{action.url}}">Continue</a>'
      );
      expect(result).toEqual({ ok: true });
    });
  }

  it("accepts the non-action types without an action.url", () => {
    const NON_ACTION = [
      "applicationReceived",
      "gatingPassed",
      "gatingFailed",
      "rejection",
      "noResponse",
      "rejectionConfirmation",
    ] as const;
    for (const type of NON_ACTION) {
      expect(validateEmailTemplate(type, "<p>Hi {{candidate.name}}.</p>")).toEqual(
        { ok: true }
      );
    }
  });
});

describe("replaceEmailSlots — substitution", () => {
  const data: EmailSlotData = {
    candidate: { name: "Sam" },
    campaign: { role_title: "Senior Engineer" },
    client: { name: "Acme Corp" },
    action: { url: "https://app.test/chat/abc" },
  };

  it("substitutes candidate.name / campaign.role_title / client.name / action.url", () => {
    const html =
      'Hi {{candidate.name}}, the {{campaign.role_title}} role at {{client.name}}: <a href="{{action.url}}">go</a>';
    const out = replaceEmailSlots(html, data);
    expect(out).toBe(
      'Hi Sam, the Senior Engineer role at Acme Corp: <a href="https://app.test/chat/abc">go</a>'
    );
  });

  it("HTML-escapes interpolated values (no markup break-out)", () => {
    const out = replaceEmailSlots("Hi {{candidate.name}}", {
      candidate: { name: '<b>"Bobby" & co</b>' },
    });
    expect(out).toBe("Hi &lt;b&gt;&quot;Bobby&quot; &amp; co&lt;/b&gt;");
  });

  it("strips an empty {{#admin.reason}}…{{/admin.reason}} block", () => {
    const html =
      "Decision made.{{#admin.reason}} Note: {{admin.reason}}{{/admin.reason}} Thanks.";
    // No admin.reason supplied → the whole conditional block disappears.
    expect(replaceEmailSlots(html, {})).toBe("Decision made. Thanks.");
  });

  it("keeps the {{#admin.reason}} block and substitutes it when present", () => {
    const html =
      "Decision made.{{#admin.reason}} Note: {{admin.reason}}{{/admin.reason}} Thanks.";
    const out = replaceEmailSlots(html, { admin: { reason: "Strong CV" } });
    expect(out).toBe("Decision made. Note: Strong CV Thanks.");
  });

  it("renders an absent slot as the empty string", () => {
    expect(replaceEmailSlots("[{{candidate.name}}]", {})).toBe("[]");
  });
});
