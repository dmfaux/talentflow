// ── Recruiter consent attestation (manual candidate add, skip/vouch path) ──
//
// When a recruiter adds a candidate without the candidate completing the public
// form, the recruiter ATTESTS they hold the candidate's consent to be processed
// under POPIA. That attestation is a legal record that must stay provable even
// after the wording changes, so the copy is a VERSIONED, append-only constant
// here and the `consent_attested` audit row stores BOTH the version key and the
// verbatim wording resolved from it — never client-supplied text.
//
// This module is pure (no db / no next / no react) so it is trivially testable.

export const CONSENT_ATTESTATIONS = {
  v1: "I confirm I have the candidate's consent to add them to this campaign and to process their personal information for recruitment purposes under POPIA.",
} as const;

export type AttestationVersion = keyof typeof CONSENT_ATTESTATIONS;

/** The wording shown to recruiters today. When the attestation copy changes,
 *  add a NEW key (e.g. `v2`) — never edit an existing entry, or historical
 *  audit rows would no longer match the constant they reference. */
export const CURRENT_ATTESTATION: AttestationVersion = "v1";

export function isAttestationVersion(v: unknown): v is AttestationVersion {
  return typeof v === "string" && v in CONSENT_ATTESTATIONS;
}

/** Resolve the verbatim wording for a version. The server always re-derives the
 *  wording from the (validated) version rather than trusting any client-sent
 *  text, then freezes the result into the audit row. */
export function attestationWording(v: AttestationVersion): string {
  return CONSENT_ATTESTATIONS[v];
}

/** Recruiter-declared lawful basis for holding the candidate's consent. */
export const CONSENT_BASES = [
  "verbal",
  "written",
  "prior_application",
  "existing_relationship",
  "other",
] as const;

export type ConsentBasis = (typeof CONSENT_BASES)[number];

export function isConsentBasis(v: unknown): v is ConsentBasis {
  return (
    typeof v === "string" && (CONSENT_BASES as readonly string[]).includes(v)
  );
}

/** A validated attestation, ready to persist + audit. */
export interface ConsentAttestation {
  version: AttestationVersion;
  basis: ConsentBasis;
  /** Required free-text when basis === "other"; otherwise null. */
  note: string | null;
}

export type ConsentValidationError =
  | "unknown_attestation_version"
  | "unknown_basis"
  | "note_required_for_other";

export type ConsentValidationResult =
  | { ok: true; value: ConsentAttestation }
  | { ok: false; error: ConsentValidationError };

/**
 * Validate a raw consent payload from the add-candidate request. Pure — the
 * route maps a failure to a 400. On success the note is trimmed (and forced to
 * null unless the basis is "other"), so the persisted shape is canonical.
 */
export function validateConsent(input: {
  version?: unknown;
  basis?: unknown;
  note?: unknown;
}): ConsentValidationResult {
  if (!isAttestationVersion(input.version)) {
    return { ok: false, error: "unknown_attestation_version" };
  }
  if (!isConsentBasis(input.basis)) {
    return { ok: false, error: "unknown_basis" };
  }
  const trimmed =
    typeof input.note === "string" && input.note.trim()
      ? input.note.trim()
      : null;
  if (input.basis === "other" && !trimmed) {
    return { ok: false, error: "note_required_for_other" };
  }
  // Only "other" carries a note; drop stray notes on the fixed bases.
  const note = input.basis === "other" ? trimmed : null;
  return { ok: true, value: { version: input.version, basis: input.basis, note } };
}
