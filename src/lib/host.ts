import { RESERVED_SLUGS } from "@/lib/slug";

// ── Pure host classifier (S12) ───────────────────────────────────────
//
// Splits the authenticated app host (admin + operator) from the public
// per-brand careers subdomains. Pure — no `db`, no `next/headers`, no env reads
// beyond the `appDomain` argument — so it is edge-safe and importable into the
// proxy bundle exactly like `token.ts`. The proxy must never read the DB (Next.js
// Proxy docs); brand→org resolution stays downstream in the handlers, which key
// off the brand slug this classifier extracts from the host.

export type HostKind =
  | { kind: "app" } // app.{domain} or localhost → (admin)+(operator)
  | { kind: "marketing" } // apex, www.{domain}, or a foreign host → public landing
  | { kind: "careers"; brandSlug: string } // {brand}.{domain} → /c/{brand}
  | { kind: "reserved" }; // a reserved subdomain that is not `app`/`www`

const APP_SUBDOMAIN = "app";

export function isLocalDev(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.startsWith("localhost:") ||
    hostname.startsWith("127.0.0.1")
  );
}

/**
 * Classify the incoming Host header. `appDomain` is NEXT_PUBLIC_APP_DOMAIN
 * (e.g. "talentstream.co.za").
 *
 * - localhost / 127.0.0.1            → app   (single-host dev, no subdomain needed)
 * - empty appDomain                  → app   (single-host dev with the domain unset)
 * - apex / www.{appDomain}           → marketing
 * - host not under .{appDomain}      → marketing (foreign / spoofed host — safe default)
 * - app.{appDomain}                  → app
 * - {reserved}.{appDomain}           → reserved (never a brand — see RESERVED_SLUGS)
 * - {brand}.{appDomain}              → careers (brandSlug = the subdomain)
 *
 * Pure: no DB, no env reads beyond the `appDomain` argument.
 */
export function classifyHost(rawHost: string, appDomain: string): HostKind {
  if (isLocalDev(rawHost)) return { kind: "app" }; // local-dev fallback

  const host = (rawHost.split(":")[0] ?? "").toLowerCase(); // strip port

  if (!appDomain || host === appDomain || host === `www.${appDomain}`) {
    // No appDomain configured → single-host dev (everything is the app).
    // Otherwise the apex and www are the public marketing face.
    return { kind: appDomain ? "marketing" : "app" };
  }
  if (!host.endsWith(`.${appDomain}`)) return { kind: "marketing" }; // foreign host

  const sub = host.slice(0, -`.${appDomain}`.length);
  if (!sub || sub.includes(".")) return { kind: "marketing" }; // empty / multi-level
  if (sub === APP_SUBDOMAIN) return { kind: "app" };
  if (RESERVED_SLUGS.includes(sub)) return { kind: "reserved" }; // never a brand
  return { kind: "careers", brandSlug: sub };
}

/**
 * The canonical app-host origin for cross-surface redirects (logout, the
 * marketing→app bounce). Tracks the `app.` subdomain so a session cookie is
 * always set on the host that serves the authenticated shells.
 */
export function appHostOrigin(): string {
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  return domain ? `https://${APP_SUBDOMAIN}.${domain}` : "http://localhost:3000";
}
