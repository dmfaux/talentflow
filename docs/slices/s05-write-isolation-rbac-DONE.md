# S5 · WRITE isolation + RBAC enforcement across all mutating routes

> **Phase 1 — Close the live breach (isolation + RBAC + blob privacy) — **V1 core****
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** close the write breach completely and enforce the two-tier role model on every mutation; **never trust body `client_id`/`org_id`/`security_group`**.
- **Backend (highlights):** `campaigns` POST (validate body brand ∈ ctx org + write role; set `org_id`), PATCH (`assertOwnership`; `status=active` publish gated to brand_admin/recruiter), DELETE/archive (ownership+role). `candidates/[id]` PATCH + `open-chat` (`resolveOwnedResource` + recruiter+). `from-job-spec` POST (org+brand+role **before** the LLM call; attribute usage in S10). `clients` POST (require org_admin/owner; bind `org_id`; remove client-supplied id), PATCH/`logo` (org+role; org-prefixed path in S6). `users` POST (org owner/admin only; bind to ctx org; create memberships within actor authority; **replace direct password-set with the invite flow, S8**), PATCH (no cross-org move/escalation), `[id]/password` (**target same-org + actor org_admin/owner or self; forbid operators/other orgs** — closes full account-takeover). `popia/run-purge`+`deletion-request` scoped to ctx org for tenant admins (operator-global only via act-as). **Public writes** (`apply` POST, `events` POST, chat inserts) set `org_id`/brand explicitly from the resolved campaign (not just via trigger). Replace `requireApiAuth` with `getApiTenant()` + `can(action, role)` on all remaining mutating routes.
- **Frontend:** hide/disable mutation controls by role (server remains source of truth); new-user form → invite flow.
- **Acceptance:** no write route accepts a body scope that escapes the actor's org/brands; Viewer 403 on all mutations; Recruiter manages candidates not brands/members; only Owner/Org-Admin manage members/brands; `users/[id]/password` cannot touch operators/other orgs; publish org+role gated; public inserts populate `org_id`/brand; tenant `run-purge` no longer hits other orgs; automated route × {wrong-org, insufficient-role} denial test passes.
- **Depends on:** S4 · **Risks:** many routes share the accept-body-`client_id` flaw (audit each); `api/apply` is public — derive org/brand from the resolved campaign, matching the trigger; invite-flow change spans API+UI (don't leave the old password-set path live).

---

# Implementation Spec: S5 · WRITE isolation + RBAC enforcement across all mutating routes

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s04-read-isolation`, commit `f1989db`
**Change type**: UI/UX (backend-dominated; small role-gating UI changes + the new-user → invite hand-off to S8)

> Classified UI/UX (mirroring S4's precedent) because of a handful of user-facing changes: hiding/disabling mutation controls by role, and relabelling the new-user create flow ahead of the S8 invite swap. The overwhelming majority of the work is **backend write-path enforcement**. The `frontend-design` skill is **mandatory** for the (light) frontend section.

> **Sequencing note:** at this commit the S4 *spec* is committed but the S4 *read conversions are not yet applied to the code* — every admin `route.ts` (GET included) still calls `requireApiAuth()`. **S5 depends on S4 landing first.** This spec is written against the post-S4 world (reads already on `getApiTenant()` + `orgScope`); where S5 touches a mixed-method file, it converts the **write** methods and assumes the GET is already converted. If S4 and S5 land together, convert both in the same file.

---

## Codebase Analysis

Everything S5 needs already exists from S1–S3; S4 establishes the read-path patterns S5 mirrors for writes. This slice is **pure application** of the guard primitives to every mutating handler, plus the explicit `org_id` stamping of public writes and the model-level `org_id` `.notNull()` flip.

**The seam + guards (S1–S3), all present and unit-tested:**
- `getApiTenant()` (`src/lib/api.ts:27`) → `{ ctx: TenantContext, response: null } | { ctx: null, response: NextResponse }`. Call pattern: `const { ctx, response } = await getApiTenant(); if (response) return response;`. Replaces the **payload-discarding** `requireApiAuth()` (`api.ts:14`) on every write handler.
- `TenantContext` (`src/lib/tenant.ts:18`): `{ userId, isOperator, orgRole, orgId, actingOrgId, effectiveOrgId }`. `effectiveOrgId = orgId ?? actingOrgId`; **`getActingOrgId()` returns `null` until S7**, so a non-acting operator has `effectiveOrgId === null` and writes nothing.
- `orgScope(table, ctx)` (`tenant.ts:141`) → `SQL`. Tenant/acting-operator → `eq(table.org_id, effectiveOrgId)`; non-acting operator → literal `sql\`false\``.
- `resolveOwnedResource(table, id, ctx)` (`tenant.ts:168`) → fetches by id **and** org-scopes in one query; **flat row or `null`** (no `with:` relations). The fix for raw-UUID resolution; returns `null` for a non-acting operator.
- `assertOwnership(row, ctx)` / `isInScope(rowOrgId, ctx)` (`tenant.ts:149-161`) — for rows already loaded (e.g. relational `findFirst` that needs `with:`).
- `getBrandMemberships(userId)` (`tenant.ts:70`) → `{ clientId, brandRole }[]`, cached per-request.
- `decideBrandAccess(actor, brandId, memberships, minRole)` (`src/lib/rbac.ts:78`) → `"allow" | "forbidden" | "not_found"` — the **pure** brand-access core (owner/org_admin/acting-operator allow implicitly; member ≥ minRole allow; member < minRole forbidden/403; non-member not_found/404).
- `can(action, role)` + `Action` + `ACTION_MIN_ROLE` (`rbac.ts:37-62`) — the linear-rank matrix. The starter `Action` set was **derived from this slice's acceptance text** and is authoritative here: `manage_candidate`/`manage_campaign`/`publish_campaign` → `recruiter`; `manage_brand`/`manage_member`/`manage_org_settings`/`run_popia_purge` → `org_admin`.
- `requireBrandAccess(brandId, minRole?)` (`tenant.ts:105`) — the **RSC/server-action** brand guard (throws `notFound()`). S5 needs the **API analog** that *returns a response* — see "New helpers" below.

**Schema (`src/db/schema.ts`):** every leaf carries `org_id` (`campaigns:103`, `candidates:145`, `scoring_logs:200`, `messages:292`, `conversations:320`, `chat_messages:350`, `chat_tokens:373`, `events:397`) plus `clients.org_id` (`:43`) and `users.org_id` (`:235`, **nullable — operators are NULL**). **The model still omits `.notNull()`** (comment: "model nullable until S5") even though the DB column is `NOT NULL` via `0026` + the transitional `BEFORE INSERT` trigger. `jobs.org_id` (`:553`) is **genuinely nullable** (populated in S10). `users.security_group` (`:244`) and `users.password_hash` (`:243`) are still `NOT NULL` (dropped/changed later — `security_group` in S13, password in S15). `memberships` (`:73`) is `{ user_id, client_id, brand_role }` with `unique(user_id, client_id)`.

**The write surface S5 must close (current state — every handler below calls `requireApiAuth()` and resolves/inserts with no org/role enforcement):**

| Route (`src/app/api/…`) | Method | Today's flaw | S5 enforcement |
|---|---|---|---|
| `admin/campaigns/route.ts` | POST | accepts body `client_id`, no org/role check, no `org_id` set | resolve brand in-org → `authorizeApiBrand(recruiter)` → insert `org_id: ctx.effectiveOrgId` |
| `admin/campaigns/[id]/route.ts` | PATCH | `findFirst(eq(id))` any campaign; `status=active` publishes anyone's | `resolveOwnedResource(campaigns)` → 404; brand `recruiter+`; publish gate |
| `admin/campaigns/[id]/route.ts` | DELETE | archives any campaign by UUID | `resolveOwnedResource(campaigns)` → 404; brand `recruiter+` |
| `admin/campaigns/from-job-spec/route.ts` | POST | accepts body `client_id`; **LLM call before any auth**; no `org_id` | in-org brand + `recruiter+` **before** `parseJobSpec`; set `org_id` |
| `admin/candidates/[id]/route.ts` | PATCH | `findFirst(eq(id))` any candidate (status/notes/reject) | scoped relational `findFirst` → 404; brand `recruiter+` |
| `admin/candidates/[id]/open-chat/route.ts` | POST | opens chat for any candidate by UUID | scoped relational `findFirst` → 404; brand `recruiter+`; stamp `org_id` on created rows |
| `admin/clients/route.ts` | POST | **accepts client-supplied `id`**; no org bind; no role | `authorizeApiOrg(manage_brand)`; **drop `providedId`**; `org_id: ctx.effectiveOrgId` |
| `admin/clients/[id]/route.ts` | PATCH | edits any brand by UUID | `resolveOwnedResource(clients)` → 404; `authorizeApiOrg(manage_brand)` |
| `admin/clients/logo/route.ts` | POST | uploads logo for any brand by UUID | `resolveOwnedResource(clients)` → 404; `authorizeApiOrg(manage_brand)` (org-prefixed path is S6) |
| `admin/users/route.ts` | POST | **arbitrary `client_id`+`security_group`**, global email | `authorizeApiOrg(manage_member)`; bind `org_id`; in-org brand; create membership; keep legacy `security_group`/password (harden; invite swap = S8) |
| `admin/users/[id]/route.ts` | PATCH | cross-org move + escalation via `clientId`/`securityGroup` | scope target to ctx org (exclude operators) → 404; `authorizeApiOrg(manage_member)`; reject out-of-org `clientId`; no org/role escalation |
| `admin/users/[id]/route.ts` | DELETE | deactivates **any** user by UUID | scope to ctx org → 404; `authorizeApiOrg(manage_member)`; block self/last-owner lockout |
| `admin/users/[id]/password/route.ts` | POST | **resets ANY user's password** (full account takeover) | resolve target in-org + `is_operator=false` → 404; allow `org_admin+` **or self**; forbid operators/other orgs |
| `admin/popia/run-purge/route.ts` | POST | `findAndPurgeExpiredCandidates()` purges **ALL orgs** | `authorizeApiOrg(run_popia_purge)`; **scope purge to ctx org** |
| `admin/popia/deletion-request/route.ts` | POST | purges by email across all orgs (S4 scopes lookup) | `authorizeApiOrg(run_popia_purge)` (lookup scoping done in S4) |
| `admin/popia/access-request/route.ts` | POST | returns PII by email across all orgs (S4 scopes lookup) | `authorizeApiOrg(run_popia_purge)` (subject-access is admin tooling) |
| `apply/[clientSlug]/[campaignSlug]/route.ts` | POST | candidate insert relies on trigger for `org_id` | **public** — resolve campaign incl. `org_id`; stamp `candidates.org_id` explicitly |
| `apply/[clientSlug]/[campaignSlug]/upload/route.ts` | POST | cv update (candidate already org-stamped) | no new scope (candidate is org-bound); verify nothing regresses |
| `events/route.ts` | POST | events insert relies on trigger for `org_id` | **public** — select `campaigns.org_id`; stamp `events.org_id` explicitly |
| `chat/[conversationId]/route.ts` | POST | `chat_messages` inserts rely on trigger | **public** — stamp `org_id` from `conversations.org_id` |

**Shared-lib writers that insert without `org_id`** (currently trigger-filled): `src/lib/chat.ts` — `createConversation` (`:32` inserts `conversations` + `chat_messages`) and `closeChatWithRejection` (`:214` inserts `chat_messages`); `src/lib/chat-auth.ts` / `chat/request-access` — `chat_tokens` inserts. These must take/derive `org_id` and stamp it explicitly so the S13 trigger drop is safe.

**The correctly-scoped reference patterns to copy:** `src/lib/chat-auth.ts:24` `verifyChatAuth` resolves candidate + `campaign → client` in one query (the ownership-resolve shape); `apply/.../route.ts:27-38` resolves a campaign by `client.slug + campaign.slug` (already the right join for public writes — just add `org_id`/`client_id` to the select).

**Tech stack:** Next.js 16.2.2 (App Router), Drizzle 0.45.2 over postgres-js, vitest 4 (DB-free) wired in S3. `@/* → ./src/*`.

## Related Issues

- **S1 (`3d99f1f`, done)** — `org_id` on every leaf, `memberships`, `org_role`, `is_operator`, the composite indexes, and the transitional `BEFORE INSERT` trigger. **S5 flips the model `org_id` to `.notNull()`** (DB is already `NOT NULL`); the trigger stays as the runtime backstop until S13.
- **S2 (`fef838f`, done)** — `getApiTenant`/`requireTenant`/`tenantFromSession`, operator-aware `SessionPayload`, the layout chokepoint.
- **S3 (`b8a55c7`, done)** — `orgScope`/`assertOwnership`/`resolveOwnedResource` + `rbac.ts` (`can`/`decideBrandAccess`) with unit tests. **S3 explicitly seeded the `Action` matrix from this slice's acceptance** — S5 is its authoritative owner.
- **S4 (`f1989db`, spec done — read conversions are S5's prerequisite)** — all admin GETs → `getApiTenant()` + `orgScope`/`resolveOwnedResource`; the 4 RSC pages → `requireTenant()` + scoped `findFirst`; POPIA **by-email lookup** scoped to ctx org. S5 builds directly on these patterns and the DB-backed cross-org enumeration harness S4 introduces.

### Assumptions from siblings (do **not** build these in S5)

- **Private blobs + org-prefixed paths (S6):** flipping the container to private, gating `generateSasUrl`/`downloadBlob` behind ownership, and moving upload paths to `cvs/{orgId}/…` / `logos/{orgId}/…`. S5 keeps the **current** blob paths (`uploadCV(clientSlug, …)`, `uploadClientLogo(clientId, …)`) and only enforces **ownership + role before the call** in `clients/logo` and `from-job-spec`. Do not change `azure-storage.ts` paths/ACLs.
- **Member invite flow (S8):** the `invitations` table, `/api/admin/members/invite`, `/api/auth/invite/accept`, and **replacing the direct password-set on user creation**. S5 **hardens** the existing direct-password `users` POST (org bind + RBAC + membership) but **keeps it functional** — `users.password_hash`/`security_group` are still `NOT NULL`, so removing the password path without the S8 invite replacement would break user creation. The risk-note "don't leave the old password-set path live" describes the **post-S8 end state**, not S5 in isolation (see Open Questions Q1).
- **Brand switcher + `activeBrandId` + brand-derived campaign create (S8):** S5's `campaigns` POST still **accepts a body `client_id`** (now validated in-org + role-gated). Dropping `client_id` in favour of `activeBrandId` is S8. The role-aware **sidebar** gating (Members/Brands/Settings) and exposing `ctx`/role to the `(admin)` layout are also S8 — so S5's frontend gating is done **per-page** where the RSC already has `ctx`, not via the layout/sidebar.
- **Operator act-as (S7):** `getActingOrgId()` stays `null`; the acting-operator branches (owner-equivalent) are coded but dormant. Don't try to make act-as work here.
- **POPIA purge **completeness** + lifecycle (S11):** completing `purgeCandidateData` (chat tables), `purgeOrganizationData`, org-status gating, and any cross-**all**-orgs operator purge. S5 only adds the **RBAC gate** + **ctx-org scoping** to the three tenant POPIA routes; it does not extend the cascade.
- **Usage metering / org-attribution (S10):** attributing the `from-job-spec` and chat LLM spend to the org. S5 adds the **auth gate before the LLM call**; the usage row is S10.
- **`jobs.org_id` + raw-SQL backstop (S10):** `jobs.org_id` stays nullable in S5; the `jobs/process` backstop SELECT is **not** in scope here.
- **Terminology "Clients → Brands" everywhere (S14):** S5 relabels only the surfaces it touches.

## Implementation Plan

### Database Changes

**No migration.** One **model-only** change in `src/db/schema.ts`: add `.notNull()` to `org_id` on the leaf tables now that every writer stamps it — **`clients`, `campaigns`, `candidates`, `scoring_logs`, `messages`, `conversations`, `chat_messages`, `chat_tokens`, `events`**. **Leave `users.org_id` nullable** (operators) and **`jobs.org_id` nullable** (S10). The DB column is already `NOT NULL` (migration `0026`), so this is purely a TypeScript contract tightening.

- **Why it matters / forcing function:** flipping the model to `.notNull()` makes Drizzle's `.insert(...).values({...})` **require** `org_id` at compile time on every insert site for those tables. The build will fail until each writer (routes + `lib/chat.ts` + seeds) provides `org_id` — this is the mechanical guarantee that no insert path is missed. The S1 trigger remains the runtime backstop until S13, so a momentarily-missed path is still filled at the DB, but the type change surfaces it first.
- **Expect a compile-driven sweep:** `src/db/seed.ts`, `src/db/seed-admin.ts`, the worker (`src/lib/queue/*`, `src/lib/process-candidate.ts`, `ai-scoring.ts`) and any other insert site for the above tables will need `org_id` supplied. For S5, supply it from the nearest org-bound parent (campaign/candidate/conversation). The **full seed rework is S14** — here, just make the seeds compile and insert valid `org_id`s.
- `resolveOwnedResource`/`assertOwnership` types tighten automatically (`org_id` becomes `string` on those rows) — no helper change needed.

### API / Backend Changes

#### New helpers (small, build on the S3 pure cores)

Add to `src/lib/api.ts` (API surface returns a `NextResponse`, never throws — unlike the RSC `requireBrandAccess`):

```ts
import { can, decideBrandAccess, type Action, type BrandRole } from "@/lib/rbac";
import { getBrandMemberships, type TenantContext } from "@/lib/tenant";
import type { OrgRole } from "@/lib/auth";

/** Effective org-level role for RBAC. An acting operator is owner-equivalent
 *  within the acted org (dormant until S7); otherwise the user's own org_role
 *  (null for plain brand members). */
export function effectiveOrgRole(ctx: TenantContext): OrgRole | null {
  if (ctx.isOperator && ctx.actingOrgId) return "owner";
  return ctx.orgRole;
}

/** Org-level RBAC gate (manage_brand / manage_member / manage_org_settings /
 *  run_popia_purge). Returns a 403 response or null (allowed). */
export function authorizeApiOrg(ctx: TenantContext, action: Action): NextResponse | null {
  return can(action, effectiveOrgRole(ctx)) ? null : error("Forbidden", 403);
}

/** Brand-level RBAC gate (manage_candidate / manage_campaign / publish_campaign).
 *  404 for a non-member brand (existence hidden), 403 for member-but-too-low,
 *  null for allowed. The resource is normally already org-scoped via
 *  resolveOwnedResource, so the only 404 path here is a same-org non-member brand. */
export async function authorizeApiBrand(
  ctx: TenantContext, brandId: string, minRole: BrandRole = "viewer"
): Promise<NextResponse | null> {
  const memberships = effectiveOrgRole(ctx) ? [] : await getBrandMemberships(ctx.userId);
  const decision = decideBrandAccess(ctx, brandId, memberships, minRole);
  if (decision === "not_found") return error("Not found", 404);
  if (decision === "forbidden") return error("Forbidden", 403);
  return null;
}
```

> These reuse `decideBrandAccess`/`can`/`getBrandMemberships` verbatim so the role matrix stays verified in one place (S3's tests). Keeping them in `api.ts` avoids a `next/server` import in `tenant.ts`. The brand-action min-role is `"recruiter"` for all three current brand actions.

#### The three write patterns

*Pattern W-A — create under a brand (POST):*
```ts
const { ctx, response } = await getApiTenant();
if (response) return response;
// …input validation…
const brand = await resolveOwnedResource(clients, body.client_id, ctx); // org boundary
if (!brand) return error("Brand not found", 404);
const denied = await authorizeApiBrand(ctx, brand.id, "recruiter");      // RBAC
if (denied) return denied;
await db.insert(campaigns).values({ ...fields, org_id: ctx.effectiveOrgId! }); // NEVER body.org_id
```

*Pattern W-B — mutate an existing resource (PATCH/DELETE):* flat resource → `resolveOwnedResource`; resource needing relations (candidate reject path) → scoped relational `findFirst`:
```ts
const existing = await resolveOwnedResource(campaigns, id, ctx);
if (!existing) return error("Not found", 404);
const denied = await authorizeApiBrand(ctx, existing.client_id, "recruiter");
if (denied) return denied;
```

*Pattern W-C — org-level mutate (brands/members/POPIA):*
```ts
const { ctx, response } = await getApiTenant();
if (response) return response;
const denied = authorizeApiOrg(ctx, "manage_member");
if (denied) return denied;
// resolve any target row with orgScope; bind org_id from ctx.effectiveOrgId
```

#### Route-by-route specifics (the non-mechanical bits)

1. **`campaigns` POST** (`campaigns/route.ts:53`) — replace the unscoped `clients.findFirst(eq(id))` (`:92`) with `resolveOwnedResource(clients, body.client_id, ctx)` → 404; `authorizeApiBrand(ctx, brand.id, "recruiter")`. **Publish gate:** if `body.status === "active"`, the same `recruiter+` is sufficient (a viewer is already 403'd by the brand gate). Insert with `org_id: ctx.effectiveOrgId!`. The per-`(client_id, slug)` uniqueness check (`:99`) is unchanged (now naturally in-org).

2. **`campaigns/[id]` PATCH/DELETE** (`campaigns/[id]/route.ts:48,144`) — swap `findFirst(eq(id))` (`:60`, `:154`) for `resolveOwnedResource(campaigns, id, ctx)` → 404; `authorizeApiBrand(ctx, existing.client_id, "recruiter")`. **Publish gate on PATCH:** when `body.status === "active"` and `existing.status !== "active"`, require `publish_campaign` (= `recruiter+`, already satisfied). Never accept `body.org_id`/`body.client_id` (campaign brand-move is out of scope; `client_id` is not in `allowedFields` — keep it that way).

3. **`campaigns/from-job-spec` POST** (`from-job-spec/route.ts:31`) — **move the auth before the LLM call**: after `getApiTenant`, `resolveOwnedResource(clients, clientId, ctx)` → 404 and `authorizeApiBrand(ctx, clientId, "recruiter")` **before** `extractTextFromCV`/`parseJobSpec` (`:73,:92`) so an unauthorised or cross-org caller never burns an LLM call. Insert (`:142`) with `org_id: ctx.effectiveOrgId!`.

4. **`candidates/[id]` PATCH** (`candidates/[id]/route.ts:122`) — the reject path needs `existing.campaign.role_title` + `existing.campaign.client?.name`, so keep the **relational** `findFirst` (`:133`) but add `orgScope`: `where: and(eq(candidates.id, id), orgScope(candidates, ctx))` → 404. Then `authorizeApiBrand(ctx, existing.campaign.client_id, "recruiter")` (`manage_candidate`). No `org_id` write (status/notes only).

5. **`candidates/[id]/open-chat` POST** (`open-chat/route.ts:9`) — add `orgScope` to the relational `findFirst` (`:19`) → 404; `authorizeApiBrand(ctx, candidate.campaign.client_id, "recruiter")`. **Stamp `org_id` on created rows:** pass `candidate.org_id` into `createConversation` (see lib change) and the `chat_token_hash` update is on an already-org-bound candidate.

6. **`clients` POST** (`clients/route.ts:38`) — `authorizeApiOrg(ctx, "manage_brand")`; **delete the client-supplied-id path** (`:87-88,:93`); **drop `tier` from the accepted fields** (`:79-85,:96`) so it defaults to `'standard'` (tier is operator-set — Resolved Decision 4); insert with `org_id: ctx.effectiveOrgId!`. Brand `slug` stays **globally unique** (the existing global uniqueness check at `:53` is correct per S1; existence-oracle hardening is S8).

7. **`clients/[id]` PATCH** (`clients/[id]/route.ts:45`) — `resolveOwnedResource(clients, id, ctx)` → 404 (replace `:56`); `authorizeApiOrg(ctx, "manage_brand")`. **Remove `tier` from `allowedFields`** (`:73`) and ignore a body `tier` — tier is operator-only (Resolved Decision 4); the tenant edits branding/contact/slug only.

8. **`clients/logo` POST** (`clients/logo/route.ts:13`) — `resolveOwnedResource(clients, clientId, ctx)` → 404; `authorizeApiOrg(ctx, "manage_brand")` **before** `uploadClientLogo` (`:40`). Org-prefixed blob path is S6.

9. **`users` POST** (`users/route.ts:39`) — `authorizeApiOrg(ctx, "manage_member")`. **Bind to ctx org:** `org_id: ctx.effectiveOrgId!`, ignore any body `org_id`. The body `clientId` (the brand to grant) must be **in-org**: `resolveOwnedResource(clients, clientId, ctx)` → reject if null. **Create one `memberships` row** for `(newUser.id, clientId, brandRole)` — caller-supplied brand role, **default `viewer`** (Resolved Decision 2); a user with no membership and no org_role sees nothing. Set `org_role` only **within the actor's authority** (Resolved Decision 5: owner may mint owner/org_admin; org_admin may mint ≤ org_admin, never owner). **Keep** `security_group` (legacy `NOT NULL`, gates nothing now — write a default) and the **hardened direct password** (still `NOT NULL`) until S8 swaps to invite. Replace the global email check (`:67`) with an **in-org** one (`(org_id, email)` per S1) — the global lookup is wrong now.

10. **`users/[id]` PATCH** (`users/[id]/route.ts:47`) — resolve the target **scoped to ctx org and `is_operator=false`**: `findFirst({ where: and(eq(users.id, id), orgScope(users, ctx), eq(users.is_operator, false)) })` → 404 (replace `:58`). `authorizeApiOrg(ctx, "manage_member")`. **Reject cross-org move and escalation** per Resolved Decision 5: a body `clientId` must resolve in-org (else 400/404); never move a user to another org; an `org_role` change must be rank-bounded by the actor, and an **org_admin may not modify an owner** (target's current rank > actor's rank → 403). The email-uniqueness check (`:82`) becomes per-org.

11. **`users/[id]` DELETE** (`users/[id]/route.ts:132`, soft-deactivate) — scope target to ctx org → 404; `authorizeApiOrg(ctx, "manage_member")`. Guard against **self-deactivation** and **deactivating the last active owner** (lockout) — return `409` with a clear message (Resolved Decision 5).

12. **`users/[id]/password` POST** (`users/[id]/password/route.ts:8`) — the account-takeover fix. Resolve target **scoped to ctx org + `is_operator=false`** → 404 (replace `:24`). Allow if `effectiveOrgRole(ctx)` is `owner`/`org_admin` **or** `id === ctx.userId` (self); else 403. This structurally **forbids touching operators or other orgs** (cross-org/operator targets resolve to 404). Keep the reset-token invalidation (`:38`).

13. **`popia/run-purge` POST** (`popia/run-purge/route.ts:4`) — `authorizeApiOrg(ctx, "run_popia_purge")`; **scope the purge to ctx org**: change `findAndPurgeExpiredCandidates()` (`src/lib/popia.ts:161`) to take an `orgId: string | null` and add `<orgId ? eq(candidates.org_id, orgId) : sql\`false\`>` to its `where` (mirror S4's `orgScope` null-semantics — a non-acting operator purges nothing). Pass `ctx.effectiveOrgId`. There is **no cross-all-orgs purge** for tenants here; operator-wide purge is S11.

14. **`popia/deletion-request` POST** (`deletion-request/route.ts:5`) — `authorizeApiOrg(ctx, "run_popia_purge")` (S4 already scopes `handleDataDeletionRequest`'s lookup to ctx org).

15. **`popia/access-request` POST** (`access-request/route.ts:5`) — subject-access returns candidate PII, so gate it `org_admin+` via `authorizeApiOrg(ctx, "run_popia_purge")` (S4 scopes the lookup). *(If product wants recruiters to run subject-access, add a dedicated `view_popia` action — Open Questions Q3.)*

16. **Public writes — stamp `org_id` explicitly (not via trigger):**
    - **`apply` POST** (`apply/.../route.ts:27`) — add `org_id: campaigns.org_id` (and `client_id`) to the campaign select; stamp `candidates.org_id` on the insert (`:120`). The downstream `chat_token_hash` update and CV upload are on the now-org-bound candidate.
    - **`events` POST** (`events/route.ts:59`) — add `org_id: campaigns.org_id` to the campaign select; stamp `events.org_id` on the batch insert (`:75`).
    - **`chat/[conversationId]` POST** (`chat/[conversationId]/route.ts:91,175`) — select `conversations.org_id` on the conv load (`:31`) and stamp `chat_messages.org_id` on both inserts.
    - **`lib/chat.ts`** — `createConversation` (`:18`) gains an `orgId` param; stamp it on the `conversations` (`:32`) and greeting `chat_messages` (`:48`) inserts. Callers: `open-chat` passes `candidate.org_id`; the apply path doesn't call it. `closeChatWithRejection` (`:194`) loads the conv (`:200`) — select `org_id` and stamp the `chat_messages` insert (`:214`).
    - **`chat_tokens` inserts** — audit `chat/request-access` (magic-link request) and stamp `org_id` from the resolved candidate.

17. **Retire `requireApiAuth`** — once S4 (reads) + S5 (writes) land, `requireApiAuth` (`api.ts:14`) has **zero references**. Remove it in S5 (or leave for the S13 cleanup) — confirm with `grep -r requireApiAuth src`.

### Frontend Changes

> **The `frontend-design` skill MUST be used for these UI changes** (mandatory for all UI/UX work in this project; consistent with the Tailwind v4 tokens in `src/app/globals.css`). Keep them minimal — **UI gating is cosmetic; the server is the source of truth** (§5.7). The full role-aware sidebar + invite UI is **S8**.

- **Per-page control gating (where the RSC already has `ctx`).** The mutation controls are client components fed by server pages: `CampaignActions` (`src/components/admin/campaign-actions.tsx`), `CandidateActions` (`candidate-actions.tsx`), and the brand/user "New"/"Edit" links. In the owning RSC pages (`(admin)/campaigns/[id]/page.tsx`, `(admin)/candidates/[id]/page.tsx`, `(admin)/clients/*`, `(admin)/users/*`), resolve `ctx`/role (the layout already calls `requireTenant()`), compute booleans (`canManageCampaign`, `canManageCandidate`, `canManageBrand`, `canManageMember`) with `can(...)`/membership, and pass them as props to hide/disable buttons. A `viewer` sees read-only screens; a `recruiter` sees candidate/campaign actions but not brand/member management.
- **New-user form** (`(admin)/users/new/page.tsx`) — this slice keeps the password-create form but it is **org_admin+ only** (server-enforced; hide the "New User" entry for others). Replace the **Security Group** select (`:210-219`) with a **brand-role** select (`brand_admin`/`recruiter`/`viewer`, default `viewer`) feeding `brandRole` (Resolved Decision 2); the legacy `security_group` is written server-side with a default and no longer surfaced. Relabel "Client → Brand" on the brand selector (cosmetic). The **swap to an invite modal is S8** — do not build it here, but don't widen access either.
- **Sidebar role gating (Clients/Users/Settings)** — defer to **S8**, which exposes `ctx`/role to the `(admin)` layout and reworks the sidebar (`src/components/admin/sidebar.tsx` has no role today and is a client component). S5 relies on **server 403/404** for these surfaces; cosmetic sidebar hiding lands with the S8 brand switcher.

### Edge Cases and Boundary Conditions

- **Body scope never trusted.** `org_id`, `client_id` (except as the *target brand to validate in-org*), `org_role`, `security_group`, and client-supplied `id` must never widen scope. `clients` POST's `providedId` is the sharpest example — delete it.
- **Non-acting operator writes nothing.** `effectiveOrgId === null` → `resolveOwnedResource` → null → 404; `ctx.effectiveOrgId!` insert would be null → the `.notNull()` model + the `orgScope` FALSE semantics must make this a clean 404/empty, never a null insert. Guard inserts behind a successful resolve/authorise so the non-null assertion is sound.
- **Cross-org valid UUID** → 404 (indistinguishable from "missing"), for every PATCH/DELETE/POST-by-id. No 403, no different message.
- **404 vs 403 split:** out-of-scope/non-member brand → **404**; in-scope but role too low → **403**. `authorizeApiBrand` encodes both; `authorizeApiOrg` is always 403 (the org boundary was already checked by the resolve).
- **Publish gate:** a `viewer` (or non-member) cannot flip `status → active`. Confirm both `campaigns` POST (`status: "active"`) and PATCH (`draft→active`) are gated.
- **LLM-before-auth:** `from-job-spec` must 404/403 **before** `extractTextFromCV`/`parseJobSpec` — assert the providers are never reached for a cross-org/unauthorised caller (the headline cost+isolation item).
- **Account takeover:** `users/[id]/password` for an operator id or another org's user → 404; for a same-org peer by a `recruiter`/`viewer` → 403; self → allowed.
- **Last-owner / self lockout:** block deactivating yourself or the final owner of an org.
- **Legacy `NOT NULL` columns:** `users` insert still needs `security_group` (set a legacy default, never read for authz) and `password_hash` (hardened direct-set until S8). Don't drop them here.
- **Tier self-escalation closed.** `clients` POST/PATCH no longer accept `tier` — a tenant can't promote its own brand to `enterprise`; it defaults to `'standard'` and the operator sets it (Resolved Decision 4).
- **Owner protection / no escalation.** An org_admin cannot mint an owner, modify/demote an owner, or move a user cross-org; nobody self-escalates; the last active owner cannot be removed (Resolved Decision 5).
- **Public-write `org_id`:** apply/events/chat inserts must carry the resolved campaign/candidate/conversation `org_id` — verify against the trigger value (they must match) so the S13 trigger drop is safe.
- **Mixed-method files:** converting POST/PATCH/DELETE must not regress the already-S4-converted GET (and vice-versa).
- **Idempotent membership:** `users` POST creating a `memberships` row must respect `unique(user_id, client_id)` (S1) — on conflict, update the role rather than 500.

### Test Plan

Extends S4's **DB-backed cross-org enumeration harness** (two seeded orgs, gated on `DATABASE_URL`) into a **write × {wrong-org, insufficient-role}** matrix — the acceptance gate.

- **DB-free unit tests (vitest, existing `npm test`):**
  - `src/lib/rbac.test.ts` is already authoritative for the matrix; **add `authorizeApiOrg`/`authorizeApiBrand`/`effectiveOrgRole`** pure-logic coverage where they don't touch the DB (e.g. `effectiveOrgRole` acting-operator → owner; `authorizeApiOrg` decision table). The membership-fetching branch of `authorizeApiBrand` is covered behaviourally below.
  - **Guard-coverage check (extend S4's `guard-coverage.test.ts`):** assert every admin `route.ts` exporting `POST`/`PATCH`/`DELETE` references `getApiTenant` **and** one of `authorizeApiOrg`/`authorizeApiBrand`/`resolveOwnedResource`; assert **no** mutating admin route still references `requireApiAuth`. Fail listing offenders.
- **DB-backed write-denial integration test** (the `DATABASE_URL`-gated vitest project — Resolved Decision 6 — two orgs + the five roles):
  1. **Cross-org writes 404:** Org A actor → `campaigns` PATCH/DELETE, `candidates` PATCH, `open-chat`, `clients` PATCH, `clients/logo`, `users` PATCH/DELETE/password, `from-job-spec` (assert no LLM call), each targeting an **Org B id** → 404.
  2. **Body-scope-escape rejected:** `campaigns` POST with a foreign/`client_id` of Org B → 404; `clients` POST with a supplied `id`/`org_id` → id ignored, `org_id` = actor org; `users` POST/PATCH with foreign `clientId`/`org_id`/escalating `org_role` → rejected.
  3. **Role matrix:** seed Org A `viewer`, `recruiter`, `brand_admin`, `org_admin`, `owner`. Assert: **viewer → 403 on every mutation**; **recruiter** manages candidates/campaigns (incl. publish) but **403 on brand/member** routes; **brand_admin** likewise org-level 403; only **owner/org_admin** manage brands/members and run POPIA.
  4. **Password takeover closed:** `users/[id]/password` — operator target → 404; other-org target → 404; same-org peer by recruiter → 403; self → 200.
  5. **POPIA org-scope:** `run-purge`/`deletion-request` as an Org A org_admin purge **only** Org A expired/by-email rows; an Org B-shared email is untouched in Org B.
  6. **Public writes stamp `org_id`:** an `apply`/`events`/`chat` write inserts rows whose `org_id` equals the resolved campaign's `org_id` (and matches what the trigger would have set).
  7. **Non-acting operator:** every mutation → 404/empty; no inserts.
- **Build/typecheck:** `npm run build` must pass — the `org_id` `.notNull()` flip is green only once **every** insert site (routes + `lib/chat.ts` + seeds) supplies `org_id`.

### Suggested Implementation Order

1. **Helpers + model flip:** add `effectiveOrgRole`/`authorizeApiOrg`/`authorizeApiBrand` to `api.ts`; flip `org_id` `.notNull()` in `schema.ts`; fix the compile errors across insert sites (routes/lib/seeds) by stamping `org_id`. Land this first — it's the forcing function and the public-write stamping in one sweep.
2. **Public writes** (`apply`, `events`, `chat/[conversationId]`, `lib/chat.ts`, `chat_tokens`) — explicit `org_id`, verified against the trigger.
3. **Brand-scoped writes:** `campaigns` POST/PATCH/DELETE, `from-job-spec` (auth-before-LLM), `candidates` PATCH, `open-chat`.
4. **Org-scoped writes:** `clients` POST/PATCH/`logo`; `users` POST/PATCH/DELETE/`password`; POPIA `run-purge`/`deletion-request`/`access-request`.
5. **Retire `requireApiAuth`**; extend the guard-coverage test.
6. **Frontend** per-page control gating (+ new-user access gate) — **with the `frontend-design` skill**.
7. **DB-backed write-denial matrix test**; run the full suite + `npm run build`.

### Resolved Decisions

All six prior open questions are resolved below (best-judgement calls grounded in the migration plan's product decisions and the current schema). The body sections above already reflect them.

1. **Direct password-set vs invite — keep + harden in S5; S8 removes it.** S5 keeps the direct-password `users` POST but hardens it (org bind + `manage_member` RBAC + membership creation). It is **not** removed here because `users.password_hash`/`security_group` are `NOT NULL` and no invite replacement exists until S8. **S8's spec must explicitly delete this path** when it lands the invite flow, so the two never coexist after S8 — that is what the risk-note "don't leave the old password-set path live" means at the post-S8 end state. (Until then the password create is a hardened, org_admin+-only path, which is acceptable for V1.)

2. **Membership granularity on user-create — single brand, explicit `brandRole`, default `viewer`.** `users` POST creates exactly **one** `memberships` row for the in-org `clientId` with a caller-supplied `brandRole`; when omitted it defaults to **`viewer`** (least privilege — the actor elevates later). Multi-brand membership management and the brand multiselect are S8. The legacy `security_group` body field is no longer read for authz (written with a default; dropped in S13).

3. **POPIA `access-request` role — `org_admin+`, no new action.** Subject-access returns full candidate PII across the org by email, so it is gated at `org_admin+` via `run_popia_purge` (same as deletion/purge). A finer `view_popia` action is intentionally **not** added (YAGNI); revisit only if product later wants recruiters to self-serve subject-access.

4. **`clients` `tier` is operator-only — strip it from tenant writes in S5.** Per product decision #7 (and S9), `tier`/`billing` are operator-set and conceptually live on the org; `clients.tier` is a legacy copy. Letting an org_admin set their own brand `tier` is a **self-service privilege escalation**, so S5 removes `tier` from the tenant-writable fields of **both `clients` POST and PATCH** (it defaults to `'standard'`; the operator sets the real tier on the org in S7/S9). Closing this now — not deferring to S9 — keeps the breach-closing slice self-consistent.

5. **Org-role escalation — rank-bounded, owner-protected, last-owner-safe.** Only `manage_member` (org_admin+) actors may set/modify `org_role`, and only within these bounds: an actor may assign a target `org_role` of rank **≤ the actor's own rank** (owner → owner/org_admin; org_admin → org_admin or lower, **never** owner), and may only modify a target whose **current** `org_role` rank is **≤ the actor's own rank** (so an org_admin cannot touch an owner). Nobody self-escalates; the **last active owner** of an org cannot be demoted or deactivated (`409`). Enforced on `users` POST + PATCH + DELETE.

6. **Write-denial test harness — a `DATABASE_URL`-gated vitest project, shared with S4.** Reuse the vitest infra added in S3: add a second vitest project (`*.itest.ts`, via a `vitest.integration.config.ts` / `projects` entry) run by a new `test:integration` script and **skipped when `DATABASE_URL` is unset**, so the default `npm test` stays DB-free. A shared two-org fixture seeds Org A/B + the five roles. S4 and S5 share this harness; whichever lands first creates it.
