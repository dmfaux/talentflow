/**
 * Pure blob-path helpers shared by the storage layer (azure-storage.ts), the
 * one-off backfill script, and their unit tests. No Azure SDK, no env reads,
 * no I/O — safe to import anywhere and exhaustively unit-testable (S6).
 *
 * Path scheme (S6 — org-prefixed):
 *   CVs    → cvs/{orgId}/{brandSlug}/{candidateId}/{filename}
 *   Logos  → logos/{orgId}/{clientId}/{filename}
 */

/** Org-prefixed CV blob key. `brandSlug === client.slug`; the legacy scheme's
 *  `{campaignSlug}` segment is intentionally dropped. */
export function cvBlobPath(
  orgId: string,
  brandSlug: string,
  candidateId: string,
  filename: string
): string {
  return `cvs/${orgId}/${brandSlug}/${candidateId}/${filename}`;
}

/** Org-prefixed logo blob key (stored in the public logos container). */
export function logoBlobPath(
  orgId: string,
  clientId: string,
  filename: string
): string {
  return `logos/${orgId}/${clientId}/${filename}`;
}

/** Reduce a stored value to a container-relative blob key — tolerant variant
 *  used by the storage helpers. Post-S6 the stored value is already a bare key,
 *  so the prefix strip is a no-op; a legacy full URL `${containerUrl}/${key}`
 *  is reduced to `key`. A full URL whose host is NOT this container passes
 *  through unchanged (the original defensive `.replace` behaviour). */
export function blobKeyFromStored(stored: string, containerUrl: string): string {
  const prefix = containerUrl.replace(/\/$/, "") + "/";
  return decodeURIComponent(stored.replace(prefix, ""));
}

/** Strict variant used by the backfill: reduce a stored cv_url to a blob key,
 *  but return null when the value is a full URL whose host is NOT this storage
 *  container (e.g. the old `example.blob.core.windows.net` seed placeholders).
 *  The caller nulls/skips those — they can never be moved. */
export function toBlobKey(stored: string, containerUrl: string): string | null {
  if (/^https?:\/\//i.test(stored)) {
    const prefix = containerUrl.replace(/\/$/, "") + "/";
    if (!stored.startsWith(prefix)) return null;
    return decodeURIComponent(stored.slice(prefix.length));
  }
  return decodeURIComponent(stored);
}

/** Compute the org-prefixed new path for a legacy cv_url key. The filename is
 *  the last segment of the old key (legacy:
 *  `cvs/{clientSlug}/{campaignSlug}/{candidateId}/{filename}`). */
export function migratedCvPath(
  oldKey: string,
  orgId: string,
  brandSlug: string,
  candidateId: string
): string {
  const filename = oldKey.split("/").pop() || "cv";
  return cvBlobPath(orgId, brandSlug, candidateId, filename);
}
