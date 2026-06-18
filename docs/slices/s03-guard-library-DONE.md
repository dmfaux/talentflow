# S3 · Guard library: `requireBrandAccess` + `orgScope`/`assertOwnership` + RBAC matrix

> **Phase 0 — Tenant foundation (operator-lockout-safe, no behaviour change)**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** the reusable enforcement primitives every read/write slice calls, with unit tests, before wide application.
- **Backend:** `orgScope(table, ctx)` → predicate: tenant user `eq(org_id, ctx.orgId)`; operator **without** act-as `FALSE` (closes the blanket-bypass hole); operator **with** act-as `eq(org_id, actingOrgId)`. `assertOwnership(row, ctx)` → **404** (not 403) when out of scope. `resolveOwnedResource(table, id, ctx)` fetches by id **and** asserts ownership in one query (fixes raw-UUID resolution). NEW `src/lib/rbac.ts`: role hierarchy (owner > org_admin > brand_admin > recruiter > viewer) + `can(action, role)`. Unit tests cover operator (acting/non-acting), owner, member, non-member, cross-org, and the RBAC matrix.
- **Acceptance:** predicates as specified; `resolveOwnedResource` 404s a valid cross-org UUID; `requireBrandAccess` denies a recruiter on a non-member brand, allows owner/admin + acting operator; matrix tests pass; **no production route uses the helpers yet** (zero behaviour change, still shippable).
- **Depends on:** S2 · **Risks:** operator implicit-bypass must be centralised + consistent; RBAC mistakes are security bugs (tests first); 404-vs-403 consistency.

---

# Implementation Spec: S3 · Guard library (`orgScope`/`assertOwnership`/`resolveOwnedResource` + `requireBrandAccess` + RBAC matrix)

**Generated**: 2026-06-15
**Codebase snapshot**: branch `s02-identity-session-seam`, commit `fef838f`
**Change type**: Backend-only

> This slice ships **pure enforcement primitives + unit tests** and wires **no production route** to them (acceptance: "no production route uses the helpers yet" → zero behaviour change). There is therefore **no UI/UX work** and the `frontend-design` skill is **not** in scope. The route/page application of these helpers is S4 (reads) and S5 (writes).

---

## Codebase Analysis

S2 (this branch) already shipped the seam these primitives slot into; S3 is additive on top of it.

