import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATE_TYPES } from "@/lib/email-slots";
import {
  DEFAULT_LANDING_COPY,
  DEFAULT_EMAIL_COPY,
  normaliseLandingCopy,
  normaliseEmailCopy,
  type EmailCopy,
} from "@/lib/theme-copy";

describe("DEFAULT_LANDING_COPY", () => {
  it("has the expected default values", () => {
    expect(DEFAULT_LANDING_COPY.headline).toBe("Join {{client.name}}");
    expect(DEFAULT_LANDING_COPY.intro).toContain("We're glad you're here.");
    expect(DEFAULT_LANDING_COPY.highlights).toHaveLength(3);
    expect(DEFAULT_LANDING_COPY.applyHeading).toBe("Apply for this role");
  });
});

describe("DEFAULT_EMAIL_COPY", () => {
  it("has the expected shared defaults", () => {
    expect(DEFAULT_EMAIL_COPY.shared.greeting).toBe("Hi {{candidate.name}},");
    expect(DEFAULT_EMAIL_COPY.shared.signOff).toBe("");
    expect(DEFAULT_EMAIL_COPY.shared.footer).toBe(
      "Automated message — please do not reply"
    );
  });

  it("provides a subject for all nine template types containing the role-title slot", () => {
    expect(EMAIL_TEMPLATE_TYPES).toHaveLength(9);
    for (const type of EMAIL_TEMPLATE_TYPES) {
      const entry = DEFAULT_EMAIL_COPY.perType[type];
      expect(entry, `missing default for ${type}`).toBeDefined();
      expect(entry?.subject).toBeTruthy();
      expect(entry?.subject).toContain("{{campaign.role_title}}");
      // Subjects are defaulted here; bodies are not.
      expect(entry?.body).toBeUndefined();
    }
  });

  it("matches the exact live subjects (with em dash + role-title slot)", () => {
    expect(DEFAULT_EMAIL_COPY.perType.applicationReceived?.subject).toBe(
      "Application received — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.gatingPassed?.subject).toBe(
      "Good news — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.gatingFailed?.subject).toBe(
      "Application update — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.rejection?.subject).toBe(
      "Application update — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.chatInvitation?.subject).toBe(
      "We'd like to chat about your application — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.chatAccess?.subject).toBe(
      "Verify your identity — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.chatNudge?.subject).toBe(
      "Reminder — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.noResponse?.subject).toBe(
      "Application update — {{campaign.role_title}}"
    );
    expect(DEFAULT_EMAIL_COPY.perType.rejectionConfirmation?.subject).toBe(
      "Application update — {{campaign.role_title}}"
    );
    // Real em dash, not a hyphen.
    expect(DEFAULT_EMAIL_COPY.perType.gatingPassed?.subject).toContain("—");
  });
});

