# S2 · Identity/session seam: `getSession → requireTenant` (operator-aware, Clerk-ready)

> **Phase 0 — Tenant foundation (operator-lockout-safe, no behaviour change)**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** upgrade the session to carry org + operator identity and concentrate **all** identity resolution behind one swappable seam, **before** any scoping (the operator-lockout guard).
- **Schema:** `SessionPayload` → `{userId, orgId|null, orgRole|null, isOperator}` (JWT shape change invalidates sessions — fine pre-launch).
- **Backend:** rewrite `src/lib/auth.ts` (new payload; `getSession` parses new claims, drops the exact-3-claim reject; keep `signToken`/`verifyToken`/bcrypt isolated for the Clerk swap). NEW `src/lib/tenant.ts` (the seam): `requireTenant()` resolving the effective org (own org, or operator `actingOrgId`), `requireOrgRole`, `requireBrandAccess`, `requireOperator`, `getBrandMemberships` (resolved on demand, **not** in the JWT, cached per-request via React `cache()`). `src/lib/api.ts`: add `getApiTenant()` (API analog) replacing payload-discarding `requireApiAuth`. `login/route.ts`: sign the new payload (operators get `orgId NULL`). `middleware.ts`: extract the duplicated signature-only verifier into a **leaf edge-safe module** (jose + secret only — *review correction §5.10*) imported by both middleware and `auth.ts`. `seed-admin.ts`: also create an operator + attach the existing admin as Owner + brand_admin membership.
- **↳ Review correction (blocker — layout chokepoint):** make `(admin)/layout.tsx` (and later `(operator)/layout.tsx`) call `requireTenant()`/`requireOperator()` so tenant context is enforced once per shell (§5.2).
- **↳ Review correction (minor — login ambiguity):** decide login identity resolution **here**, not in S15. With `(org_id, email)` uniqueness, email-only `.limit(1)` is ambiguous. V1 choice: **operators globally unique; tenant emails kept effectively resolvable** (e.g. global-unique tenant email until Clerk, or subdomain/org context on the app host). Document the chosen rule.
- **Acceptance:** tenant cookie decodes to `{…, isOperator:false}`, operator to `{orgId:null, isOperator:true}`; `requireTenant` returns effective/acting org; `getApiTenant` no longer discards the payload; **only one** token-verify implementation exists; all routes still function (no scoping yet → no lockout); swapping to Clerk would touch only `auth.ts`+`tenant.ts`.
- **Depends on:** S1 · **Risks:** deploy logs out sessions (re-seed); **must precede S4** or operators are locked out; forbid direct cookie/jose reads outside the seam.

---

# Implementation Spec: S2 · Identity/session seam (`getSession → requireTenant`)

**Generated**: 2026-06-15
**Codebase snapshot**: branch `s01-tenant-schema`, commit `3d99f1f`
**Change type**: Backend-only

> The "layout chokepoint" review correction is a **server-side** enforcement change (an `(admin)/layout.tsx` Server Component calling `requireTenant()`), not a visual/UX change. No `frontend-design` work is in scope for this slice.

---

## Codebase Analysis

The identity layer this slice rewrites is small and already isolated, which is what makes the seam viable:

- **`src/lib/auth.ts`** — the current seam. `SessionPayload = {userId, securityGroup, clientId}` (lines 11–15). `getSession()` (40–61) reads the `admin_session` cookie via `next/headers`, `jwtVerify`s it, and **hard-rejects any shape that is not exactly those three string claims** (the `exact-3-claim reject` the slice calls out). Also holds `signToken`/`verifyToken` (jose), `requireAuth()` (redirect guard), bcrypt `hashPassword`/`verifyPassword`, and sha256 reset-token helpers. Imports `next/headers` → **not edge-safe**.
- **`src/lib/api.ts`** — `requireApiAuth()` (13–20) verifies only the token *signature* and **discards the payload** (returns `NextResponse | null`). `getApiSession()` (22–30) returns the typed session but is used by **0 routes** (confirmed by grep).
- **`src/middleware.ts`** — re-implements its **own** `getSecret()` + `isValidToken()` (jose) (7–20), duplicating `auth.ts`. Does the careers subdomain rewrite (`{slug}.{APP_DOMAIN} → /c/{slug}`) and the admin-route redirect-to-`/login` guard. This duplicate verifier is the "two token-verify implementations" the acceptance forbids.
- **`src/app/api/auth/login/route.ts`** — resolves the user with `eq(users.email, …).limit(1)` (20–24) and signs the **old** payload (34–38). The `.limit(1)` is the login-ambiguity the review flags under per-org email uniqueness.
- **`src/app/api/auth/logout/route.ts`** — clears the cookie; payload-shape-agnostic, **no change needed**.
- **`src/app/(admin)/layout.tsx`** — a **synchronous, presentational** component with **no auth at all** (grep confirms no `requireAuth`/`getSession` anywhere under `(admin)/`). Auth today is **middleware-only** (signature-only). This is the blocker the chokepoint correction closes.
- **`src/db/seed-admin.ts`** — creates one `clients` row + one `users` row (`security_group: "admin"`); knows nothing of orgs, `org_role`, memberships, or operators. Env vars `SEED_ADMIN_EMAIL/PASSWORD/FIRST_NAME/LAST_NAME/CLIENT_SLUG` (`.env.example:37–41`).
- **`src/lib/chat-auth.ts`** — the **reference pattern** for a correctly-scoped resolver (`verifyChatAuth` resolves a candidate with its `campaign → client`). Mirror its shape (resolve + return the owning entity) when building `getBrandMemberships`.
- **24 admin routes** call `requireApiAuth()` (full list in grep: every route under `src/app/api/admin/**`). They stay on `requireApiAuth` for this slice — the swap to `getApiTenant()` + scoping is **S4/S5**.

**Schema (already landed in S1 / migration `0026_tenant_schema.sql`):** `users.org_id` (nullable, operators only), `users.org_role` (`owner|org_admin|null`), `users.is_operator` (default `false`); `organizations`; `memberships(user_id, client_id, brand_role)` with `unique(user_id, client_id)`; `users_org_email_idx` (unique `(org_id, email)`) and `users_operator_email_idx` (partial unique on `email WHERE is_operator`). The 0026 backfill set existing admins `org_role='owner'` and created one `brand_admin` membership per user, **but deliberately left `is_operator=false` for everyone** — operator creation is explicitly *this slice's* `seed-admin` job (see 0026 comment lines 93–95). Triggers fill `org_id` on insert; `set_org_id_from_client_user` **skips `is_operator=true` rows** so an operator inserted with explicit `org_id NULL` keeps it.

**Tech stack:** Next.js 16.2.2 (App Router), Drizzle 0.45.2 over postgres-js, `jose` 6.2.2, `bcryptjs`, React 19 (`cache()` available). **No test runner is installed** (no `vitest`/`jest`, no `test` script) — see Test Plan.

## Related Issues

- **S1 (done, this branch)** — landed the entire schema: `organizations`, `memberships`, `users.{org_id,org_role,is_operator}`, the `org_id` denormalisation + backfill + triggers. **This slice writes zero migrations**; it consumes S1's schema.
- **S3 (next)** — the guard primitives: `orgScope(table, ctx)`, `assertOwnership(row, ctx)` (404), `resolveOwnedResource(table, id, ctx)`, and **`src/lib/rbac.ts`** (`can(action, role)` + role hierarchy `owner > org_admin > brand_admin > recruiter > viewer`), with the **unit-test harness**. S3 explicitly states "no production route uses the helpers yet".
- **S4/S5** — where the 24 routes actually swap `requireApiAuth` → `getApiTenant()` and apply `orgScope`. **Do not migrate route bodies in S2.**
- **S7** — introduces operator act-as via a **short-lived act-as cookie/claim** read by `requireTenant`, plus the `(operator)/` route group + `(operator)/layout.tsx` calling `requireOperator()`. S2 must leave the `actingOrgId` *hook* in place but it resolves to `null` until S7.
- **S15** — Clerk swap; the whole point of the seam is that S15 touches only `auth.ts` + `tenant.ts`.