- **`src/lib/tenant.ts`** — the seam. Exposes `TenantContext` (`{ userId, isOperator, orgRole, orgId, actingOrgId, effectiveOrgId }`), `requireTenant()` (cached, redirects to `/login`), `requireOperator()` (404s a tenant user), `requireOrgRole(min)`, `getBrandMemberships(userId)` (cached `memberships` lookup → `{ clientId, brandRole }[]`), and a **minimal `requireBrandAccess(brandId)`** that S2 deliberately shipped **without a `minRole` parameter** (owner/org_admin pass implicitly; everyone else needs a membership on the brand, else `notFound()`). The S2 spec (Resolved Decision 1) explicitly defers "`minRole` + `rbac.can()`" to **this slice** and notes the evolving signature is a TypeScript-enforced contract S15 must preserve. `tenantFromSession(session)` is the single identity→context resolver shared by `requireTenant` and `getApiTenant`.
- **`src/lib/auth.ts`** — `OrgRole = "owner" | "org_admin"` and `SessionPayload`. `org_role` is the only role carried in the JWT; brand roles are resolved on demand (never in the token).
- **`src/lib/api.ts`** — `getApiTenant()` (route-handler analog of `requireTenant`, returns `{ ctx, response }`), plus `error(message, status)` / `success(data, status)`. The 24 admin routes still call the payload-discarding `requireApiAuth()`; the swap to `getApiTenant()` + these guards is S4/S5.
- **`src/db/schema.ts`** — `org_id` is denormalised onto every leaf (`campaigns, candidates, scoring_logs, messages, conversations, chat_messages, chat_tokens, events`) and on `clients`/`users`; **NOT NULL at the DB level via 0026** but `.notNull()` is omitted from the Drizzle model until S5, so the inferred TS type of `org_id` is `string | null` (the helpers must treat it as nullable and fail closed). `memberships.brand_role` is free-text holding `brand_admin | recruiter | viewer`; `users.org_role` holds `owner | org_admin | null`. `jobs.org_id` is genuinely nullable (populated in S10).
- **Drizzle idioms in routes** — lists compose predicates into an array and apply `.where(conditions.length ? and(...conditions) : undefined)` (see `src/app/api/admin/campaigns/route.ts:18-43`); resolve-by-id uses `db.query.<table>.findFirst({ where: eq(table.id, id) })` (see `candidates/[id]/route.ts:105`, `candidates/[id]/route.ts:133`); the 4 RSC pages use `db.query…findFirst` then `if (!row) notFound()` (`(admin)/candidates/[id]/page.tsx:51-63`). `orgScope` must return a value that drops straight into the `conditions[]`/`and(...)` pattern; `resolveOwnedResource` must mirror the `findFirst`-by-id shape.
- **`src/lib/chat-auth.ts`** — the reference correctly-scoped resolver (`verifyChatAuth` resolves a candidate **and** its owning `campaign → client` in one query). `resolveOwnedResource` is the admin-side analog of this pattern.
- **Reference roles** — confirmed in `drizzle/0026_tenant_schema.sql` (backfill sets `org_role='owner'` for admins, one `brand_admin` membership per user) and `src/db/seed-admin.ts` (owner + `brand_admin` membership + tenant-less operator). The role vocabulary is fixed: org `owner|org_admin`, brand `brand_admin|recruiter|viewer`.