describe("normaliseLandingCopy", () => {
  it("passes null/undefined through as null", () => {
    expect(normaliseLandingCopy(null)).toEqual({ ok: true, value: null });
    expect(normaliseLandingCopy(undefined)).toEqual({ ok: true, value: null });
  });

  it("merges a partial object over the defaults", () => {
    const res = normaliseLandingCopy({ headline: "  Hello there  " });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).not.toBeNull();
    expect(res.value?.headline).toBe("Hello there"); // trimmed
    expect(res.value?.intro).toBe(DEFAULT_LANDING_COPY.intro); // from default
    expect(res.value?.applyHeading).toBe(DEFAULT_LANDING_COPY.applyHeading);
    expect(res.value?.highlights).toEqual(DEFAULT_LANDING_COPY.highlights);
  });

  it("falls back to the default when a string field is blank after trim", () => {
    const res = normaliseLandingCopy({ headline: "   " });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.headline).toBe(DEFAULT_LANDING_COPY.headline);
  });

  it("drops blank highlights and trims the rest", () => {
    const res = normaliseLandingCopy({
      highlights: ["  Real bullet  ", "", "   ", "Another"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.highlights).toEqual(["Real bullet", "Another"]);
  });

  it("caps highlights at 6", () => {
    const res = normaliseLandingCopy({
      highlights: ["1", "2", "3", "4", "5", "6", "7", "8"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.highlights).toHaveLength(6);
    expect(res.value?.highlights).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("rejects wrong types", () => {
    expect(normaliseLandingCopy({ headline: 123 }).ok).toBe(false);
    expect(normaliseLandingCopy({ highlights: "not an array" }).ok).toBe(false);
    expect(normaliseLandingCopy({ highlights: [1, 2] }).ok).toBe(false);
    expect(normaliseLandingCopy("a string").ok).toBe(false);
  });

  it("rejects <script> (case-insensitive) in any string field", () => {
    expect(normaliseLandingCopy({ headline: "<SCRIPT>alert(1)</script>" }).ok).toBe(
      false
    );
    expect(
      normaliseLandingCopy({ highlights: ["fine", "<script>x</script>"] }).ok
    ).toBe(false);
  });

  it("accepts the default landing slot (client.name) but rejects unknown/email-only slots", () => {
    // The default headline uses {{client.name}} — a valid landing slot.
    expect(normaliseLandingCopy({ headline: "Join {{client.name}}" }).ok).toBe(true);
    // candidate.name is an EMAIL slot, not a landing slot — would render literally
    // on the public page, so it's rejected at write time.
    const bad = normaliseLandingCopy({ headline: "Hi {{candidate.name}}" });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("expected rejection");
    expect(bad.message).toContain("candidate.name");
    // Same guard on highlights.
    expect(
      normaliseLandingCopy({ highlights: ["{{action.url}}"] }).ok
    ).toBe(false);
  });
});

describe("normaliseEmailCopy", () => {
  it("passes null/undefined through as null", () => {
    expect(normaliseEmailCopy(null)).toEqual({ ok: true, value: null });
    expect(normaliseEmailCopy(undefined)).toEqual({ ok: true, value: null });
  });

  it("returns shared completed from defaults with a sparse perType", () => {
    const res = normaliseEmailCopy({ shared: { greeting: "Hey {{candidate.name}}!" } });
    expect(res.ok).toBe(true);
    if (!res.ok || res.value === null) throw new Error("expected value");
    expect(res.value.shared.greeting).toBe("Hey {{candidate.name}}!");
    expect(res.value.shared.signOff).toBe(DEFAULT_EMAIL_COPY.shared.signOff);
    expect(res.value.shared.footer).toBe(DEFAULT_EMAIL_COPY.shared.footer);
    expect(res.value.perType).toEqual({});
  });

  it("falls back to default when a shared field is blank after trim", () => {
    const res = normaliseEmailCopy({ shared: { footer: "   " } });
    expect(res.ok).toBe(true);
    if (!res.ok || res.value === null) throw new Error("expected value");
    expect(res.value.shared.footer).toBe(DEFAULT_EMAIL_COPY.shared.footer);
  });

  it("rejects an unknown perType key, listing allowed types", () => {
    const res = normaliseEmailCopy({ perType: { nope: { subject: "x" } } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("nope");
    expect(res.message).toContain("applicationReceived");
  });

  it("drops perType entries with neither subject nor body", () => {
    const res = normaliseEmailCopy({
      perType: { rejection: { subject: "   ", body: "" } },
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.value === null) throw new Error("expected value");
    expect(res.value.perType.rejection).toBeUndefined();
  });

  it("trims subject/body and keeps entries with content", () => {
    const res = normaliseEmailCopy({
      perType: { rejection: { subject: "  Custom  ", body: "  Hi  " } },
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.value === null) throw new Error("expected value");
    expect(res.value.perType.rejection).toEqual({
      subject: "Custom",
      body: "Hi",
    });
  });

  it("rejects <script> in a subject or body", () => {
    expect(
      normaliseEmailCopy({ perType: { rejection: { subject: "<script>x</script>" } } })
        .ok
    ).toBe(false);
    expect(
      normaliseEmailCopy({ perType: { rejection: { body: "<SCRIPT>y</script>" } } }).ok
    ).toBe(false);
    expect(normaliseEmailCopy({ shared: { footer: "<script>z</script>" } }).ok).toBe(
      false
    );
  });

  it("rejects wrong shapes", () => {
    expect(normaliseEmailCopy("nope").ok).toBe(false);
    expect(normaliseEmailCopy({ shared: "nope" }).ok).toBe(false);
    expect(normaliseEmailCopy({ perType: "nope" }).ok).toBe(false);
    expect(normaliseEmailCopy({ perType: { rejection: 1 } }).ok).toBe(false);
    expect(
      normaliseEmailCopy({ perType: { rejection: { subject: 1 } } }).ok
    ).toBe(false);
  });

  it("round-trips a valid full emailCopy", () => {
    const full: EmailCopy = {
      shared: {
        greeting: "Hello {{candidate.name}},",
        signOff: "Best regards,",
        footer: "Sent by the hiring team",
      },
      perType: {
        applicationReceived: {
          subject: "Got it — {{campaign.role_title}}",
          body: "Thanks for applying to {{client.name}}.",
        },
        chatInvitation: {
          subject: "Let's chat — {{campaign.role_title}}",
          body: "Click here: {{action.url}}",
        },
      },
    };
    const res = normaliseEmailCopy(full);
    expect(res.ok).toBe(true);
    if (!res.ok || res.value === null) throw new Error("expected value");
    expect(res.value).toEqual(full);
  });

  it("rejects a per-type override that uses a slot the type does not provide", () => {
    // applicationReceived has no action.url slot — referencing it would render empty.
    const res = normaliseEmailCopy({
      perType: { applicationReceived: { body: "Click {{action.url}}" } },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected rejection");
    expect(res.message).toContain("action.url");
  });

  it("rejects a shared block slot that isn't available on every email type", () => {
    // client.name is absent on chatAccess, so a shared greeting can't use it.
    const res = normaliseEmailCopy({
      shared: { greeting: "Hi from {{client.name}}" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected rejection");
    expect(res.message).toContain("client.name");
  });

  it("accepts a per-type override whose slot the type DOES provide", () => {
    // chatInvitation provides action.url.
    const res = normaliseEmailCopy({
      perType: { chatInvitation: { body: "Continue: {{action.url}}" } },
    });
    expect(res.ok).toBe(true);
  });
});
