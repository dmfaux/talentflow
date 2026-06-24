import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATE_TYPES } from "@/lib/email-slots";
import { DEFAULT_LANDING_COPY, DEFAULT_EMAIL_COPY } from "@/lib/theme-copy";

// The structured-copy override axis was removed — copy is now a single in-code
// default shared by every theme. These lock the defaults the renderers read.

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
