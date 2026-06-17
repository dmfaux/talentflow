# S4 · READ isolation: all admin GETs + 4 direct-query server pages + POPIA-by-email

> **Phase 1 — Close the live breach (isolation + RBAC + blob privacy) — **V1 core****
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** enforce org/brand scoping on **every** read path so a second tenant sees only its own data.
- **Backend:** convert every admin GET to `getApiTenant()` + `orgScope`/brand predicate — `campaigns` GET (filter `eq(campaigns.org_id, ctx.orgId)`; restrict the `client_id` filter to in-org brands), `campaigns/[id]` + `report` + `analytics` + `candidates` + `cvs.zip` (resolve then `assertOwnership`), `candidates/[id]` + `cv` (404 **before** `generateSasUrl`) + `chat-transcript` + `open-chat` (via `resolveOwnedResource`), `clients` + `clients/[id]`, `users` + `users/[id]` (scope to org members; exclude operators), `dashboard` (inject the org predicate into **every** sub-query/CTE), `analytics` (ownership-check `campaign_id`), `check-slug` (campaign slug scoped; brand slug global per S1). Convert the **four direct-query server pages** (`(admin)/candidates/[id]/page.tsx`, `campaigns/[id]/{page,edit/page,report/page}.tsx`) to `requireTenant()` + `assertOwnership` → `notFound()` on mismatch. Scope `handleDataAccessRequest` (`popia.ts:51`) candidate-by-email lookup to `ctx.orgId`.
- **↳ Review correction:** rely on the **layout-level `requireTenant()` (S2)** as the default guard; per-page `assertOwnership` covers the specific resource. Add a CI check failing any admin GET/page lacking a guard.
- **Frontend:** campaigns "client" filter → "brand" filter limited to accessible brands; users list shows only org members.
- **Acceptance:** with two seeded orgs, an Org A user gets **404 for every Org B id** across all GETs + server pages (incl. `cv` with no SAS minted); dashboard/analytics totals reflect only Org A; brand-only recruiter sees only member brands; non-acting operator can load no tenant data, acting-as Org A sees exactly Org A; automated cross-org enumeration test passes.
- **Depends on:** S3 · **Risks:** one missed route/page = a hole (use the inventory as a checklist + CI grep); dashboard aggregate SQL must scope every sub-query; RSC pages use `notFound()` not a thrown 403.

---

# Implementation Spec: S4 · READ isolation (all admin GETs + 4 server pages + POPIA-by-email)

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s03-guard-library`, commit `b8a55c7`
**Change type**: UI/UX (backend-dominated; two small admin-shell UI changes)

> Classified UI/UX because of two user-facing changes (campaigns "client" filter → "brand" filter; users list scoped to org members). The overwhelming majority of the work is backend read-path enforcement.

---

## Codebase Analysis

Everything S4 needs already exists from S1–S3 — this slice is **pure application** of primitives that currently wire **zero** production routes (confirmed: only `src/app/(admin)/layout.tsx` references the seam today).

**The seam (S2) — `src/lib/api.ts` + `src/lib/tenant.ts` + `src/lib/auth.ts`:**
- `getApiTenant()` (`api.ts:27`) → `{ ctx: TenantContext, response: null } | { ctx: null, response: NextResponse }`. The route-handler analog of `requireTenant`; returns a `401` response instead of redirecting. Call pattern: `const { ctx, response } = await getApiTenant(); if (response) return response;`
- `requireApiAuth()` (`api.ts:14`) — the **payload-discarding** legacy guard. All 24 admin routes currently call it. S4 replaces it on **read** handlers only.
- `requireTenant()` (`tenant.ts:52`) — cached per-request (React `cache()`), redirects to `/login` if no session. Already called once in `(admin)/layout.tsx:18`; calling it again inside a child page is free (shared resolution).
- `TenantContext` (`tenant.ts:18`): `{ userId, isOperator, orgRole, orgId, actingOrgId, effectiveOrgId }`. `effectiveOrgId = orgId ?? actingOrgId`; **`getActingOrgId()` returns `null` until S7**, so in S4 a non-acting operator has `effectiveOrgId === null`.
- `getBrandMemberships(userId)` (`tenant.ts:70`) → `{ clientId, brandRole }[]`, cached per-request. Needed for brand-narrowing the campaigns list.

**The guards (S3) — `src/lib/tenant.ts` + `src/lib/rbac.ts`:**
- `orgScope(table, ctx)` (`tenant.ts:141`) → `SQL` predicate. Tenant/acting-operator → `eq(table.org_id, effectiveOrgId)`; **non-acting operator → literal `sql\`false\``** (no blanket bypass). Drops into the existing `conditions[]` + `and(...)` pattern. Requires the table to have `id` + `org_id` columns (`OrgScopedTable`).
- `assertOwnership(row, ctx)` (`tenant.ts:155`) → `notFound()` (404) if `row` is null or `row.org_id !== effectiveOrgId`; returns the row otherwise. **Requires the row to carry `org_id`** — so a `findFirst({ columns: {...} })` that omits `org_id` will not work with it (use `resolveOwnedResource` or add `org_id` to the column set).
- `resolveOwnedResource(table, id, ctx)` (`tenant.ts:168`) → fetches by id **and** org-scopes in one query; returns the **flat row or `null`** (no relations). Returns `null` for a non-acting operator. This is the fix for raw-UUID resolution. **Caveat: it does a flat `select()` — it cannot eager-load `with: {...}` relations.**
- `can(action, role)` / `decideBrandAccess(...)` (`rbac.ts`) — present, but role gating is **S5**. S4 enforces the **org boundary** and **list-level brand narrowing** only.