### Assumptions from siblings

Do **not** build these in S2 — they belong to a sibling and S2 only needs to leave room for them:

- **`orgScope` / `assertOwnership` / `resolveOwnedResource` / `rbac.ts` / `can()`** → **S3**. S2 provides `requireTenant`, `requireOperator`, `requireOrgRole`, `getBrandMemberships` and the `TenantContext` shape they will consume.
- **`requireBrandAccess`** is named in *both* S2 and S3. **Recommendation:** in S2, implement it minimally on top of `getBrandMemberships` + an inline brand-role floor (owner/org_admin implicitly pass; otherwise require a membership on the brand). Defer the `rbac.can()`-backed comparison + the deny-a-recruiter unit tests to S3, which refactors it onto `rbac.ts`. Flag this in the PR so S3 knows to graft it.
- **The act-as cookie** (operator impersonation source) → **S7**. In S2, `requireTenant`'s operator branch reads `getActingOrgId()`, a helper that returns `null` until S7 wires the cookie.
- **Route-body scoping + the CI grep gate** → **S4**. S2 should nonetheless leave the tree *grep-clean* (only the seam files import `cookies()`/`jose`) so S4 can add the grep without first cleaning up.
- **Test runner** → **S3** introduces unit tests. S2 verifies via build/typecheck + an integration/manual pass (Test Plan below).

## Implementation Plan

### Database Changes

**None.** No migration, no `schema.ts` change — S1/0026 already shipped the schema. The only data-shaped work is `seed-admin.ts` writing org/owner/membership/operator rows through the existing tables (below), plus new seed **env vars**.

### API / Backend Changes

#### 1. New leaf token module — `src/lib/token.ts` (edge-safe; §5.10)

The single token-verify implementation. **Only** dependency is `jose` + the secret. **No** `next/headers`, **no** `db`, **no** bcrypt — so it can be imported by edge middleware without dragging Node-only code in.

```ts
import { jwtVerify, type JWTPayload } from "jose";

export function getAuthSecret(): Uint8Array {
  const secret = process.env.ADMIN_AUTH_SECRET;
  if (!secret) throw new Error("ADMIN_AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

/** Verify signature + expiry. Returns the decoded payload, or null if invalid. */
export async function verifyJwt(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    return payload;
  } catch {
    return null;
  }
}
```

- `src/middleware.ts`: delete its local `getSecret`/`isValidToken`; import `verifyJwt` and gate on `(await verifyJwt(token)) !== null`. (Keep `isLocalDev`, the subdomain rewrite, and the matcher unchanged.) **Per AGENTS.md, read `node_modules/next/dist/docs` for Next.js 16 middleware conventions before editing `middleware.ts`.**
- `src/lib/auth.ts`: `verifyToken(token): Promise<boolean>` becomes `(await verifyJwt(token)) !== null`; `getSession` uses `verifyJwt` instead of calling `jwtVerify` itself. `signToken` keeps `jose`'s `SignJWT` (signing only ever runs server-side, never in edge middleware — acceptable). Net effect: `jwtVerify` exists in **exactly one place** (`token.ts`).

#### 2. Rewrite the payload — `src/lib/auth.ts`

```ts
export type OrgRole = "owner" | "org_admin";

export type SessionPayload = {
  userId: string;
  orgId: string | null;     // null ⇒ operator
  orgRole: OrgRole | null;  // null for operators and non-org_role members
  isOperator: boolean;
};
```

- `getSession()`: parse the **new** claims; **drop the exact-3-claim reject**. Validate `typeof userId === "string"` and `typeof isOperator === "boolean"`; accept `orgId`/`orgRole` as `string | null`. Return `null` on a missing/garbage token (unchanged contract).
- Keep `requireAuth()` (redirect-to-`/login`) returning the new `SessionPayload` for any "just need a logged-in user" caller, but the **canonical** page/layout guard is now `requireTenant()` (below).
- bcrypt + reset-token helpers are unchanged — keeping them here keeps the Clerk swap (S15) localised.

#### 3. The seam — NEW `src/lib/tenant.ts`

