# S12 · Dedicated app host vs public careers subdomain routing

> **Phase 3 — Cost control, lifecycle, routing, cleanup**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** cleanly separate the authenticated app host (admin + operator) from public per-brand careers subdomains.
- **Backend:** rework `middleware.ts` — explicit **app host** serving `(admin)`+`(operator)` with auth required; all other subdomains = public careers → `/c/{brandSlug}`; reserve `app`/`www`; host-aware `/api` early return; keep the shared verifier (S2) + local-dev fallback. Careers resolution carries `org_id` for downstream inserts. **Per AGENTS.md, read `node_modules/next/dist/docs` for Next.js 16 middleware/proxy conventions first.**
- **Frontend:** public careers unchanged visually (logos via S6 signed/public path); app-host login distinct from careers.
- **Acceptance:** app + operator console reachable only on the app host; a brand careers subdomain serves only that brand's active campaigns and cannot surface another org's; reserved hosts never resolve to a brand; apply/events on a careers host insert correct `org_id`/brand; localhost still works.
- **Depends on:** S9 · **Risks:** DNS/wildcard cert is infra (coordinate); keep brand→org resolution cheap/cached at the edge; coordinate `APP_DOMAIN` (demo links).

---

# Implementation Spec: S12 · Dedicated app host vs public careers subdomain routing

**Generated**: 2026-06-18
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `ebdd023` (**S10 has now landed** — `Add per-org usage metering + tenant-safe queue dedup + per-brand email (S10)`; `usage_events`, `EnqueueOptions.orgId`, populated `jobs.org_id`, and `clients.from_name/reply_to_email` are all in the tree). **S11 (`s11-tenant-lifecycle.md`) is in the process of being delivered** — its `org.status` refusals in the public careers handlers and login, the seam status gate, and the operator lifecycle routes are landing concurrently. S12 **`Depends on: S9`** (operator provisioning — landed at `345d6c9`); the brand/org substrate it routes over is fully in place.
**Change type**: **Backend-only** (a `proxy.ts` rework + one pure host-classification helper + absolute-URL/host coordination). No net-new screens or components — the careers and login pages are unchanged *visually*; only the host that serves them moves. See **Frontend & cross-surface coordination** for the handful of URL/host wiring touches (none of which add UI, so the `frontend-design` skill is **not** triggered unless the team elects to add a "wrong host" landing — Decision E).