**Schema (S1) — `src/db/schema.ts`:** every leaf carries a denormalised `org_id` (`campaigns`, `candidates`, `scoring_logs`, `messages`, `conversations`, `chat_messages`, `chat_tokens`, `events`) plus `clients.org_id` and `users.org_id` (nullable; operators are `NULL`). The Drizzle model leaves `org_id` nullable until S5, but the DB column is `NOT NULL` (via migration `0026` + the transitional trigger) for every tenant row. Backing indexes already exist for the scoped aggregates: `*_org_id_idx`, `*_org_status_idx`, `*_org_created_idx` on campaigns/candidates/events/etc. **No schema change in S4.**

**Route inventory (current state — all 24 admin routes call `requireApiAuth()`):**

| Route (`src/app/api/admin/…`) | Read method(s) | Resolves by raw UUID? | Blob? | S4 action |
|---|---|---|---|---|
| `campaigns/route.ts` | GET (`client_id`,`status` filters) | no (list) | — | `getApiTenant` + `orgScope(campaigns)` + brand-narrow + in-org `client_id` filter |
| `campaigns/[id]/route.ts` | GET | `eq(campaigns.id,id)` | — | `getApiTenant` + `resolveOwnedResource(campaigns,id)` → 404; scope the status-count sub-query |
| `campaigns/[id]/analytics/route.ts` | GET | by `campaign_id` | — | assert campaign ownership first → 404; `orgScope` the candidates/scoringLogs aggregates |
| `campaigns/[id]/candidates/route.ts` | GET (status/score filters) | by `campaign_id` | — | assert campaign ownership → 404; `orgScope(candidates)` defence-in-depth |
| `campaigns/[id]/cvs.zip/route.ts` | GET | by `campaign_id` | `downloadBlob` | assert campaign ownership → 404 **before** any blob read; bundle only in-org CVs |
| `campaigns/[id]/report/route.ts` | GET | `eq(campaigns.id,id)` | — | `resolveOwnedResource(campaigns,id)` → 404; scope candidate sub-queries |
| `campaigns/check-slug/route.ts` | GET (`client_id`,`slug`) | — | — | verify `client_id` ∈ ctx org (else 404/`available:false`); campaign slug stays per-brand |
| `candidates/[id]/route.ts` | GET | `eq(candidates.id,id)` | — | `getApiTenant` + scope the `findFirst` (`with` relations) → 404 |
| `candidates/[id]/cv/route.ts` | GET | `findFirst({columns:{cv_url}})` | `generateSasUrl` | `resolveOwnedResource(candidates,id)` → **404 before `generateSasUrl`** |
| `candidates/[id]/chat-transcript/route.ts` | GET | by `candidate_id` | — | `resolveOwnedResource(candidates,id)` → 404, then load conversations |
| `candidates/[id]/open-chat/route.ts` | POST | `eq(candidates.id,id)` | — | `getApiTenant` + `resolveOwnedResource(candidates,id)` → 404 (role gate `recruiter+` is **S5**) |
| `clients/route.ts` | GET | no (list) | — | `getApiTenant` + `.where(orgScope(clients))` |
| `clients/[id]/route.ts` | GET | `eq(clients.id,id)` | — | scope the `findFirst` (`with:{campaigns}`) → 404 |
| `clients/check-slug/route.ts` | GET (`slug`) | — | — | **leave global** (brand slug is globally unique per S1; existence-oracle hardening is S8) |
| `users/route.ts` | GET | no (list) | — | `getApiTenant` + `.where(and(orgScope(users), eq(users.is_operator,false)))` |
| `users/[id]/route.ts` | GET | `eq(users.id,id)` | — | scope the select (`and(eq(id,id), orgScope(users), eq(is_operator,false))`) → 404 |
| `analytics/route.ts` (top-level) | GET (`campaign_id`) | optional | — | if `campaign_id`: assert ownership → 404; always `orgScope(events)` |
| `dashboard/route.ts` | GET | no (7 aggregates) | — | inject `orgScope` into **every** sub-query/CTE |
| `popia/access-request/route.ts` | POST (by email) | — | — | pass `ctx.effectiveOrgId` into `handleDataAccessRequest` |
| `popia/deletion-request/route.ts` | POST (by email) | — | — | scope `handleDataDeletionRequest` to ctx org *(write-ish; S4 closes the cross-org read of the lookup; full purge RBAC is S5/S11)* |