Holds **all** identity→tenant resolution. Nothing here reads cookies/jose directly except via `getSession()`.

```ts
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession, type OrgRole } from "@/lib/auth";
import { db } from "@/db";
// memberships, eq, ...

export type BrandMembership = { clientId: string; brandRole: string };

export type TenantContext = {
  userId: string;
  isOperator: boolean;
  orgRole: OrgRole | null;
  orgId: string | null;          // the user's home org (null for operators)
  actingOrgId: string | null;    // operator act-as target — null until S7
  effectiveOrgId: string | null; // orgId ?? actingOrgId — what S3/S4 scope on
};

/** S7 wires the act-as cookie; returns null in S2. Keeps requireTenant's
 *  operator branch shaped for impersonation without implementing it yet. */
async function getActingOrgId(): Promise<string | null> {
  return null;
}

/** Resolve the effective tenant context, or redirect to /login if no session.
 *  Cached per-request so the layout + child pages share one resolution. */
export const requireTenant = cache(async (): Promise<TenantContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  const actingOrgId = session.isOperator ? await getActingOrgId() : null;
  return {
    userId: session.userId,
    isOperator: session.isOperator,
    orgRole: session.orgRole,
    orgId: session.orgId,
    actingOrgId,
    effectiveOrgId: session.orgId ?? actingOrgId,
  };
});

/** Operator-only surfaces (operator console lands in S7). A tenant user hitting
 *  an operator surface gets a 404, not a redirect: don't disclose that the
 *  operator area exists (§5.6) and don't bounce an already-authenticated user
 *  to /login (loop-prone). */
export const requireOperator = cache(async (): Promise<TenantContext> => {
  const ctx = await requireTenant();
  if (!ctx.isOperator) notFound();
  return ctx;
});

/** Brand memberships, resolved on demand (NOT in the JWT), memoised per request. */
export const getBrandMemberships = cache(
  async (userId: string): Promise<BrandMembership[]> => {
    const rows = await db.query.memberships.findMany({
      where: eq(memberships.user_id, userId),
      columns: { client_id: true, brand_role: true },
    });
    return rows.map((r) => ({ clientId: r.client_id, brandRole: r.brand_role }));
  }
);

/** Floor check on org-level role (owner > org_admin). Full hierarchy → rbac.ts (S3). */
export async function requireOrgRole(min: OrgRole): Promise<TenantContext> { /* … */ }

/** S2 = membership check only (identity-layer concern): owner/org_admin pass
 *  implicitly; everyone else must hold a membership on brandId, else 404. There
 *  is deliberately NO minRole parameter yet — S3 adds `minRole` + rbac.can() so
 *  the brand-role comparison lives with the RBAC matrix, not duplicated here.
 *  The signature evolving (adding minRole) is the contract S15 must preserve. */
export async function requireBrandAccess(brandId: string): Promise<TenantContext> { /* … */ }
```

Key points:
- **`getBrandMemberships` is resolved on demand and is NOT in the JWT** (keeps the token small + avoids stale-membership tokens) — explicit slice requirement.
- **React `cache()`** memoises per request so the `(admin)` layout and child pages don't re-query.
- **Operator without act-as has `effectiveOrgId === null`.** In S2 nothing scopes on it yet, so this is harmless (no lockout); from S3 the predicate becomes `FALSE` for that case.

#### 4. API analog — `src/lib/api.ts`

Add `getApiTenant()` (the route-handler analog of `requireTenant`), mirroring the existing `getApiSession` discriminated-union shape so call sites read cleanly:

```ts
export async function getApiTenant(): Promise<
  | { ctx: TenantContext; response: null }
  | { ctx: null; response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { ctx: null, response: error("Unauthorized", 401) };
  // resolve TenantContext exactly as requireTenant (sans redirect)
  return { ctx, response: null };
}
```

- **Keep `requireApiAuth()` working** (it now sits over `verifyJwt`); the 24 routes keep calling it this slice. **Remove the dead `getApiSession()`** (0 callers) to avoid two API-session helpers — or leave it; recommend removing.
- The actual per-route swap to `getApiTenant()` + `orgScope` is **S4/S5**, not here.

