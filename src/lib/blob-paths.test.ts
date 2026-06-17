import { describe, expect, it } from "vitest";
import {
  blobKeyFromStored,
  cvBlobPath,
  logoBlobPath,
  migratedCvPath,
  toBlobKey,
} from "@/lib/blob-paths";

// Container URL shapes the helpers must handle (Azurite + real Azure).
const AZURITE = "http://127.0.0.1:10000/devstoreaccount1/interview-insider";
const AZURE = "https://acct.blob.core.windows.net/interview-insider";

describe("cvBlobPath", () => {
  it("builds the org-prefixed CV path (no campaign segment)", () => {
    expect(cvBlobPath("org-1", "acme", "cand-9", "resume.pdf")).toBe(
      "cvs/org-1/acme/cand-9/resume.pdf"
    );
  });
});

describe("logoBlobPath", () => {
  it("builds the org-prefixed logo path", () => {
    expect(logoBlobPath("org-1", "client-7", "logo.png")).toBe(
      "logos/org-1/client-7/logo.png"
    );
  });
});

describe("blobKeyFromStored (tolerant — storage helpers)", () => {
  const key = "cvs/org-1/acme/cand-9/resume.pdf";

  it("returns a bare path unchanged (post-S6 stored value)", () => {
    expect(blobKeyFromStored(key, AZURITE)).toBe(key);
  });

  it("reduces a full legacy URL to the same key (backward compat)", () => {
    expect(blobKeyFromStored(`${AZURITE}/${key}`, AZURITE)).toBe(key);
    expect(blobKeyFromStored(`${AZURE}/${key}`, AZURE)).toBe(key);
  });

  it("a bare path and its full URL reduce identically", () => {
    expect(blobKeyFromStored(key, AZURITE)).toBe(
      blobKeyFromStored(`${AZURITE}/${key}`, AZURITE)
    );
  });

  it("decodes percent-encoding from a stored value", () => {
    expect(blobKeyFromStored("cvs/org-1/acme/c/my%20cv.pdf", AZURITE)).toBe(
      "cvs/org-1/acme/c/my cv.pdf"
    );
  });
});

describe("toBlobKey (strict — backfill)", () => {
  const key = "cvs/org-1/acme/cand-9/resume.pdf";

  it("returns a bare path unchanged", () => {
    expect(toBlobKey(key, AZURITE)).toBe(key);
  });

  it("reduces a same-account full URL to its key", () => {
    expect(toBlobKey(`${AZURITE}/${key}`, AZURITE)).toBe(key);
  });

  it("flags a foreign-host URL as unmovable (null)", () => {
    expect(
      toBlobKey(
        "https://example.blob.core.windows.net/cvs/acme/dev/jane_at_x.com.pdf",
        AZURITE
      )
    ).toBeNull();
  });
});

describe("migratedCvPath (legacy → new)", () => {
  it("drops the campaign segment and adds the org prefix", () => {
    // legacy: cvs/{clientSlug}/{campaignSlug}/{candidateId}/{filename}
    const oldKey = "cvs/acme/senior-dev/cand-9/resume.pdf";
    expect(migratedCvPath(oldKey, "org-1", "acme", "cand-9")).toBe(
      "cvs/org-1/acme/cand-9/resume.pdf"
    );
  });

  it("falls back to 'cv' when the old key has no filename segment", () => {
    expect(migratedCvPath("", "org-1", "acme", "cand-9")).toBe(
      "cvs/org-1/acme/cand-9/cv"
    );
  });
});