**Four direct-query server pages** (all resolve by raw UUID with `eq(...id...)` and rely on the layout for auth — none org-scope today):
- `(admin)/candidates/[id]/page.tsx:51` — `db.query.candidates.findFirst({ where: eq(candidates.id,id), with: {...} })` (loads campaign→client, scoringLogs, messages, conversations→chatMessages).
- `(admin)/campaigns/[id]/page.tsx:37` — `findFirst({ where: eq(campaigns.id,id), with:{client} })` + ~7 candidate aggregates filtered by `campaign_id`.
- `(admin)/campaigns/[id]/edit/page.tsx:34` — `findFirst({ where: eq(campaigns.id,id) })` (then 404s non-draft).
- `(admin)/campaigns/[id]/report/page.tsx:42` — `findFirst({ where: eq(campaigns.id,id), with:{client} })` + candidate aggregates.

**POPIA — `src/lib/popia.ts`:** `handleDataAccessRequest(email)` (`:51`) does `candidates.findMany({ where: eq(candidates.email, normalizedEmail) })` — **global, no org filter** (this is the live cross-tenant breach for the email lookup). `handleDataDeletionRequest(email)` (`:135`) is the same shape. `purgeCandidateData`/`findAndPurgeExpiredCandidates` are out of scope for S4 (cascade/purge completeness is S11).

**Frontend touchpoints:** `(admin)/campaigns/page.tsx` (client component) fetches `/api/admin/campaigns`, derives a **client** filter from returned `client_name`s (`:161`, label "All clients" `:293`, "Client" column header `:340`); `(admin)/users/page.tsx` renders all users with a "Client" column. Both become correct automatically once the GETs are scoped; only labels/derivation need a light touch.

## Related Issues

- **S1 (`3d99f1f`, done)** — added `org_id` to every leaf + `clients.org_id`/`users.org_id`, the composite indexes that back scoped aggregates, and the transitional `BEFORE INSERT` trigger. **S4 assumes `org_id` is populated and `NOT NULL` at the DB level on all tenant rows.**
- **S2 (`fef838f`, done)** — `getSession`/`requireTenant`/`getApiTenant`/`tenantFromSession`, the operator-aware `SessionPayload`, and the **layout-level `requireTenant()` chokepoint** already in `(admin)/layout.tsx`.
- **S3 (`b8a55c7`, done — current HEAD)** — `orgScope`/`isInScope`/`assertOwnership`/`resolveOwnedResource` + `rbac.ts` (`can`/`decideBrandAccess`) with unit tests (`scope.test.ts`, `rbac.test.ts`). Explicitly wires **no** production routes.