**Tech stack / tooling:** Next.js 16.2.2 (App Router), Drizzle 0.45.2 over postgres-js, React 19 (`cache()` in use), `@/* → ./src/*` path alias (`tsconfig.json`). **No test runner is installed** — there is no `vitest`/`jest`, no `test` script, and zero `*.test.ts` files. `tsx` is the only script runner present. **Choosing and wiring the test runner is part of this slice** (S2's spec hands the unit-test harness to S3).

## Related Issues

- **S1 (done)** — landed the schema (`org_id` denorm, `memberships`, `org_role`, `is_operator`, triggers). S3 writes **no migration** and changes **no schema**.
- **S2 (done, this branch)** — landed the seam (`TenantContext`, `requireTenant`, `requireOperator`, `getBrandMemberships`, minimal `requireBrandAccess`, `getApiTenant`). S3 **extends** `requireBrandAccess` (adds `minRole`) and **adds** the scoping + RBAC primitives. S2 explicitly left `effectiveOrgId === null` (non-acting operator) harmless because nothing scoped on it yet; **S3 is where that null becomes a `FALSE` predicate** (the no-blanket-bypass property, §5.5).
- **S4 (next, reads)** — first consumer: every admin GET → `getApiTenant()` + `orgScope`/`resolveOwnedResource`; the 4 RSC pages → `requireTenant()` + `assertOwnership`. S4 also adds the CI grep gate.
- **S5 (writes)** — consumes `can(action, role)` on every mutation (`error("Forbidden", 403)`), and is the slice that **adds `org_id`'s `.notNull()`** to the model + enforces write-time scoping. S5 owns the authoritative `Action` ↔ role mapping; S3 seeds it from S5's stated rules.
- **S7 (operator console)** — wires the act-as cookie so `getActingOrgId()` returns a real `actingOrgId`. S3 must code the acting-operator branch correctly **now** (treat an acting operator as owner-equivalent within the acted org) even though it is dormant until S7.
- **S15 (Clerk)** — the seam's payoff: S15 must not change any S3 signature. Keep `requireBrandAccess`'s evolved `(brandId, minRole?)` shape stable.

### Assumptions from siblings

Do **not** build these in S3 — they belong to a sibling:

- **Per-route application** of `orgScope`/`assertOwnership`/`resolveOwnedResource`/`can` → **S4/S5**. S3 wires **zero** production routes (acceptance + the "still shippable, zero behaviour change" gate). Verify with a grep that no file under `src/app/**` imports the new helpers at the end of S3.
- **The CI grep gate** (forbidding direct `cookies()`/`jose` outside the seam; flagging unguarded admin GETs) → **S4**.
- **`org_id` model `.notNull()`** and write-time stamping → **S5**. S3 must tolerate `org_id: string | null` on every row type and fail closed on null.
- **Act-as cookie / real `actingOrgId`** → **S7**. In S3 `actingOrgId` is always `null`; the acting-operator code path is written but unreachable until S7.
- **The authoritative `Action` enum + exact role thresholds** → **S5**. S3 provides a concrete starter matrix derived from S5's acceptance text and marks it extensible.

## Implementation Plan

### Database Changes

**None.** No migration, no `schema.ts` edit. S3 is pure application code + tests.

### API / Backend Changes

#### 1. NEW `src/lib/rbac.ts` — the role matrix (pure, no I/O)

The single source of truth for "what may this role do". **Pure functions only** — no `db`, no `next/*`, no `react` — so the matrix is unit-testable with zero infrastructure. This is the security-critical core; tests come first.

```ts
import type { OrgRole } from "@/lib/auth";

export type BrandRole = "brand_admin" | "recruiter" | "viewer";
/** The unified, linearly-ordered role scale (plan §6: owner > org_admin >
 *  brand_admin > recruiter > viewer). Org roles and brand roles share one
 *  ranking so an owner outranks any brand-level minimum. */
export type Role = OrgRole | BrandRole;

export const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  org_admin: 3,
  brand_admin: 2,
  recruiter: 1,
  viewer: 0,
};

/** Unknown / malformed role strings (brand_role is free-text in the DB) rank
 *  below everything → fail closed. Never throws. */
export function roleRank(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as Role] : -1;
}

export function hasMinRole(role: string | null, min: Role): boolean {
  return roleRank(role) >= ROLE_RANK[min];
}

/** The actions every mutating/read surface gates on. Starter set derived from
 *  S5's acceptance; S5 may add actions (each is just an action→min-role entry). */
export type Action =
  | "view"               // any member
  | "manage_candidate"   // candidate PATCH, open-chat (recruiter+)
  | "manage_campaign"    // campaign create/edit/archive/delete (recruiter+)
  | "publish_campaign"   // status → active (recruiter+; viewer excluded)
  | "manage_brand"       // clients POST/PATCH/logo (org_admin+)
  | "manage_member"      // users / memberships (org_admin+)
  | "manage_org_settings"// org profile (org_admin+; tier stays operator-only)
  | "run_popia_purge";   // tenant POPIA purge/deletion (org_admin+)

const ACTION_MIN_ROLE: Record<Action, Role> = {
  view: "viewer",
  manage_candidate: "recruiter",
  manage_campaign: "recruiter",
  publish_campaign: "recruiter",
  manage_brand: "org_admin",
  manage_member: "org_admin",
  manage_org_settings: "org_admin",
  run_popia_purge: "org_admin",
};

/** May `role` perform `action`? Linear-rank model, faithful to the plan's
 *  strict hierarchy. `null`/unknown role → always false. */
export function can(action: Action, role: string | null): boolean {
  return roleRank(role) >= ROLE_RANK[ACTION_MIN_ROLE[action]];
}
```

Matrix this produces (rows = role, columns = action) — this **is** the test table:

| role \ action | view | manage_candidate | manage_campaign | publish_campaign | manage_brand | manage_member | manage_org_settings | run_popia_purge |
|---|---|---|---|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| org_admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| brand_admin | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| recruiter | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

> **Note** the deliberate asymmetry the plan calls for: `brand_admin` manages *within* a brand (campaigns/candidates) but does **not** manage the brand *entity* or members — those are org-level (`org_admin`+). This is faithful to S5's "only Owner/Org-Admin manage members/brands" + "publish gated to brand_admin/recruiter".

#### 2. NEW pure brand-access decision in `rbac.ts` — `decideBrandAccess`

The role logic behind `requireBrandAccess`, factored out as a **pure** function so it is unit-testable without a DB. `requireBrandAccess` (in `tenant.ts`) becomes a thin wrapper that fetches memberships and translates the decision into the right interrupt/response.

```ts
export type AccessDecision = "allow" | "forbidden" | "not_found";

/** Pure brand-access decision (§5.5/§5.6 aware):
 *  - acting operator                 → allow (owner-equivalent within the act-as org)
 *  - owner / org_admin               → allow (span every brand in their org)
 *  - member of brand, rank ≥ minRole → allow
 *  - member of brand, rank <  minRole→ forbidden (resource exists for them → 403)
 *  - not a member (incl. non-acting operator) → not_found (don't disclose existence → 404)
 */
export function decideBrandAccess(
  actor: { orgRole: OrgRole | null; isOperator: boolean; actingOrgId: string | null },
  brandId: string,
  memberships: { clientId: string; brandRole: string }[],
  minRole: BrandRole = "viewer"
): AccessDecision {
  if (actor.isOperator && actor.actingOrgId) return "allow"; // dormant until S7
  if (actor.orgRole === "owner" || actor.orgRole === "org_admin") return "allow";
  const m = memberships.find((x) => x.clientId === brandId);
  if (!m) return "not_found";
  return hasMinRole(m.brandRole, minRole) ? "allow" : "forbidden";
}
```

#### 3. Scoping primitives — add to `src/lib/tenant.ts` (the seam, §5.1)

Add alongside the existing seam exports. **Critical fail-closed rule:** when `effectiveOrgId` is `null` (non-acting operator), the predicate must be a literal `FALSE`, **never** `eq(table.org_id, null)` — Drizzle would emit `org_id = NULL` (or bind a null) and either way risks matching the nullable `org_id` rows. Branch explicitly.

```ts
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

/** Tables carrying a denormalised org_id (every guarded leaf). */
type OrgScopedTable = PgTable & { id: AnyPgColumn; org_id: AnyPgColumn };

/** SQL predicate limiting a query to the caller's effective org. Drops straight
 *  into the existing `conditions[]` + `and(...)` route pattern.
 *  - tenant user          → org_id = ctx.orgId        (effectiveOrgId)
 *  - operator, acting      → org_id = ctx.actingOrgId  (effectiveOrgId)
 *  - operator, NOT acting  → FALSE  (no blanket bypass, §5.5)
 *  effectiveOrgId already collapses the three cases. */
export function orgScope(table: OrgScopedTable, ctx: TenantContext): SQL {
  return ctx.effectiveOrgId
    ? eq(table.org_id, ctx.effectiveOrgId)
    : sql`false`;
}

/** Pure ownership predicate — the unit-testable core. A non-acting operator
 *  (effectiveOrgId null) owns nothing; a null row org_id never matches. */
export function isInScope(rowOrgId: string | null, ctx: TenantContext): boolean {
  return ctx.effectiveOrgId !== null && rowOrgId === ctx.effectiveOrgId;
}

/** RSC / server-action guard: 404 (not 403) when a row is out of the caller's
 *  scope, to avoid existence disclosure (§5.6). Returns the row for chaining. */
export function assertOwnership<T extends { org_id: string | null }>(
  row: T | null | undefined,
  ctx: TenantContext
): T {
  if (!row || !isInScope(row.org_id, ctx)) notFound();
  return row;
}

/** Fetch a row by id scoped to the caller's org in ONE query — fixes raw-UUID
 *  resolution. A valid cross-org UUID returns null (caller 404s), indistinguishable
 *  from "does not exist". Returns null for a non-acting operator (orgScope → FALSE).
 *  Returns null, not a thrown 404, so it is usable from both route handlers
 *  (return error(...,404)) and RSC pages (if (!row) notFound()). */
export async function resolveOwnedResource<T extends OrgScopedTable>(
  table: T,
  id: string,
  ctx: TenantContext
): Promise<T["$inferSelect"] | null> {
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.id, id), orgScope(table, ctx)))
    .limit(1);
  return (row as T["$inferSelect"]) ?? null;
}
```

> **TS note:** `T["$inferSelect"]` is Drizzle's table-level select type — it gives `resolveOwnedResource` a precise return type per table. If the generic `db.select().from(table)` inference fights back for a specific caller in S4, the fallback is a thin typed wrapper per table (`resolveOwnedCandidate(id, ctx)` etc.) over the same body — but start with the generic; it is the cleaner contract.

#### 4. Evolve `requireBrandAccess` — `tenant.ts` (add `minRole`)

Replace S2's minimal `requireBrandAccess(brandId)` with the `minRole`-aware version, now backed by `decideBrandAccess` so the role comparison lives once (in `rbac.ts`). The S2 contract — "resolve ctx, throw on deny, return `TenantContext` on allow" — is preserved; only the signature gains an optional `minRole`.

```ts
import { decideBrandAccess, type BrandRole } from "@/lib/rbac";
// (forbidden) — see Open Questions on the RSC 403 verb.

export async function requireBrandAccess(
  brandId: string,
  minRole: BrandRole = "viewer"
): Promise<TenantContext> {
  const ctx = await requireTenant();
  const memberships =
    ctx.orgRole || (ctx.isOperator && ctx.actingOrgId)
      ? [] // owner/org_admin/acting-operator decided without a lookup
      : await getBrandMemberships(ctx.userId);
  const decision = decideBrandAccess(ctx, brandId, memberships, minRole);
  if (decision === "not_found") notFound();
  if (decision === "forbidden") notFound(); // ← see Open Questions: 404 vs forbidden()
  return ctx;
}
```

**Two enforcement surfaces, one core.** This is the resolution of the 404-vs-403-across-runtimes tension:

- **RSC pages / server actions** use the **throwing** guards (`requireBrandAccess`, `assertOwnership`) → `notFound()` (and, optionally, `forbidden()` once `experimental.authInterrupts` is enabled — see Open Questions).
- **Route handlers** (S5) use the **response-returning** primitives: `getApiTenant()` → `ctx`; `resolveOwnedResource`/`isInScope` for ownership (→ `error("Not found", 404)`); `can(action, role)` for RBAC (→ `error("Forbidden", 403)`).

Both surfaces sit on the same pure cores (`rbac.ts`, `isInScope`, `decideBrandAccess`), so the matrix is verified once.

#### 5. Test runner — pick and wire it (part of this slice)

No runner exists. The unit tests must run **without a database** (the `db` proxy throws unless `DATABASE_URL` is set, and CI for these tests should need no Postgres). Because tests import via the `@/*` alias, the runner must resolve it.

**Recommendation: add `vitest`** (dev dependency) + a one-line `vitest.config.ts` aliasing `@/ → src/`, and scripts `"test": "vitest run"` / `"test:watch": "vitest"`. Rationale: native TS/ESM, resolves the `@/` alias with `resolve.alias` (no extra loader), watch mode, zero app-runtime impact. Keep every S3 test **DB-free** by only importing the pure modules (`rbac.ts`, and the pure functions `isInScope`/`decideBrandAccess`) — never trigger a query.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
```

*Alternative (zero new dependency):* Node's built-in `node:test` + `node:assert` run via `tsx`, but it needs extra config to resolve `@/` — more friction than vitest's one-liner. Note the choice in the PR.

### Edge Cases and Boundary Conditions

- **Non-acting operator owns nothing.** `effectiveOrgId === null` ⇒ `orgScope` → `FALSE`, `resolveOwnedResource` → `null`, `isInScope` → `false`, `decideBrandAccess` → `not_found`. This is the single most important property (closes the blanket-bypass hole). Test every primitive for it.
- **Never `eq(col, null)` for scope.** The `effectiveOrgId` branch to `sql\`false\`` is load-bearing; a regression here is a silent cross-tenant leak via the nullable `org_id` rows. Assert `orgScope` returns the false sentinel (not an `eq`) when `effectiveOrgId` is null.
- **Nullable `org_id` rows.** The model types `org_id` as `string | null` until S5; `isInScope(null, ctx)` must be `false` even when `ctx.effectiveOrgId` is also `null` (the `!== null` guard handles this).
- **Unknown/legacy role strings** (e.g. a stray `security_group` value reaching `can`/`roleRank`) → rank `-1` → deny. `brand_role` is free-text, so fail closed.
- **404 vs 403 split.** Out-of-scope / non-member → **404** (existence hidden, §5.6). In-scope but role too low → **403** (API) / `forbidden()`-or-`notFound()` (RSC). Codify and test both.
- **Acting operator = owner-equivalent.** Dormant until S7 (`actingOrgId` always null in S3) but coded; a test passes `actingOrgId` non-null to `decideBrandAccess` and asserts `allow`.
- **`resolveOwnedResource` on a genuinely missing id** vs a **cross-org id** must be indistinguishable (both `null`). Don't add a "not found vs forbidden" branch.
- **Cross-org UUID that is real** — the acceptance case: `resolveOwnedResource(candidates, <orgB id>, orgA-ctx)` → `null` (the `and(eq(id), orgScope)` yields no row). No second query, no SAS minting downstream (that protection lands in S4/S6 by calling resolve *before* side effects).
- **No production consumer.** End-of-slice grep must show no `src/app/**` import of `orgScope`/`assertOwnership`/`resolveOwnedResource`/`can`/`rbac`. (Re-using S2's already-evolved `requireBrandAccess` is also still zero-consumer.)

### Test Plan

All tests are **DB-free unit tests** over the pure cores (this is what makes "tests first / matrix tests pass" achievable with no infra). Following the chosen runner (vitest):

- **`src/lib/rbac.test.ts`** — the full matrix:
  - Table-driven `can(action, role)` over **every** `Action × Role` cell (matches the table in §1 exactly). Include `can(action, null)` → false and `can(action, "security_group_garbage")` → false.
  - `roleRank`/`hasMinRole` ordering: `owner > org_admin > brand_admin > recruiter > viewer`; unknown → `-1`.
  - **`decideBrandAccess`** across the required cases (acceptance): operator **acting** → allow; operator **non-acting** → not_found; owner → allow; org_admin → allow; member with `brandRole ≥ minRole` → allow; member with `brandRole < minRole` (e.g. recruiter when `minRole=brand_admin`) → forbidden; **non-member recruiter** → not_found (the "denies a recruiter on a non-member brand" case); cross-org member (membership on a different brandId) → not_found.
- **`src/lib/scope.test.ts`** (pure parts of `tenant.ts`):
  - `isInScope`: tenant matching org → true; tenant cross-org → false; non-acting operator (effectiveOrgId null) → false for any row; acting operator matching `actingOrgId` → true; row `org_id null` → false.
  - `orgScope`: with a tenant ctx returns a predicate (assert it is **not** the false sentinel); with a non-acting-operator ctx returns the `sql\`false\`` sentinel (assert via the serialized SQL chunk or a `===`-able sentinel). Keep this assertion lightweight — the behavioural guarantee is fully covered by `isInScope`; `orgScope` is the SQL projection of the same decision.
- **`resolveOwnedResource` / `assertOwnership`** — the DB-touching/`notFound()`-throwing wrappers are **not** unit-tested against a live DB in S3 (no Postgres in CI). Their logic is the composition of already-tested pure cores (`orgScope` + `and(eq(id), …)`; `isInScope` + `notFound()`). Cover them behaviourally in **S4** when real routes/pages exercise them with two seeded orgs (S4's cross-org enumeration test is the natural home). Document this hand-off so S4 doesn't assume S3 covered them.
- **Build/typecheck:** `npm run build` passes; the evolved `requireBrandAccess(brandId, minRole?)` signature compiles and any S2 caller (there are none in production yet) still typechecks.
- **Zero-consumer grep:** `grep -rE "orgScope|assertOwnership|resolveOwnedResource|from \"@/lib/rbac\"" src/app` returns nothing.

### Suggested Implementation Order

1. **`src/lib/rbac.ts`** — `ROLE_RANK`, `roleRank`, `hasMinRole`, `Action`, `ACTION_MIN_ROLE`, `can`, `decideBrandAccess`. (Pure; no imports beyond the `OrgRole` type.)
2. **Test runner** — add `vitest` + `vitest.config.ts` (alias `@/`) + `test` scripts.
3. **`src/lib/rbac.test.ts`** — write the matrix + `decideBrandAccess` tests **first** (tests-first; these are the security guarantee).
4. **`src/lib/tenant.ts`** — add `orgScope`, `isInScope`, `assertOwnership`, `resolveOwnedResource`; evolve `requireBrandAccess` to `(brandId, minRole?)` via `decideBrandAccess`.
5. **`src/lib/scope.test.ts`** — `isInScope` + `orgScope` branch tests.
6. **Build + run tests**; grep to confirm zero production consumers. Note the S4 hand-off for the wrapper integration tests.

### Resolved Decisions

1. **Where the primitives live.** `orgScope`/`isInScope`/`assertOwnership`/`resolveOwnedResource` go in **`tenant.ts`** (plan §5.1 — tenant resolution lives in the seam), `rbac.ts` is a **new pure module** (plan §6 names it). The *pure* authz decisions (`can`, `decideBrandAccess`, `isInScope`) are isolated from I/O so the unit tests need no DB. (If importing `tenant.ts` in vitest ever triggers an unwanted side effect, the fallback is a pure `src/lib/scope.ts` that `tenant.ts` re-exports — but the lazy `db` proxy makes this unnecessary.)
2. **Unified linear rank, not per-tier roles.** `can` is a single action→min-rank map over one ordered scale (owner=4 … viewer=0), faithful to the plan's strict hierarchy and trivially correct/testable. If S5 ever needs a non-monotonic rule, `can` switches to an explicit per-action allow-set without changing call sites.
3. **Acting operator = owner-equivalent** within the acted org (full authority under the audited act-as). Coded now, dormant until S7.
4. **404 for non-scope, 403 for insufficient-role-in-scope.** `resolveOwnedResource`/`assertOwnership` and the non-member branch of `decideBrandAccess` yield 404 (non-disclosure); the role-too-low branch yields 403 on the API surface.

### Open Questions

- **RSC 403 verb.** Route handlers return `error("Forbidden", 403)` cleanly, but RSC pages have no idiomatic 403 unless Next 16's `forbidden()` interrupt is enabled (`experimental.authInterrupts` in `next.config` — **AGENTS.md mandates reading `node_modules/next/dist/docs` before touching `next.config`/routing**). S3 defaults `requireBrandAccess`'s `forbidden` decision to `notFound()` (safe, no config change). **Decision for S4:** enable `authInterrupts` + map insufficient-role → `forbidden()`, or keep RSC role-gating cosmetic (server data already scoped) and enforce true 403 only on the API surface? Recommend deciding when S4 first needs it.
- **Authoritative `Action` set.** The starter enum is derived from S5's acceptance text. Confirm with the S5 owner whether the granularity matches (e.g. split `manage_campaign` into `create`/`edit`/`archive`, or fold `publish_campaign` into `manage_campaign`). Adding/renaming actions is a one-line map edit + a test row.
- **Test runner = vitest?** It is the first dev dependency of its kind in the repo. Confirm vitest is acceptable over the zero-dep `node:test`+`tsx` route (which needs extra `@/` alias config).
- **Tenant-side audit (plan §12.5).** Out of scope for S3, but `can` is where high-value mutations (password reset, role grants) are gated — worth noting for the later audit decision.