> **Three findings that shape the slice as written — read first.**
> 1. **The "middleware" is `src/proxy.ts`, and it must not read the DB.** Next.js 16 renamed the `middleware` file convention to **proxy** (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` — *"Middleware is deprecated and renamed to Proxy"*); the getting-started guide is explicit that Proxy *"is **not** intended for slow data fetching … it should not be used as a full session management or authorization solution"* (`…/01-getting-started/16-proxy.md`). The existing file already encodes this rule in a comment (`proxy.ts:66-67`: *"the proxy must not read the DB … the canonical tenant guard is requireTenant()"*). **Consequence:** the slice's *"Careers resolution carries `org_id` for downstream inserts"* cannot mean "resolve `org_id` in the proxy" — there is no DB at the edge. It means the proxy carries the **brand slug** (via the `/c/{brandSlug}` rewrite), and the **handlers resolve `org_id` from that slug downstream, exactly as they already do** (apply `:32-47,:132`, events `:59-64,:78`, request-access `:23-52`). S12's job is to route the slug correctly and keep those resolutions intact — not to add an edge DB read.
> 2. **`clients.slug` is GLOBALLY unique — that is what makes the org-less subdomain rewrite safe.** `schema.ts:54` (`slug … .notNull().unique()`) + `clients_slug_idx` (`:81`), reaffirmed by the plan (§6 line 57: *"Brand `slug` stays **globally unique** to back the org-less subdomain rewrite"*), S13 (*"`clients.slug` global unique"*), and S14 (*"same brand slug can't exist in both orgs"*). So a subdomain maps **1:1** to a brand and transitively to exactly one org via `clients.org_id` (NOT NULL FK). The acceptance *"a brand careers subdomain … cannot surface another org's"* is therefore **structurally guaranteed** once the proxy pins the slug from the host: `nedbank.{domain}/x` rewrites to `/c/nedbank/x`, and any attempt to reach another brand by path (`nedbank.{domain}/c/other/role` → `/c/nedbank/c/other/role`) is a non-route → 404. The slug is the boundary; the proxy just fixes it.
> 3. **The reserved-namespace already exists — `RESERVED_SLUGS` — but the proxy only honours `www`.** `src/lib/slug.ts:7-10` defines `["www","api","app","admin","mail","ftp","staging","dev","test","status","cdn","assets"]` and `validateSlug` (`:29`) blocks brands from taking any of them at provisioning (tested in `provisioning.test.ts:26-28`). The current proxy hard-codes only `subdomain !== "www"` (`proxy.ts:35`), so today `app.{domain}` would wrongly rewrite to `/c/app` (404, because `app` can't be a brand). S12 must (a) make **`app`** the **app host**, (b) treat the **whole reserved set** as non-careers ("reserved hosts never resolve to a brand"), reusing the one `RESERVED_SLUGS` source rather than re-hard-coding.

> **Dependency / coordination status.**
> - **S9 (landed) — the stated dependency.** Operator provisioning + the reserved-slug validation (`slug.ts`) S12 reuses. Stable brand slugs are the routing key.
> - **S11 (in flight — coordinate, do not collide).** S11 adds `org.status` refusals to the **public careers handlers** (apply `POST`, campaign/chat RSC, request-access, chat conversation `POST`) and to login, plus the seam status gate. S12 **reworks the path those public surfaces are reached by** (host → `/c/{brandSlug}` rewrite) but **keeps the handlers as the resolution + refusal point** (the proxy can't read status — same no-DB rule as Finding 1). The two compose cleanly **provided S12 does not move status enforcement into the proxy and does not bypass the handlers**. **Sequencing:** S11 is landing now; build S12 on a branch **rebased onto S11** so the reworked careers routing inherits S11's status refusals (and S11's "this organisation isn't accepting applications" view is the natural fallback for an unknown/suspended brand host — Decision D). Neither slice adds a migration, so there is no numbering conflict.
> - **S13 (depends S5/S8/S10) — keep `clients.slug` global.** S13 *"finalise[s] uniqueness"* and explicitly confirms `clients.slug` stays **globally unique**. S12 depends on that; flag in the S13 PR that per-org brand slugs would break the subdomain rewrite (it would need an org disambiguator on the host — out of scope, see Decision A).
> - **S14 (seed) — independent.** Reconfirms global brand-slug uniqueness in its acceptance; S12 touches no seed.
> - **S6 (landed) — careers logos.** Public logo container / SAS path (`blob-paths.ts`); careers pages render unchanged. No S12 change.
> - **S15 (Clerk, future) — flagged risk.** The plan (§6 line 215) calls out *"test edge middleware × Clerk × careers-subdomain (S12) interaction"*. Keep all proxy verification flowing through the single shared verifier (`token.ts`, Finding-adjacent) so the S15 swap stays confined to `auth.ts` + `token.ts`.

> **AGENTS.md mandate.** This is a modified **Next.js 16.2.2** (App Router) where `middleware.ts` is **`proxy.ts`** and defaults to the **Node.js runtime** (`proxy.md` Runtime §; the `runtime` segment option throws in a proxy file). **Before editing `proxy.ts`, the rewrite/redirect/matcher logic, or any `request.nextUrl` / cookie handling, read the proxy guides** (`…/16-proxy.md` and `…/file-conventions/proxy.md`). Heed the deprecation notice (do **not** reintroduce `middleware.ts`), the *"single proxy file per project"* rule (compose via imported modules, `…/16-proxy.md` Convention §), and the RSC-header note (`NextResponse.rewrite()` auto-propagates the Flight headers — a hand-rolled `fetch` rewrite would not).

---

## Codebase Analysis

S12 separates the **authenticated app host** (`(admin)` + `operator`) from **public per-brand careers subdomains**. The data substrate (globally-unique brand slugs, org-stamped public writes, a reserved-namespace) is already in place; the work is a focused **`proxy.ts` rework + one pure host classifier + a few absolute-URL/host fixes**. No schema, no new screens.

**The proxy today is a single host-rewrite-then-optimistic-auth pass (`src/proxy.ts:15-76`).** Flow: (1) early-return for `/api/`, `/_next/`, `favicon.ico` (`:19-25`); (2) **production-only subdomain rewrite** — if `!isLocalDev(host)` and `NEXT_PUBLIC_APP_DOMAIN` is set, strip the apex to get the subdomain and, **unless it is `www`** (`:35`), `rewrite` every path to `/c/{subdomain}{path}` (`:31-41`); (3) otherwise treat the host as the admin app — let `/c/*` (`:46-48`), `/` + `/login` (`:50-52`), `/reset-password*` (`:55-57`), `/accept-invite*` (`:61-63`) through, then **optimistically** check the `admin_session` cookie via the shared verifier and `redirect("/login?from=…")` on failure (`:66-73`). The `config.matcher` (`:78-88`) runs the proxy on everything except `/_next/` and dotted static files. **Today's host model is "apex/www/localhost = admin app; any other subdomain = careers".** S12 inverts the default: **`app.{domain}` (+ localhost) = app; apex/www = marketing; every other non-reserved subdomain = careers.**

**The proxy must stay DB-free; the single shared verifier is the only auth primitive it may use.** `verifyJwt` (`src/lib/token.ts:17-24`) is deliberately the *"ONLY place that calls `jwtVerify`"* and depends on `jose` + the secret and *"NOTHING else — no `next/headers`, no `db`, no bcrypt"* (`:3-8`), so it is edge-safe. The canonical tenant/operator authorization is the **layout guard**, not the proxy: `(admin)/layout.tsx:26` calls `requireTenant()` and `:32` redirects a non-acting operator to `/operator`; `operator/layout.tsx:18` calls `requireOperator()` (404s non-operators, existence hidden). S12 keeps the proxy **optimistic-signature-only** and leaves the real gate in the layouts (and, for `org.status`, in S11's seam).

**Careers `org_id` is resolved downstream from the brand slug, and every public write already stamps it explicitly.** The campaign landing RSC `getCampaign(clientSlug, campaignSlug)` joins `campaigns ⋈ clients` on `clients.slug` (`c/[clientSlug]/[campaignSlug]/page.tsx:14-41`). The public **apply** `POST` selects `campaigns.org_id` via the same slug join (`api/apply/[clientSlug]/[campaignSlug]/route.ts:32-47`), checks `campaign.status === 'active'` (`:49`), and inserts the candidate with `org_id: campaign.org_id` (`:132`), the CV under `cvs/{org_id}/{clientSlug}/…` (`:172`), and a `candidate_created` usage event (`:152-158`). **events** (`api/events/route.ts:34,59-64,75-87`) and **request-access** (`api/chat/request-access/route.ts:11,23-52`) follow the identical slug→org pattern. **This is the "carries `org_id`" requirement already satisfied** — S12 only has to keep the brand slug flowing to these handlers (via the `/c/{brandSlug}` path), which it does by construction.

**The reserved-namespace is centralised but the proxy ignores most of it.** `RESERVED_SLUGS` (`src/lib/slug.ts:7-10`) + `validateSlug` (`:19-33`) already prevent a brand from being created with a reserved slug (`api`, `app`, `admin`, …). The proxy only special-cases `www`. S12 reuses `RESERVED_SLUGS` so the *same* list that blocks reserved brand creation also blocks reserved-host→brand resolution — single source of truth.

**Absolute-URL builders assume a single host and will need host-aware values.** Three builders construct cross-surface links off env, and S12's host split changes which host each must target:
- **Logout** redirects to `https://{NEXT_PUBLIC_APP_DOMAIN}/login` — i.e. the **apex** (`api/auth/logout/route.ts:5`). After the split, login lives on the **app host**, so this must target `app.{domain}`.
- **Chat magic-link** origin is `process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin` (`request-access/route.ts:62-64`) and the link points at `/c/{clientSlug}/{campaignSlug}/chat` (`:66-68`) — a **careers** surface. It must resolve to a host that serves `/c/*` (Decision B).
- **Worker chat invitation / nudge** build `${NEXT_PUBLIC_APP_URL}/c/{clientSlug}/{campaignSlug}/chat` (`lib/queue/worker.ts:190-192`, `:292-293`) — also careers links off the single `NEXT_PUBLIC_APP_URL`. Same constraint.

**`NEXT_PUBLIC_APP_DOMAIN` is the apex (`talentstream.co.za`); there is no app-host env yet.** `.env.example:37` documents `NEXT_PUBLIC_APP_DOMAIN=talentstream.co.za`; `NEXT_PUBLIC_APP_URL` is referenced by the worker + request-access but is **not** in `.env.example` (a documentation gap S12 should close). Demo/preview links the admin UI renders are careers-subdomain links (`(admin)/campaigns/[id]/page.tsx:162-163` → `https://{client.slug}.{APP_DOMAIN}/{campaign.slug}`; brand-creation previews in `clients/new/page.tsx:241`, `campaign-wizard.tsx:688`, `live-campaign-preview.tsx:213`) — these stay careers-host and need no change beyond confirming the apex value is unchanged.

**Tech stack:** Next.js 16.2.2 App Router (proxy = Node.js runtime), Drizzle over postgres-js, `jose` HS256 (`ADMIN_AUTH_SECRET`), vitest 4 (`npm test` for pure unit specs; `DATABASE_URL`-gated `*.itest.ts` integration project, serial). Next.js ships an **experimental proxy test harness** (`next/experimental/testing/server`: `unstable_doesProxyMatch`, `isRewrite`, `getRewrittenUrl`, `getRedirectUrl`, `proxy.md` Unit-testing §) that S12 should use to test the rewrite/redirect/matcher behaviour without a browser.

## Related Issues

- **S2 (done)** — the session seam + the single shared verifier (`token.ts`). S12 keeps the proxy verifying through `verifyJwt` only; the real authz stays in the layouts/seam.
- **S6 (done)** — public careers logos (`blob-paths.ts`); careers pages render unchanged on the new host. No S12 change.
- **S9 (done — the stated dependency)** — operator provisioning + reserved-slug validation. S12 routes over the stable brand slugs S9 produces and reuses `RESERVED_SLUGS`.
- **S11 (in flight — coordinate).** Puts `org.status` refusals in the public careers handlers + login and the seam. S12 reworks how those surfaces are *reached* but keeps the handlers as the resolution/refusal point (no status in the proxy). **Rebase S12 onto S11**; reuse S11's "unavailable" view for unknown/suspended brand hosts (Decision D).
- **S13 (depends S5/S8/S10)** — schema cleanup; **confirms `clients.slug` stays global unique**, the precondition for the org-less subdomain rewrite. Flag in S13's PR that per-org slugs would break S12.
- **S14 (depends S8/S9/S10)** — seed rework; reconfirms global brand-slug uniqueness. Independent of S12.
- **S15 (Clerk, future)** — the plan flags testing the edge-proxy × Clerk × careers-subdomain interaction. S12 keeps verification single-sourced so the swap stays in `auth.ts`/`token.ts`.

### Assumptions from siblings (do **not** build these in S12)

- **`org.status` public refusal + login/seam status gate (S11, in flight).** S12 must *preserve* these in the reworked careers path, **not** re-implement them and **not** hoist them into the proxy (no edge DB read).
- **Edge-cached brand→org resolution (the slice's "cached at the edge" risk).** **Out of scope for V1** — resolution stays in the handlers (Finding 1, Decision A). An Edge-Config/runtime-cache slug→org map is a *future optimisation* only if a real latency need appears; it is not required to meet the acceptance and would add a cache-invalidation surface (brand rename/suspend) the slice doesn't budget for.
- **Per-brand custom domains (plan Open Question 7).** Deferred enterprise feature; S12 routes only `{brandSlug}.{appDomain}`.
- **DNS / wildcard-TLS provisioning.** Infra, not code (coordinate with whoever owns the `*.{appDomain}` cert). S12 assumes the wildcard host reaches the app; it does not configure DNS.

## Implementation Plan

### Database Changes

**None.** No new tables, columns, or migrations. `clients.slug` already global-unique; `RESERVED_SLUGS` already centralised; `organizations.status` (S11) already exists. S12 is routing + URL wiring only.

### API / Backend Changes

> **Read the Next.js 16 proxy guides first (AGENTS.md):** `…/01-getting-started/16-proxy.md` and `…/03-api-reference/03-file-conventions/proxy.md`. Note the Node.js-runtime default, the single-proxy-file rule, and that `NextResponse.rewrite()` (not a manual `fetch`) is what propagates RSC headers.

#### 1. Pure host classifier — `src/lib/host.ts` (NET-NEW, DB-free, edge-safe)

A single pure function the proxy (and tests) call — no `db`, no `next/headers`, importable into the edge bundle exactly like `token.ts`:

```ts
import { RESERVED_SLUGS } from "@/lib/slug";

export type HostKind =
  | { kind: "app" }                          // app.{domain} or localhost → (admin)+(operator)
  | { kind: "marketing" }                    // apex or www.{domain} → public landing
  | { kind: "careers"; brandSlug: string }   // {brand}.{domain} → /c/{brand}
  | { kind: "reserved" };                    // a reserved subdomain that is not `app`/`www`

const APP_SUBDOMAIN = "app";

export function isLocalDev(hostname: string): boolean {
  return hostname === "localhost"
    || hostname.startsWith("localhost:")
    || hostname.startsWith("127.0.0.1");
}

/** Classify the incoming Host header. `appDomain` is NEXT_PUBLIC_APP_DOMAIN
 *  (e.g. "talentstream.co.za"). Pure — no DB, no env reads beyond the arg. */
export function classifyHost(rawHost: string, appDomain: string): HostKind {
  const host = (rawHost.split(":")[0] ?? "").toLowerCase();   // strip port
  if (isLocalDev(rawHost)) return { kind: "app" };            // local dev fallback
  if (!appDomain || host === appDomain || host === `www.${appDomain}`) {
    return { kind: appDomain ? "marketing" : "app" };         // no appDomain → single-host dev
  }
  if (!host.endsWith(`.${appDomain}`)) return { kind: "marketing" }; // foreign/unknown host
  const sub = host.slice(0, -(`.${appDomain}`.length));
  if (!sub || sub.includes(".")) return { kind: "marketing" };       // empty / multi-level
  if (sub === APP_SUBDOMAIN) return { kind: "app" };
  if (RESERVED_SLUGS.includes(sub)) return { kind: "reserved" };     // never a brand
  return { kind: "careers", brandSlug: sub };
}

/** The canonical app-host origin for cross-surface redirects (logout, marketing→app). */
export function appHostOrigin(): string {
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  return domain ? `https://${APP_SUBDOMAIN}.${domain}` : "http://localhost:3000";
}
```
Keeping `classifyHost` pure makes the whole routing matrix unit-testable (`npm test`) with no Postgres and no browser, and `RESERVED_SLUGS` stays single-sourced (Finding 3).

#### 2. Rework `src/proxy.ts` around the classifier

Replace the inline `isLocalDev` + ad-hoc `www` check with `classifyHost`. Structure (keep `verifyJwt` as the only auth call — never read the DB):

```ts
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = classifyHost(request.headers.get("host") ?? "", process.env.NEXT_PUBLIC_APP_DOMAIN ?? "");

  // (a) Host-aware /api + internals early return — NEVER subdomain-rewrite an API path.
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    // Optional: on a careers host, forward the brand for defence-in-depth (Decision C).
    if (host.kind === "careers") {
      const h = new Headers(request.headers);
      h.set("x-careers-brand", host.brandSlug);
      return NextResponse.next({ request: { headers: h } });
    }
    return NextResponse.next();
  }

  switch (host.kind) {
    case "careers": {
      // Public: pin the brand from the host. /c/* stays a non-route under /c/{brand} → 404,
      // so another brand cannot be reached by path (Finding 2). org.status refusal lives in
      // the handlers (S11) — not here (no DB).
      const url = request.nextUrl.clone();
      url.pathname = `/c/${host.brandSlug}${pathname === "/" ? "" : pathname}`;
      return NextResponse.rewrite(url);
    }
    case "reserved":
      // Never resolves to a brand. Serve marketing (or notFound) — Decision D.
      return NextResponse.rewrite(new URL("/", request.url));
    case "marketing":
      // Apex/www: public landing only. An admin/operator path here → bounce to the app host.
      if (isAppOnlyPath(pathname)) {
        return NextResponse.redirect(new URL(`/login?from=${encodeURIComponent(pathname)}`, appHostOrigin()));
      }
      return NextResponse.next();
    case "app":
      // The authenticated app host (+ localhost). Existing optimistic-auth logic.
      if (isPublicAppPath(pathname) || pathname.startsWith("/c/")) return NextResponse.next(); // Decision B
      const token = request.cookies.get(COOKIE_NAME)?.value;
      if (!token || (await verifyJwt(token)) === null) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("from", pathname);
        return NextResponse.redirect(loginUrl);
      }
      return NextResponse.next();
  }
}
```
- `isPublicAppPath` = the existing allowlist (`/`, `/login`, `/reset-password*`, `/accept-invite*` — `proxy.ts:50-63`). `isAppOnlyPath` = its complement for the marketing-host bounce (everything that isn't marketing/public — at minimum `/login`, `/dashboard`, `/operator`, `/campaigns`, `/candidates`, `/clients`, `/users`, `/settings`). Keep both small and constant.
- **`config.matcher` is unchanged** (`proxy.ts:86`) — still `"/((?!_next/|.*\\.).*)"`; the new logic is all inside the function.
- **Localhost keeps working** (acceptance): `classifyHost` returns `app` for `localhost[:port]`, so `/login`, `/dashboard`, `/operator` work, and `/c/*` is allowed through (Decision B) so careers pages remain reachable locally by path. No subdomain needed in dev.

#### 3. Coordinate the absolute-URL builders (the "coordinate `APP_DOMAIN`" risk)

- **Logout** (`api/auth/logout/route.ts:5`): redirect to the **app host** login, not the apex. Use `new URL("/login", appHostOrigin())` (from `host.ts`) so it tracks the `app.` subdomain.
- **Chat magic-link** (`request-access/route.ts:62-68`) and **worker chat links** (`worker.ts:190-192,292-293`): these point at `/c/*`, which must be served by whatever host `NEXT_PUBLIC_APP_URL` names. Under **Decision B** (`/c/*` stays public on the app host too) the existing builders keep working **unchanged** provided `NEXT_PUBLIC_APP_URL` is set to a host that serves `/c/*` (the app host). **Document `NEXT_PUBLIC_APP_URL` in `.env.example`** (currently missing) and add a one-line note that it must serve `/c/*`. *(Stricter follow-up, deferred: rebuild candidate-facing links as `https://{brandSlug}.{appDomain}/{campaignSlug}/chat` so they land on the canonical careers subdomain — Decision B's follow-up.)*
- **`.env.example`:** add `NEXT_PUBLIC_APP_URL=` with a comment, and a comment by `NEXT_PUBLIC_APP_DOMAIN` noting that the app is served at `app.{NEXT_PUBLIC_APP_DOMAIN}`, careers at `{brandSlug}.{NEXT_PUBLIC_APP_DOMAIN}`, and reserved subdomains (`RESERVED_SLUGS`) never resolve to a brand.

#### 4. Keep `org.status` refusal in the handlers (S11 — do not move it)

S12 changes nothing about *where* `org.status` is checked. The reworked careers rewrite still lands on the same RSC pages / route handlers that S11 gates. **Verification task:** after rebasing onto S11, re-run S11's public-refusal tests against the **subdomain** entry path (not just the `/c/...` path) to prove the rewrite preserves the refusal.

### Frontend & cross-surface coordination

> **No new UI. The `frontend-design` skill is not required** unless the team adopts Decision E (a bespoke "served on the wrong host" landing), in which case it becomes mandatory for that one screen.

- **Careers pages** (`c/[clientSlug]/[campaignSlug]/page.tsx`, `chat/page.tsx`): unchanged — same components, same brand colours/logos (S6). They now receive traffic via the subdomain rewrite in addition to the path; no code change.
- **Login** (`app/login/page.tsx`): unchanged. It already reads `?from=` (`:36`) and posts to `/api/auth/login`; it simply now lives on the app host. Optional: it can surface `?reason=` if S11's seam redirects mid-session users there (S11 owns that copy).
- **Marketing landing** (`app/page.tsx` at `/`): unchanged content; it is now the apex/www face. The only behavioural change is the proxy bouncing app-only paths from apex → app host (Backend #2).
- **Admin demo/preview links** (`(admin)/campaigns/[id]/page.tsx:162-163`, brand/campaign previews): already careers-subdomain links; confirm they still read `NEXT_PUBLIC_APP_DOMAIN` (apex) and render `https://{brandSlug}.{appDomain}/{campaignSlug}` — correct under the new model. No change.

### Edge Cases and Boundary Conditions

- **Reserved host never resolves to a brand (acceptance).** `api.{domain}`, `admin.{domain}`, `mail.{domain}`, etc. → `classifyHost` returns `reserved` → marketing/404, never `/c/api` (which would 404 anyway). Test every entry in `RESERVED_SLUGS` except `app`/`www`.
- **`app` and `www` are *not* brands (acceptance).** `app.{domain}` → app host; `www.{domain}` and apex → marketing. A brand can never be created with these slugs (`validateSlug`), so there's no collision — assert both classifier and provisioning agree.
- **Admin/operator reachable *only* on the app host (acceptance).** `nedbank.{domain}/dashboard` → rewrites to `/c/nedbank/dashboard` → 404; `nedbank.{domain}/operator` → `/c/nedbank/operator` → 404; apex `/dashboard` → redirect to `app.{domain}/login`. Only `app.{domain}` (+ localhost) serves the shells. Test all three host classes.
- **A careers subdomain cannot surface another org's data (acceptance).** Host pins the slug; `nedbank.{domain}/c/discovery/role` → `/c/nedbank/c/discovery/role` → 404. Cross-brand apply via the path-based API (`/api/apply/discovery/role` from a nedbank page) only ever reaches *discovery's already-public* careers — no private data crosses (both campaigns are public; `org_id` is resolved from the path slug, never the host). Document this explicitly so it isn't mistaken for a leak.
- **`apply`/`events` on a careers host stamp the correct `org_id`/brand (acceptance).** The handlers resolve `org_id` from the path `clientSlug` (== the host brand after rewrite) and CV blobs land under `cvs/{org_id}/{clientSlug}/…`. Test an application submitted via the subdomain lands in the right org with the right brand path.
- **Localhost still works (acceptance).** `localhost:3000/login`, `/dashboard`, `/operator` (app), and `/c/{brand}/{campaign}` (careers by path) all resolve; no subdomain required. Test with `NEXT_PUBLIC_APP_DOMAIN` both set and unset (the unset case → single-host `app` for everything, preserving today's dev behaviour).
- **Unknown / non-existent brand subdomain.** `notabrand.{domain}/role` → `/c/notabrand/role`; `getCampaign` returns null → the existing `CampaignError`/`notFound` view. With S11 rebased in, a suspended/deleted brand renders S11's "unavailable" view (Decision D). No proxy DB lookup distinguishes these — the handler does.
- **Foreign / spoofed Host header.** A host not ending in `.{appDomain}` (and not localhost) → `marketing` (safe default — never `app`, never an arbitrary brand). Test `evil.com`, `app.evil.com`.
- **Port + casing.** `App.TalentStream.co.za:3000` → strip port, lowercase → `app` host. Test mixed-case and port-bearing hosts.
- **RSC navigations across the rewrite.** Client-side transitions to a careers page must keep the rewrite headers — use `NextResponse.rewrite()` (not a manual `fetch`) so Next propagates the Flight headers (`proxy.md` "RSC requests and rewrites"). Verify a soft navigation into `/c/...` renders the RSC payload, not the HTML-only fallback.
- **`NEXT_PUBLIC_APP_URL` unset.** Worker/request-access fall back to `http://localhost:3000` / `request.nextUrl.origin`; chat links still resolve in dev. Test the magic-link round-trip locally.

### Test Plan

- **DB-free unit tests (`npm test`) — `src/lib/host.test.ts`:** the full `classifyHost` matrix, ideally table-driven:
  - `localhost`, `localhost:3000`, `127.0.0.1` → `app`.
  - apex `talentstream.co.za`, `www.talentstream.co.za` → `marketing`.
  - `app.talentstream.co.za` → `app`.
  - every `RESERVED_SLUGS` entry except `app`/`www` (`api`, `admin`, `mail`, `ftp`, `staging`, `dev`, `test`, `status`, `cdn`, `assets`) → `reserved`.
  - `nedbank.talentstream.co.za`, `discovery.talentstream.co.za` → `careers` with the right `brandSlug`.
  - mixed-case + port; multi-level (`a.b.talentstream.co.za`) → `marketing`; foreign host (`evil.com`, `app.evil.com`) → `marketing`; empty appDomain → `app` for everything.
- **Proxy behaviour tests (`npm test`) using `next/experimental/testing/server`:** assert routing decisions without a browser (`proxy.md` Unit-testing §):
  - `getRewrittenUrl` for `nedbank.{domain}/role` === `…/c/nedbank/role`; for apex `/` unchanged.
  - `isRewrite`/`getRewrittenUrl` for a careers `/` → `/c/{brand}`.
  - `getRedirectUrl` for apex `/dashboard` → `app.{domain}/login?from=/dashboard`.
  - careers `/dashboard` rewrites to `/c/{brand}/dashboard` (→ a 404 route).
  - app-host unauthenticated `/dashboard` (no cookie) → redirect `/login?from=/dashboard`; with a valid signed cookie → `next()`.
  - `/api/apply/...` on a careers host → `next()` (NOT rewritten) and carries `x-careers-brand` if Decision C is taken.
  - `unstable_doesProxyMatch` confirms the matcher skips `/_next/` and dotted assets.
- **DB-backed integration (`*.itest.ts`, gated) — `host-routing.itest.ts`:** end-to-end with a two-brand/two-org fixture (reuse the provisioning/operator fixtures):
  1. Application submitted on `nedbankSlug`'s careers path lands in Org A with `org_id` set and the CV under `cvs/{orgA}/{nedbankSlug}/…`; an application on `discoverySlug` lands in Org B. Cross-check no row crosses orgs.
  2. The campaign RSC for a brand serves only that brand's active campaign; an inactive/foreign campaign → the not-found/unavailable view.
  3. (Rebased onto S11) suspended-org careers via the **subdomain** path → S11's refusal still fires (proves the rewrite preserves the gate).
- **Build/typecheck:** `npm run build` (must compile against S10/S11 in-tree). 
- **Manual host smoke (documented, infra-gated):** with a wildcard DNS/cert in a preview env, hit `app.`, `www.`, apex, `{brand}.`, and a reserved subdomain; confirm the matrix. Note in the PR that DNS/wildcard-TLS is an infra prerequisite (the slice's stated risk).

### Suggested Implementation Order

> Branch from / **rebase onto S11** so the careers rework inherits S11's `org.status` refusals. No migration in either slice → no numbering coordination.

1. **Classifier:** `src/lib/host.ts` (`classifyHost`, `HostKind`, `isLocalDev`, `appHostOrigin`) reusing `RESERVED_SLUGS`. Unit-test the full matrix first (TDD-friendly — it's pure).
2. **Proxy rework:** restructure `proxy.ts` around `classifyHost` (host-aware `/api` early return; careers rewrite; reserved→marketing; marketing app-only bounce; app-host optimistic auth + `/c/*` passthrough). Add the proxy behaviour tests.
3. **URL coordination:** logout → `appHostOrigin()`; document `NEXT_PUBLIC_APP_URL` in `.env.example` + the host model comment; confirm careers links resolve.
4. **S11 preservation check:** re-run the public-refusal tests through the subdomain entry path.
5. **Integration + `npm run build`** (rebased onto S11).
6. **Infra hand-off note:** wildcard DNS + `*.{appDomain}` TLS + the `app.` record (coordinate; not code).

### Resolved Decisions (open questions answered)

> Resolved with best judgement on 2026-06-18 — proceed on these; each is reversible if product later disagrees.

**A. The proxy carries the brand *slug*, not `org_id`; resolution stays in the handlers (no edge DB read).** Next.js Proxy must not do data fetching (docs + the existing `proxy.ts:66-67` comment). The slice's *"carries `org_id`"* is satisfied because the handlers already resolve `org_id` from the slug and stamp it on every public write (apply/events/request-access). An Edge-Config/runtime-cache slug→org map (the "cached at the edge" risk) is a deferred optimisation, not a V1 requirement — it would add a brand-rename/suspend invalidation surface the slice doesn't budget for.

**B. `/c/*` stays public on the app host (and localhost); careers subdomains are the canonical public face.** This keeps every existing absolute `/c/...` link (worker chat invitations/nudges, request-access magic links, `NEXT_PUBLIC_APP_URL`) working **with no change**, and the plan explicitly blesses path-based careers routing (§6 line 264: *"path-based routing + the existing rewrite suffice"*). The acceptance only requires admin/operator to be *app-host-only* and careers subdomains to be *org-isolated* — both hold. **Follow-up (deferred):** rebuild candidate-facing links onto `{brandSlug}.{appDomain}` so they hit the canonical subdomain and the app host can then 404 `/c/*` for stricter separation.

**C. Host-aware `/api` = never rewrite API paths + optionally forward `x-careers-brand`.** The early return already keeps `/api/*` off the rewrite path; S12 computes the host *first* so the return is host-aware and (optionally) tags careers-host API calls with `x-careers-brand` for defence-in-depth (a handler may assert the path slug matches the host brand). Not required for correctness (public careers are public; `org_id` comes from the path slug), so keep it as a cheap optional hardening, not a gate.

**D. Reserved + unknown hosts fall back to marketing, not a hard 404.** A reserved subdomain (`api.`, `admin.`, …) and a foreign/spoofed host classify to `marketing` (serve `/`) rather than erroring — friendlier and avoids leaking which subdomains are "special". An **unknown brand** subdomain still rewrites to `/c/{slug}` and lets the handler render the not-found/unavailable view (and, rebased onto S11, the suspended/deleted view) — so brand existence/state is disclosed only by the handler that already owns that decision, never by the proxy.

**E. No new UI; `frontend-design` not triggered.** S12 ships no screens — careers and login are visually unchanged; only their serving host moves. If product later wants a bespoke "this page is served on the wrong host / go to app.{domain}" landing, that single screen would be built with the **mandatory `frontend-design` skill** — but it is out of scope here.

**F. Build rebased onto in-flight S11.** S11's `org.status` refusals live in the public careers handlers + login + seam; S12 reworks the routing *to* those handlers. Rebasing onto S11 lets S12 verify the subdomain entry path preserves the refusals and reuse S11's "unavailable" view for suspended/unknown brand hosts. Neither slice adds a migration, so the only coordination is the shared careers handlers.