### Assumptions from siblings (do **not** build these in S4)

- **Write isolation + RBAC (S5):** all `POST`/`PATCH`/`DELETE` handlers, body-`client_id`/`org_id`/`security_group` rejection, `can(action, role)` gating, and the `recruiter+` gate on `open-chat`/`candidates PATCH`. **S4 leaves mutation handlers on `requireApiAuth()`** and only converts the read paths. For files with mixed methods (`campaigns/[id]`, `candidates/[id]`, `clients`, `clients/[id]`, `users`, `users/[id]`), **touch the GET only.**
- **Operator act-as (S7):** `getActingOrgId()` stays `null`. In S4 a non-acting operator therefore sees **nothing** (every `orgScope` → `FALSE`, every `assertOwnership`/`resolveOwnedResource` → 404/null). The "acting-as Org A" acceptance path is structurally satisfied by `effectiveOrgId` but only **exercised** once S7 wires the act-as cookie — don't try to make act-as work here.
- **Private blobs + ownership-checked SAS (S6):** flipping the container to private, gating `generateSasUrl`/`downloadBlob` behind ownership for the **report CV preview and `cvs.zip` download paths**, and the `cv_url` path backfill. S4's blob obligation is narrower: **404 cross-org before `generateSasUrl` is called** in `candidates/[id]/cv`, and 404 the cross-org campaign before `cvs.zip` reads any blob. Do not change blob ACLs/paths.
- **Brand switcher + `activeBrandId` + invite flow (S8):** the per-brand UI selector and server-validated `activeBrandId`. S4's brand narrowing is the **list-level membership filter** only (recruiter sees only member brands in the campaigns list); the interactive switcher is S8.
- **`check-slug` existence-oracle hardening (S8):** the brand `check-slug` staying global is **deliberate** for S4 (S1 keeps brand slug globally unique to back the subdomain rewrite). Do not "fix" it here.
- **POPIA purge cascade + lifecycle (S11):** completing `purgeCandidateData` (chat tables), `purgeOrganizationData`, and org-status gating. S4 only org-scopes the **by-email lookup**.
- **Terminology pass "Clients → Brands" everywhere (S14):** S4 relabels only the two surfaces it touches; the global rename is S14.

## Implementation Plan

### Database Changes

**None.** S1 (`drizzle/0026_tenant_schema.sql`) already added `org_id` to every leaf and the composite indexes (`campaigns_org_status_idx`, `campaigns_org_created_idx`, `candidates_org_status_idx`, `candidates_org_created_idx`, `events_org_created_idx`, etc.) that keep the scoped dashboard/list aggregates index-backed. No migration in this slice.

### API / Backend Changes

**The two reusable patterns** (apply per the inventory table above):

*Pattern A — list / aggregate (no single resource):* swap `requireApiAuth()` for `getApiTenant()`, then add `orgScope(<table>, ctx)` into the `conditions[]`/`.where(...)`:
```ts
const { ctx, response } = await getApiTenant();
if (response) return response;
// …
const conditions = [orgScope(campaigns, ctx)];          // hard org boundary
if (statusFilter) conditions.push(eq(campaigns.status, statusFilter));
// …
.where(and(...conditions))
```

*Pattern B — resolve a single resource by id:* use `resolveOwnedResource` (flat row) **or** fold `orgScope` into the existing relational `findFirst` when relations are needed:
```ts
// flat (route handlers): 404 on null
const campaign = await resolveOwnedResource(campaigns, id, ctx);
if (!campaign) return error("Not found", 404);

// with relations (keeps `with:{...}`): assertOwnership needs org_id in the row
const candidate = await db.query.candidates.findFirst({
  where: and(eq(candidates.id, id), orgScope(candidates, ctx)),
  with: { campaign: { with: { client: true } }, scoringLogs: true, messages: true, conversations: { with: { chatMessages: true } } },
});
if (!candidate) return error("Not found", 404);   // RSC page: notFound()
```

**Specific, non-mechanical conversions:**