#### 5. Login identity resolution — `src/app/api/auth/login/route.ts`

**Decision (documented here per the review correction): operators are globally unique (`users_operator_email_idx`); tenant emails are kept *globally unique* until Clerk (S15).** Rationale: S12 (the per-host/subdomain split) is deferred past V1, so there is no org context on the app host to disambiguate by; a global-unique tenant email keeps email-only login unambiguous now and is the cheapest rule to retire when Clerk owns identity. Enforcement of global tenant-email uniqueness at write time is **S5/S8's** responsibility (user-create + invite); S2 only fixes the *read*:

- Resolve by email **without `.limit(1)`** and **fail closed on ambiguity**: select matching active users; if `rows.length > 1` return the generic `Invalid email or password` (never disclose the collision). This makes the global-unique assumption defensive rather than load-bearing on a possibly-violated DB constraint.
- Operators resolve through the same query (their email is globally unique by index).
- **Convention lifespan (important):** "global-unique tenant email" is a **V1-only** application convention, **not** a DB constraint. Do **not** add a global-unique-email index — it is not in S1's schema, S2 writes no migration, and it would directly conflict with **S14**, whose seed deliberately *shares a user email across orgs* ("same brand slug can't exist in both orgs but same email can"). The convention is retired once login can disambiguate by org context — **S12** (subdomain/org context on the app host) or **S15** (Clerk owns identity). Both S12 and S14 are deferred past the V1 cut line (§8), so there is no conflict at launch: the convention holds for every V1 slice. Write-time enforcement of the convention is **S5** (`users` POST) and **S8** (invite accept) — named handoffs, not S2's job. S2 only hardens the *read* (fail-closed above), so a future dupe degrades to "both accounts can't log in" rather than "wrong account logged in".
- Sign the **new** payload from the resolved row:
  ```ts
  await signToken({
    userId: user.id,
    orgId: user.org_id,        // null for operators
    orgRole: user.org_role as OrgRole | null,
    isOperator: user.is_operator,
  });
  ```
- **Out of scope here:** suspended/deleted-org login blocking is **S11**.

#### 6. Layout chokepoint (blocker correction) — `src/app/(admin)/layout.tsx`

Convert the component to an **async Server Component** and `await requireTenant()` at the top so tenant context is enforced **once per shell** (§5.2). No session ⇒ `requireTenant` redirects to `/login`; this is the structural guard that replaces middleware-only auth. Presentation (header/sidebar/`ToastProvider`) is otherwise unchanged.

```tsx
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireTenant(); // redirects to /login if unauthenticated
  return ( /* …existing markup… */ );
}
```

