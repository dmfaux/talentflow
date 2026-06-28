import { describe, expect, it } from "vitest";
import {
  attestationWording,
  CONSENT_ATTESTATIONS,
  CURRENT_ATTESTATION,
  isAttestationVersion,
  isConsentBasis,
  validateConsent,
} from "@/lib/consent";

describe("consent attestation registry", () => {
  it("CURRENT_ATTESTATION points at a real entry", () => {
    expect(isAttestationVersion(CURRENT_ATTESTATION)).toBe(true);
    expect(attestationWording(CURRENT_ATTESTATION)).toBe(
      CONSENT_ATTESTATIONS[CURRENT_ATTESTATION]
    );
  });

  it("rejects unknown versions and bases", () => {
    expect(isAttestationVersion("v999")).toBe(false);
    expect(isAttestationVersion(undefined)).toBe(false);
    expect(isConsentBasis("telepathy")).toBe(false);
    expect(isConsentBasis(null)).toBe(false);
  });
});

describe("validateConsent", () => {
  it("accepts a fixed basis and drops any stray note", () => {
    const result = validateConsent({
      version: CURRENT_ATTESTATION,
      basis: "verbal",
      note: "ignored for non-other",
    });
    expect(result).toEqual({
      ok: true,
      value: { version: CURRENT_ATTESTATION, basis: "verbal", note: null },
    });
  });

  it("accepts 'other' with a trimmed note", () => {
    const result = validateConsent({
      version: CURRENT_ATTESTATION,
      basis: "other",
      note: "  met at a careers fair  ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        version: CURRENT_ATTESTATION,
        basis: "other",
        note: "met at a careers fair",
      },
    });
  });

  it("rejects 'other' with no note", () => {
    expect(
      validateConsent({ version: CURRENT_ATTESTATION, basis: "other", note: "   " })
    ).toEqual({ ok: false, error: "note_required_for_other" });
    expect(
      validateConsent({ version: CURRENT_ATTESTATION, basis: "other" })
    ).toEqual({ ok: false, error: "note_required_for_other" });
  });

  it("rejects an unknown attestation version", () => {
    expect(
      validateConsent({ version: "v0", basis: "verbal" })
    ).toEqual({ ok: false, error: "unknown_attestation_version" });
  });

  it("rejects an unknown basis", () => {
    expect(
      validateConsent({ version: CURRENT_ATTESTATION, basis: "vibes" })
    ).toEqual({ ok: false, error: "unknown_basis" });
  });
});