1. **`campaigns/route.ts` GET — org scope + brand narrowing.** Add `orgScope(campaigns, ctx)` to `conditions`. For a plain member (not owner/org_admin, not acting operator) compute member brands and narrow:
   ```ts
   const allBrands = ctx.orgRole || (ctx.isOperator && ctx.actingOrgId);
   if (!allBrands) {
     const m = await getBrandMemberships(ctx.userId);
     const ids = m.map((x) => x.clientId);
     conditions.push(ids.length ? inArray(campaigns.client_id, ids) : sql`false`);
   }
   ```
   The `client_id` query-param filter must be **intersected** with the above (an out-of-org or non-member `client_id` yields no rows — never widens scope). Mirror the owner/member branch logic in `requireBrandAccess`/`decideBrandAccess` so the rule lives in one shape.

2. **`dashboard/route.ts` GET — every sub-query.** Inject the org predicate into all 7 parallel queries: `orgScope(campaigns, ctx)` on queries 1 & 6 (campaign stats, recent campaigns) and `orgScope(candidates, ctx)` on queries 2–5 and the time-series (query 7 — combine with the existing `tsFilter` via `and(tsFilter, orgScope(candidates, ctx))`; the `sql.raw` bucket expression is unaffected). A non-acting operator → all `FALSE` → all-zero dashboard (correct).

3. **`analytics/route.ts` GET (top-level, over `events`).** If `campaign_id` is supplied, `resolveOwnedResource(campaigns, campaignId, ctx)` → 404 when not owned **before** running aggregates. Always add `orgScope(events, ctx)` to every events query so the "all campaigns" path is org-bounded too.

4. **`candidates/[id]/cv/route.ts` GET — 404 before SAS.** Replace the `findFirst({ columns:{cv_url} })` with `resolveOwnedResource(candidates, id, ctx)` (returns the full row incl. `cv_url` + `org_id`); `if (!candidate) return error("Not found", 404);` **then** `if (!candidate.cv_url) …` **then** `generateSasUrl(...)`. The SAS must never be minted for a cross-org id.

5. **`campaigns/[id]/cvs.zip/route.ts` GET.** `resolveOwnedResource(campaigns, id, ctx)` → 404 first; only then query shortlisted candidates (optionally add `orgScope(candidates, ctx)` for defence-in-depth) and call `downloadBlob`. No cross-org blob is ever read.

6. **`candidates/[id]/chat-transcript` & `open-chat`.** Resolve the **candidate** by `resolveOwnedResource(candidates, id, ctx)` → 404; then run the existing conversation read/insert. (`open-chat` is a POST — S4 adds the ownership resolution to close the cross-org resolve; the `recruiter+` role gate is S5.)

7. **`campaigns/check-slug` GET.** Verify `client_id` is in-org first (`resolveOwnedResource(clients, clientId, ctx)`; if `null`, return `success({ available: false })` or `error(..., 404)`). The per-`(client_id, slug)` lookup is then naturally org-scoped. **`clients/check-slug` stays global** (see assumptions).

8. **`users/route.ts` & `users/[id]` GET.** List: `.where(and(orgScope(users, ctx), eq(users.is_operator, false)))`. Detail: add `and(eq(users.id, id), orgScope(users, ctx), eq(users.is_operator, false))` to the select → 404 on miss. (Operators have `org_id NULL`, so `orgScope` already excludes them; the explicit `is_operator` filter is belt-and-braces and matches the acceptance "exclude operators".)

9. **`clients` & `clients/[id]` GET.** List: `.where(orgScope(clients, ctx))`. Detail: scope the `findFirst({ with:{campaigns} })` with `and(eq(clients.id,id), orgScope(clients, ctx))` → 404.

