/**
 * Shared CV filename construction for the shortlist report and the CV
 * archive download. Both surfaces must use the same ranking and naming —
 * admins cross-reference filenames printed on the report against the
 * entries in the downloaded zip.
 */

export function sanitiseForFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

export function extensionFromUrl(url: string): string {
  const path = url.split("?")[0];
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  if (dot <= slash) return ".pdf";
  return path.slice(dot).toLowerCase();
}

export interface CvManifestEntry<T> {
  candidate: T;
  /** 1-based rank across ALL shortlisted candidates, with or without CVs. */
  rank: number;
  /** Zero-padded archive/display filename, or null when no CV is on file. */
  filename: string | null;
}

/**
 * Ranks are assigned across the full shortlist (including candidates with
 * no CV on file) so the numbering always matches the report's candidate
 * order; archive consumers filter on `filename !== null` and keep the rank.
 */
export function buildCvManifest<
  T extends { name: string; cv_url: string | null },
>(shortlisted: T[]): CvManifestEntry<T>[] {
  const padWidth = Math.max(2, String(shortlisted.length).length);
  return shortlisted.map((candidate, idx) => {
    const rank = idx + 1;
    if (!candidate.cv_url) return { candidate, rank, filename: null };
    const safeName = sanitiseForFilename(candidate.name) || "candidate";
    const ext = extensionFromUrl(candidate.cv_url);
    return {
      candidate,
      rank,
      filename: `${String(rank).padStart(padWidth, "0")}_${safeName}${ext}`,
    };
  });
}
