import { describe, expect, it } from "vitest";
import { replaceEmailSlots, type EmailSlotData } from "@/lib/email-slots";

// ── Email slot substitution (PURE) ──────────────────────────────────
//
// The {{slot}} substitution used to inject dynamic data into the deterministic
// email bodies + default copy. Exercises the conditional-block / HTML-escaping
// replacement, with no DB and no React.

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