**Four server pages (RSC):** add `const ctx = await requireTenant();` (free — shares the layout's cached resolution), fold `orgScope` into each `findFirst` `where` (so the `with:{...}` relations are preserved), and **404 via `notFound()`** on miss (the existing `if (!row) notFound()` becomes `if (!row) notFound()` after the scoped query, or use `assertOwnership(row, ctx)` which throws `notFound()` itself). For `campaigns/[id]/page.tsx` and `report/page.tsx`, once the parent campaign is ownership-checked, the candidate aggregates (filtered by `campaign_id`) are transitively in-org; add `orgScope(candidates, ctx)` to them as defence-in-depth per §5.3.

**POPIA — `src/lib/popia.ts`:** change `handleDataAccessRequest(email)` → `handleDataAccessRequest(email, orgId: string | null)` and add `and(eq(candidates.email, normalizedEmail), <orgId ? eq(candidates.org_id, orgId) : sql\`false\`>)`. Do the same for `handleDataDeletionRequest`. Update the two POPIA routes to pass `ctx.effectiveOrgId` (resolved via `getApiTenant`). A `null` effectiveOrgId (non-acting operator) must match **no** rows — mirror `orgScope`'s `FALSE` semantics, never `eq(org_id, null)`.

**Guard-coverage CI check (review correction).** No CI pipeline exists yet (`.github/workflows` absent; `npm test` runs vitest DB-free). Add a **DB-free vitest** `src/lib/guard-coverage.test.ts` (or `scripts/check-guards.ts` wired to a `lint:guards` npm script) that statically asserts: every `route.ts` under `src/app/api/admin/**` exporting a `GET` references `getApiTenant`, and each of the four server pages references `requireTenant`. Fail the test listing any file missing its guard. This is the backstop to the layout chokepoint (§5.2), not the primary defence.

### Frontend Changes

> **The `frontend-design` skill MUST be used when implementing these UI changes** (mandatory for all UI/UX work in this project; consistent with the Tailwind v4 tokens in `src/app/globals.css`). Keep both changes minimal — the heavy lifting is server-side, and UI gating is cosmetic (§5.7).

- **`(admin)/campaigns/page.tsx`** — rename the **client filter → brand filter**: state `clientFilter` → `brandFilter`, the derivation `clients` useMemo → `brands` (still derived from the now-org-scoped `client_name`s returned by the scoped GET), the `<option value="all">All clients</option>` → "All brands", the disabled-empty copy, and the "Client" `SortHeader`/column label → "Brand". Because the campaigns GET is now org-scoped **and** brand-narrowed for recruiters, the dropdown already lists only accessible brands — no client-side membership logic needed.
- **`(admin)/users/page.tsx`** — no logic change required (the scoped GET returns only org members, operators excluded). Optionally relabel the "Client" column to "Brand" for consistency; the full terminology pass is S14.

### Edge Cases and Boundary Conditions

- **Non-acting operator** (`effectiveOrgId === null`): every `orgScope` → `FALSE`, every `resolveOwnedResource`/`assertOwnership` → null/404, every aggregate → zero/empty. Verify the dashboard renders all-zeros without throwing and the lists render empty states.
- **Cross-org valid UUID**: a real Org B id requested by an Org A user must 404 — **indistinguishable from "does not exist"** (no 403, no different message). Confirm for `campaigns/[id]`, `candidates/[id]`, `clients/[id]`, `users/[id]`, `cv`, `cvs.zip`, `report`, `chat-transcript`, `open-chat`, and all four server pages.
- **CV SAS leak**: a cross-org `candidates/[id]/cv` must 404 with **no SAS minted** — assert `generateSasUrl` is not reached (the headline acceptance item).
- **Brand-only recruiter**: sees only member brands in the campaigns list; a recruiter with **zero** memberships sees an empty list (the `sql\`false\`` branch), not all org campaigns.
- **`client_id` filter param** (campaigns GET, check-slug): an out-of-org or non-member `client_id` must **narrow to nothing**, never widen — intersect with the org/brand predicate, don't replace it.
- **`assertOwnership` column trap**: a `findFirst({ columns: {...} })` that omits `org_id` silently breaks `assertOwnership`. Use `resolveOwnedResource` or include `org_id`.
- **POPIA null org**: operator-initiated POPIA-by-email with no act-as must match no candidates (not all candidates).
- **Mixed-method route files**: ensure converting GET does **not** alter the sibling POST/PATCH/DELETE (still `requireApiAuth` until S5).
- **`limit/offset` pagination** on `campaigns/[id]/candidates`: scope must apply to **both** the page query and the `count(*)` total (don't scope one and not the other).

### Test Plan

- **Guard-coverage unit test (DB-free, vitest):** `src/lib/guard-coverage.test.ts` — enumerate admin `route.ts` GET exports + the four server pages; assert each references its guard. Runs under the existing `npm test` (`vitest run`).
- **Cross-org enumeration integration test (DB-backed) — new harness.** The current vitest config is **DB-free** (`vitest.config.ts` includes only `src/**/*.test.ts` and the seam tests use no Postgres). S4's acceptance ("two seeded orgs, Org A user gets 404 for every Org B id") needs a real DB. Add a DB-backed test (gated on `DATABASE_URL`, e.g. `src/app/api/admin/**/*.itest.ts` with a separate vitest project, or a `tsx scripts/test-isolation.ts` runner) that:
  1. Seeds **two orgs** each with a brand + campaign + candidate (+CV row, conversation) — extend `seed.ts`/a fixture; `seed-admin.ts` currently seeds one org + one operator.
  2. Builds an Org A `TenantContext` and asserts **404/empty** for every Org B id across: `campaigns/[id]`, `candidates/[id]`, `clients/[id]`, `users/[id]`, `cv` (and that `generateSasUrl` is not invoked), `cvs.zip`, `report`, `analytics?campaign_id=<B>`, `chat-transcript`, `open-chat`, and the four server pages.
  3. Asserts **dashboard/analytics totals** for Org A exclude Org B rows.
  4. Asserts a **brand-only recruiter** sees only member-brand campaigns.
  5. Asserts a **non-acting operator** loads no tenant data (all-zero dashboard, 404 on every id).
  6. Asserts **POPIA-by-email** for an email present in both orgs returns only the caller-org records.
- **Behavioural cover for the S3 wrappers:** `resolveOwnedResource`/`assertOwnership` were intentionally left for S4 to cover behaviourally (noted in `scope.test.ts` header) — the integration test above is where that happens.

### Suggested Implementation Order

1. **POPIA lib + routes** (`popia.ts` + `access-request`/`deletion-request`) — smallest, self-contained, closes the global-email breach.
2. **Simple list GETs**: `clients`, `users`, `campaigns` (incl. brand narrowing) — exercises `orgScope` + `getBrandMemberships`.
3. **By-id resource GETs**: `campaigns/[id]`, `candidates/[id]`, `clients/[id]`, `users/[id]`, plus `cv` (404-before-SAS), `cvs.zip`, `report`, `chat-transcript`, `open-chat` — exercises `resolveOwnedResource`.
4. **Aggregate GETs**: `dashboard` (every sub-query), `analytics` (top-level + `campaigns/[id]/analytics`), `campaigns/[id]/candidates`, `campaigns/check-slug`.
5. **Four RSC server pages** — `requireTenant` + scoped `findFirst` + `notFound()`.
6. **Frontend** relabels (campaigns brand filter; optional users column) — **with the `frontend-design` skill**.
7. **Guard-coverage vitest** + **DB-backed cross-org enumeration test**; run the full suite.

### Open Questions

1. **Per-resource brand-level read gating vs list narrowing.** The acceptance "brand-only recruiter sees only member brands" is satisfied at the **list** level. Should a recruiter also 404 on a *direct* `campaigns/[id]` for a **same-org** brand they're not a member of? `requireBrandAccess(brandId, minRole)` exists to support this, but S4's hard requirement is the **org** boundary. Recommendation: keep S4 to org-isolation + list narrowing; layer per-resource brand gating in S8 with the brand switcher. Confirm this is acceptable.
2. **DB-backed test harness.** No DB test runner exists. Approve adding one (separate vitest project gated on `DATABASE_URL`, or a `tsx` script) and where the cross-org seed lives (extend `seed.ts` vs a dedicated fixture).
3. **Where does the guard-coverage check run?** With no `.github/workflows`, it can only gate via `npm test` locally/pre-commit for now. Acceptable, or should a minimal CI workflow be added in this slice?
4. **`check-slug` response when `client_id` is out-of-org:** return `{ available: false }` (treat as taken) or `404`? `{ available:false }` avoids leaking that the brand is foreign vs nonexistent; recommend that.
5. **POPIA route method semantics:** `deletion-request` is a mutation that S5/S11 also touch. S4 scopes its *lookup* to ctx org; confirm the role gate (`run_popia_purge` → org_admin+) is left for S5 to avoid double-touching.