- A non-acting **operator** hitting `(admin)` in S2 resolves with `effectiveOrgId === null` and is **let through** (no scoping yet → the acceptance's "no lockout"). Once S7 adds the operator console, that branch redirects operators there. Note this transitional behaviour in the PR.

#### 7. `seed-admin.ts` — create an operator + a proper owner

The seed must now stand up a full minimal tenant graph **and** a tenant-less operator, idempotently, on a fresh DB (where 0026's backfill never ran because there are no rows yet):

1. **Organization** — find-or-create by slug. **`SEED_ADMIN_ORG_SLUG` is optional, defaulting to `demo-org`** so that on a DB that already ran 0026 the seed reuses the backfill's `demo-org` instead of spawning a second org; making it required would break that idempotency for existing setups. On a fresh DB there are **zero** orgs, so the `set_org_id_default_org` trigger can't help the `clients` insert — **create the org first**.
2. **Client (brand)** — find-or-create by `SEED_ADMIN_CLIENT_SLUG`, **with `org_id` set explicitly** to the org above.
3. **Owner user** — the existing admin, now with `org_id`, `org_role: 'owner'`, `is_operator: false`, `client_id` = the brand, `security_group: 'admin'` (transitional, dropped S13).
4. **Membership** — `brand_admin` for the owner on the brand (`onConflictDoNothing` on `(user_id, client_id)`).
5. **Operator user** — `is_operator: true`, `org_id: null`, `org_role: null`, from a **separate `SEED_OPERATOR_*` block** that mirrors the existing `SEED_ADMIN_*` convention (`SEED_OPERATOR_EMAIL/PASSWORD/FIRST_NAME/LAST_NAME`). These are **required** via the existing `requireEnv` helper (the slice mandates an operator must exist) and the password gets the same `>= 8 chars` check as the admin. A **distinct email + distinct password** from the owner — distinct email is forced anyway by `users_operator_email_idx`, and a separate password is correct hygiene for a privileged cross-tenant account. **Edge case:** `users.client_id` is still `NOT NULL` (dropped in S13), so the operator row needs a **placeholder `client_id`** — set it to the seed brand; it carries **no authz meaning** for operators (`is_operator` + `org_id NULL` govern). **Insert `is_operator: true` in the same statement** so the `set_org_id_from_client_user` trigger's `is_operator IS NOT TRUE` guard fires and leaves `org_id` NULL.

Add to `.env.example`: `SEED_ADMIN_ORG_SLUG` (optional, default `demo-org`), `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD`, `SEED_OPERATOR_FIRST_NAME`, `SEED_OPERATOR_LAST_NAME` (all required).

#### 8. Seam hygiene (grep-clean for S4's CI gate)

After S2, the **only** files importing `cookies()` from `next/headers` are `auth.ts` and `api.ts`; the **only** file importing `jose`'s verify is `token.ts` (plus `SignJWT` in `auth.ts`); `middleware.ts` imports the verifier from `token.ts`. No route handler or page reads cookies/jose directly. Leaving the tree in this state lets S4 add the forbidding grep without a cleanup pass.

### Edge Cases and Boundary Conditions

- **Existing sessions invalidate on deploy** (claim-shape change). Everyone is logged out → re-login; re-run `db:seed:admin`. Expected, pre-launch-acceptable.
- **Operator with `org_id NULL`** must round-trip through the JWT: `getSession` must accept `orgId: null` (the old code rejected non-string `clientId`). Verify the operator cookie decodes to `{orgId:null, isOperator:true}`.
- **Operator insert must not get `org_id` clobbered** by `set_org_id_from_client_user` — guaranteed only if `is_operator:true` is set in the insert. Assert `org_id IS NULL` on the seeded operator afterwards.
- **`users.client_id` NOT NULL for operators** — placeholder brand id required until S13; document that it is vestigial.
- **Ambiguous login** (two tenant users share an email at the DB level despite the global-unique convention) → fail closed (`rows.length > 1` ⇒ generic 401), never pick `.limit(1)`.
- **Non-acting operator in `(admin)`** → `effectiveOrgId` null; allowed through in S2 (no scoping), redirected to the console from S7.
- **Edge runtime purity** — `token.ts` must not transitively import `db`, `next/headers`, or bcrypt, or it will break edge middleware. Verify the middleware bundle still builds.
- **`getSession` is `cache()`-free but `requireTenant` is cached** — ensure the layout and pages call `requireTenant` (not raw `getSession`) so the per-request memo holds.

### Test Plan

No unit-test runner exists yet (it arrives with **S3**), so S2 verification is build + integration/manual:

- **Typecheck/build:** `npm run build` passes with the new `SessionPayload` (catches stale `session.clientId`/`session.securityGroup` reads — there should be none outside the request-body usages in the users routes, which are unrelated).
- **Token round-trip (manual/integration):** log in as the seeded **owner** → decode `admin_session` → assert `{userId, orgId:<uuid>, orgRole:'owner', isOperator:false}`. Log in as the seeded **operator** → assert `{orgId:null, orgRole:null, isOperator:true}`.
- **`requireTenant`:** owner request → `effectiveOrgId === orgId`; operator request → `effectiveOrgId === null` (no act-as in S2).
- **Single verifier:** grep confirms `jwtVerify` appears only in `src/lib/token.ts`; `middleware.ts` has no local `getSecret`/`isValidToken`.
- **Chokepoint:** hitting any `(admin)` page with no/invalid cookie redirects to `/login` (now enforced by the layout, not just middleware).
- **No-lockout smoke:** the 24 `requireApiAuth` routes still return data for a logged-in owner (no scoping applied yet).
- **Seam hygiene grep:** `cookies()` only in `auth.ts`/`api.ts`; `jose` verify only in `token.ts`.
- *(Optional)* a throwaway `tsx` script exercising `signToken`→`verifyJwt`→claim-parse, to be folded into S3's harness.

### Suggested Implementation Order

1. **`src/lib/token.ts`** — extract the edge-safe `getAuthSecret` + `verifyJwt`.
2. **`src/middleware.ts`** — delete the duplicate verifier; import `verifyJwt`. (Read the Next.js 16 middleware docs first per AGENTS.md.)
3. **`src/lib/auth.ts`** — new `SessionPayload` + `OrgRole`; `getSession` parses new claims (drop the 3-claim reject); `verifyToken`/`getSession` delegate to `verifyJwt`.
4. **`src/lib/tenant.ts`** — `TenantContext`, `requireTenant`, `requireOperator`, `requireOrgRole`, `getBrandMemberships`, minimal `requireBrandAccess`, `getActingOrgId` stub.
5. **`src/lib/api.ts`** — add `getApiTenant`; remove dead `getApiSession`; keep `requireApiAuth`.
6. **`src/app/api/auth/login/route.ts`** — fail-closed email resolution + sign the new payload.
7. **`src/app/(admin)/layout.tsx`** — async + `await requireTenant()`.
8. **`src/db/seed-admin.ts`** + **`.env.example`** — org → brand → owner → membership → operator; new env vars.
9. Build, then run the Test Plan; re-seed locally.

### Resolved Decisions

All four open questions are resolved below and folded into the body above. None block implementation.

1. **`requireBrandAccess` ownership split → keep S2 minimal (membership check only).**
   S2 implements `requireBrandAccess(brandId)` as a pure identity/membership check — owner/org_admin pass implicitly; everyone else must hold a `memberships` row on `brandId` (else `notFound()`). It takes **no `minRole` parameter**. S3 adds `minRole` + `rbac.can()` so the brand-role comparison lives once, with the RBAC matrix, rather than being written in S2 and ripped out in S3. This is safe because no route calls the helper until S4/S5 (after S3 completes it), and the evolving signature is TypeScript-enforced. The membership *resolution* genuinely belongs to the seam (it's "who is this user"); the *role comparison* belongs to S3 (it's "what may this role do").

2. **`requireOperator` denial verb → `notFound()`.**
   A tenant user hitting an operator surface gets a 404. Rationale: (a) it doesn't disclose that an operator area exists, consistent with §5.6's 404-not-403 non-disclosure stance; (b) redirecting an *already-authenticated* user to `/login` is a footgun (confusing, loop-prone); (c) it's the verb S3/S4 standardise on for cross-boundary access, so the codebase stays consistent. Note this only guards a real route from **S7** (no `(operator)` group exists in S2) — the verb is fixed now so S7 inherits it.

3. **Global tenant-email uniqueness → fail-closed read only in S2; no DB constraint.**
   S2 hardens only the login *read* (`rows.length > 1` ⇒ generic 401). It does **not** add a global-unique-email index: that would conflict with **S14**, which deliberately shares an email across orgs, and would need removal once **S12**/**S15** can disambiguate login by org context. The "global-unique tenant email" rule is therefore a **V1-only application convention** with a defined lifespan (retired by S12 or S15, both deferred past the V1 cut line, so no launch conflict). Write-time enforcement of the convention is an explicit **S5** (`users` POST) and **S8** (invite accept) handoff — not S2's job.

4. **Seed operator credentials → separate, required `SEED_OPERATOR_*` block; `SEED_ADMIN_ORG_SLUG` optional (default `demo-org`).**
   Mirror the existing `SEED_ADMIN_*` convention with `SEED_OPERATOR_EMAIL/PASSWORD/FIRST_NAME/LAST_NAME` (required via `requireEnv`; password `>= 8` chars; distinct email + password from the owner). The org slug defaults to `demo-org` so a DB that already ran 0026 reuses the backfill org rather than spawning a second one. `.env.example` updated accordingly.
