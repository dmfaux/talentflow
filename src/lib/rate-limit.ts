// ── In-memory rate limiter (S8) ──────────────────────────────────────
//
// A minimal fixed-window counter keyed by an arbitrary string (e.g. org_id).
// V1-only and PROCESS-LOCAL: it does not coordinate across instances / a
// serverless fleet, so it cannot be the security guarantee — the global unique
// index on clients.slug remains that. Its job is to blunt brand-slug
// enumeration through check-slug / brand-create on a single instance, cheaply.
//
// No background timer: each call lazily resets its own expired window, and a
// touched-key prune keeps the map from growing without bound under churn.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000; // safety cap; prune expired entries past this size

function prune(now: number): void {
  for (const [k, w] of windows) {
    if (now >= w.resetAt) windows.delete(k);
  }
}

/** Record a hit against `key` and report whether it is within `limit` per
 *  `windowMs`. Returns true when allowed, false when the cap is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);

  if (!w || now >= w.resetAt) {
    if (windows.size > MAX_KEYS) prune(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

/** Test-only: clear all windows so limits don't leak across test cases. */
export function __resetRateLimits(): void {
  windows.clear();
}
