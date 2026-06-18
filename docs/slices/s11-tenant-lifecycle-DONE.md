# S11 · 🎨 Tenant lifecycle: suspend / soft-delete + complete org-scoped POPIA purge & cascade

> **Phase 3 — Cost control, lifecycle, routing, cleanup**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** org lifecycle controls + tenant-complete deletion (today `purgeCandidateData` omits `conversations`/`chat_messages`/`chat_tokens`; `run-purge` is global).
- **Backend:** enforce `org.status` in the seam (login rejects suspended[403]/deleted[401]; operators retain console; public careers refuse suspended/deleted). Operator routes: `suspend|restore|soft-delete|purge` (`requireOperator` + audit + confirmation). `popia.ts`: **extend `purgeCandidateData`** to also delete `conversations`+`chat_messages`+`chat_tokens`; make access/deletion/expiry org-scoped; add `purgeOrganizationData(orgId)` cascading **all** org tables in FK-safe order + deleting blobs under `cvs/{orgId}/**`, `logos/{orgId}/**`.
- **↳ Review correction (non-shippable as written — job resurrection):** "cancel jobs for a suspended/purged org" is insufficient alone. Also gate the **`jobs/process` backstop SELECT** and **worker re-enqueue paths** (nudge/expire) and `handleJob` entry on `org.status`, else work regenerates for a dead tenant. Add these files to S11's key-file list.
- **Frontend:** 🎨 operator lifecycle actions + confirmation + status badges; suspended-org messaging on login + public pages; tenant POPIA tools in settings (org-scoped).
- **Acceptance:** suspend blocks the org's users + freezes its careers pages without affecting others; restore re-enables; soft-delete reversible until hard purge; `purgeCandidateData` now removes chat PII; `purgeOrganizationData` leaves **zero** org rows + no `cvs/{orgId}/**` blobs; tenant POPIA touches only the caller's org; cross-org purge operator-only + audited; **jobs for a purged/suspended org do not regenerate**.
- **Depends on:** S6, S7, S10 · **Risks:** cross-check the chat-feature design (`MEMORY: project_chat_feature.md`) when adding chat tables to purge; hard purge is destructive (operator-only, audited, confirmation-gated); cascade order must respect FKs.

---

# Implementation Spec: S11 · Tenant lifecycle: suspend / soft-delete + complete org-scoped POPIA purge & cascade

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `345d6c9` (**S9 landed** — `s09-operator-provisioning-DONE.md`). **S10 is in flight** (`usage_events`, `EnqueueOptions.orgId`, `jobs.org_id` population, and `clients.from_name/reply_to_email` are NOT yet in the tree — confirmed by grep + git log). S11 **`Depends on: S6, S7, S10`**: S6 (blobs/org-prefixed paths) and S7 (operator console + audit) are **landed**; **S10 is the critical in-flight dependency** — S11's queue-resurrection gating wants S10's populated `jobs.org_id`.
**Change type**: **UI/UX** (operator lifecycle actions + confirmation modal + status badges; suspended/deleted messaging on login + public careers; tenant POPIA copy in settings) **and Backend** (the bulk: `org.status` enforcement in the seam + login + public routes; operator `suspend|restore|soft_delete|purge_org` routes; `popia.ts` chat-table purge extension + `purgeOrganizationData(orgId)`; a new blob prefix-delete; queue-resurrection gating across `jobs/process` + `worker.ts`). The `frontend-design` skill is **mandatory** for the operator/login/public screens — see Frontend Changes.

> **Three findings that reshape the slice as written — read first.**
> 1. **The slice's POPIA premise is partly stale (already fixed by S4/S5).** It says *"`run-purge` is global"* and asks to *"make access/deletion/expiry org-scoped"* — but `popia.ts` is **already org-scoped**: `handleDataAccessRequest(email, orgId)`, `handleDataDeletionRequest(email, orgId)`, and `findAndPurgeExpiredCandidates(orgId)` all gate on `orgFilter(orgId)` (`popia.ts:10-12`, returns `eq(candidates.org_id, orgId)` or `sql\`false\``), and `POST /api/admin/popia/run-purge` is **tenant-scoped** to `ctx.effectiveOrgId` (`run-purge/route.ts:15`) behind `authorizeApiOrg(ctx, "run_popia_purge")` (org_admin+). **So S11's genuine POPIA work narrows to:** (a) extend `purgeCandidateData` with the **three chat tables**, (b) add `purgeOrganizationData(orgId)` for the operator hard-purge, (c) add the **operator-only cross-org** purge surface. The "org-scope the tenant POPIA tools" line is already satisfied — don't redo it; just keep it.
> 2. **S11 likely needs NO migration.** `organizations.status` (default `'active'`), `suspended_at`, `deleted_at` already exist (`schema.ts:~31-33`, S1), and **every org-scoped table already has `org_id` NOT NULL with `onDelete: cascade`** — so a single `DELETE FROM organizations WHERE id=$1` cascades the entire tenant. The operator UI **already** renders status badges/dots and a status filter (`operator/page.tsx:23-27,121-129,194-199`; `operator/orgs/[id]/page.tsx:158-160`) for `active|suspended|deleted`. S11 is enforcement + routes + UI wiring, not schema. (`status` stays free-text validated in code, mirroring `tier` — see Decision B.)
> 3. **Login-only status enforcement is insufficient — the seam is the chokepoint.** `getSession()`/`tenantFromSession()` are pure JWT decode with **no per-request DB read** (`auth.ts:35-64`, `tenant.ts:56-81`), and the `admin_session` JWT lives 8h — so a user logged in *before* suspension keeps full access until the token expires. The acceptance *"suspend blocks the org's users"* therefore requires a status check in the **`cache()`-wrapped `tenantFromSession()`** (one cheap PK lookup per request), **plus** a fast-fail at login/invite-accept for a clean message. **Operators are exempt** — the impersonate route states verbatim *"Any org status is allowed — operators must support suspended / soft-deleted tenants"* (`operator/impersonate/route.ts:17`), so the gate keys on `!ctx.isOperator`.

> **Dependency / coordination status.**
> - **S6 (landed) — blobs/paths.** `src/lib/blob-paths.ts` gives `cvBlobPath(orgId, brandSlug, candidateId, filename)` → `cvs/{orgId}/{brandSlug}/{candidateId}/{filename}` (`:13-20`) and `logoBlobPath(orgId, clientId, filename)` → `logos/{orgId}/{clientId}/{filename}` (`:23-29`). **`orgId` is at path depth 1 in both** → org-wide prefix-delete is clean. Two Azure containers (CV = private `AZURE_STORAGE_CONTAINER_NAME`, logos = public `AZURE_STORAGE_LOGO_CONTAINER_NAME`).
> - **S7 (landed) — operator console + audit.** `requireApiOperator()` (`api.ts:62-70`), `recordOperatorAudit({operatorUserId, action, targetOrgId, metadata, ip, endedAt})` (`operator-audit.ts:34-50`), the `OPERATOR_AUDIT_ACTIONS` allow-list (`:11-17`), and the operator org-detail page (`operator/orgs/[id]/page.tsx`). S11 adds four audit actions + four routes + the lifecycle buttons on top.
> - **S10 (in flight — the critical dependency).** S11's cleanest queue gating filters on **`jobs.org_id`** (claim loop + handleJob), which **S10 populates**. S11 also gates the worker re-enqueue paths whose `EnqueueOptions` **S10 extends with `orgId`**. **Build S11 on a branch rebased onto S10.** Until S10 lands, the pre-S10 fallback is to resolve the org via `payload.candidateId → candidates.org_id` (every `JobPayload` carries `candidateId`). S11 adds **no migration**, so there is **no migration-numbering conflict** with S10 — only the queue-gating join path coordinates.
> - **Downstream (S12, S13, S14).** **S12** (host routing) will move public careers brand→org resolution into `middleware.ts`; S11 puts the `org.status` refusal in the page/route handlers now — coordinate so S12 doesn't drop it. **S13** drops `users.client_id`/`security_group` + the S1 triggers; S11's hard-purge (a plain cascade `DELETE`) is unaffected. **S14** (seed rework) is independent.

> **AGENTS.md mandate.** This is a modified **Next.js 16.2.2** (App Router). S11 edits the **auth seam** (`tenant.ts`), **route handlers** (login, invite-accept, public apply/chat, operator lifecycle), the **worker route handler** (`jobs/process/route.ts`, `db.execute(sql…)`), and **RSC public pages** (`c/[clientSlug]/...`). **Before writing/altering route-handler, RSC `redirect`/`notFound`, cookie, or `db.execute(sql…)` code, read the relevant guides under `node_modules/next/dist/docs/`** — the response/navigation/`sql`-interpolation APIs may differ from training data. Heed deprecation notices.

---

## Codebase Analysis

S11 adds **org lifecycle controls** (suspend / restore / soft-delete / hard-purge) and makes deletion **tenant-complete** (purge chat PII; wipe an entire org's rows + blobs). The schema substrate is fully in place from S1–S9; the work is **enforcement wiring + four operator routes + two `popia.ts` additions + one blob helper + queue-resurrection gates + the lifecycle UI**.

**`organizations` already carries the lifecycle columns and the operator UI already renders them.** `schema.ts` (~`:31-33`): `status text NOT NULL default 'active'` (free-text, **no** check constraint), `suspended_at timestamp`, `deleted_at timestamp`. Values used across the codebase: `'active'` (provisioning/apply), `'suspended'` (operator-isolation + provisioning tests), `'deleted'` (reserved, schema comment). The operator org-list (`operator/page.tsx:23-27` `STATUS_DOT`, `:121-129` status filter `["all","active","suspended","deleted"]`, `:194-199` render) and org-detail (`operator/orgs/[id]/page.tsx:158-160` `STATUS_BADGE`) **already** style all three states. S11 wires the *transitions*, not the display.

**The auth seam is the universal enforcement point — and it does no DB read today.** `SessionPayload = { userId, orgId: string|null, orgRole, isOperator }` (`auth.ts:14-19`); `getSession()` (`auth.ts:35-64`) verifies the HS256 `admin_session` JWT and returns claims with **zero DB lookups**. `tenantFromSession()` (`tenant.ts:56-81`) builds `TenantContext { userId, isOperator, orgRole, orgId, actingOrgId, effectiveOrgId, activeBrandId }` — also no DB read — and is wrapped in React `cache()` (`tenant.ts:85`), so a status check added here runs **once per request**. Both `requireTenant()` (RSC) and `getApiTenant()` (`api.ts:47-55`, routes) flow through it → **one check reaches every authenticated tenant surface**. The operator carries `isOperator:true`/`orgId:null`; when acting, `effectiveOrgId = actingOrgId`. The gate must be `if (!ctx.isOperator && ctx.effectiveOrgId) { … }` so at-rest operators (no org) and acting operators (must reach suspended/deleted orgs) both bypass.

**Login + invite-accept sign the JWT without a status check.** `POST /api/auth/login` (`api/auth/login/route.ts:7-57`): bcrypt + jose, queries `users` by normalised email **without `.limit(1)` and fails closed if `matches.length !== 1`** (the S2 login-disambiguation rule), then `signToken({userId, orgId, orgRole, isOperator})` (`:40-45`). `POST /api/auth/invite/accept` (`invite/accept/route.ts:~120`) also signs a token. Both need a pre-`signToken` status check (non-operator + `org_id`) returning **403 for suspended / 401 for deleted** — fast-fail with a clear message (the seam would also catch a stale session, but login is where users see the reason).

**Public careers are unauthenticated — the seam doesn't run, so each public surface needs its own `org.status` refusal.** Resolution is always via brand/campaign slug, and the org is reachable transitively: the campaign landing RSC `getCampaign()` (`c/[clientSlug]/[campaignSlug]/page.tsx:14-41`, currently joins `clients` only — add `campaigns.org_id` + an org-status check), the public **apply** `POST` (`api/apply/[clientSlug]/[campaignSlug]/route.ts:27-42` already selects `campaign.org_id` and checks `campaign.status === 'active'` — add the org-status check beside it), the public **chat page** (`c/[clientSlug]/[campaignSlug]/chat/page.tsx`), the chat **magic-link** `request-access` (`api/chat/request-access/route.ts:23-52`, already selects `candidate.org_id` — refuse but return the enumeration-safe success), and the **chat conversation** `POST` (`api/chat/[conversationId]/route.ts:31-43`, has `conv.org_id`). Suggested codes: **410 Gone** for deleted, **503 Service Unavailable** for suspended (pages coerce to `notFound()`/an "unavailable" view). The proxy (`proxy.ts:46-48`) intentionally bypasses auth for `/c/` — gates live in the handlers.

**`popia.ts` is candidate-id scoped (soft purge) and omits the chat tables.** `purgeCandidateData(candidateId)` (`popia.ts:16-55`) currently: `deleteCV(candidate.cv_url)` (`:27`) → `delete(messages)` (`:34`) → `delete(scoringLogs)` (`:35`) → **nullify** candidate PII + set `purged_at` (`:38-52`). It is a **soft** purge — the candidate row survives anonymised. It does **not** touch `conversations` / `chat_messages` / `chat_tokens`, which (per `MEMORY: project_chat_feature.md`, chat replaced WhatsApp on 2026-04-08 and is now *the* candidate PII channel) hold transcripts, the per-conversation messages, and the SHA-256 chat-auth tokens — **a POPIA gap**. `handleDataAccessRequest`/`handleDataDeletionRequest`/`findAndPurgeExpiredCandidates` are already org-scoped via `orgFilter`. RBAC: all three POPIA routes gate on `run_popia_purge` = org_admin+ (`rbac.ts:45,55`).

**Blob deletion is single-blob only — a prefix-delete must be built.** `azure-storage.ts`: `deleteCV(blobPath)` (`:160-167`) extracts the key and `deleteIfExists()`, guarded by `isStorageConfigured()`. **There is no list-then-delete / prefix-delete.** `purgeOrganizationData` must add one (e.g. `deleteOrgBlobsByPrefix(orgId, 'cv'|'logo')`) over `containerClient.listBlobsFlat({ prefix })` (handling pagination), deleting under `cvs/{orgId}/` (CV container) and `logos/{orgId}/` (logo container). `candidates.cv_url` stores the **relative path** (post-S6); `clients.branding_logo_url` stores a **public URL** — but prefix-delete keys off the path scheme, not the stored value, so both wipe cleanly. Unconfigured local dev → safe no-op early return.

**The hard purge is one cascade `DELETE` — and the audit must outlive it.** Every org-scoped table (`clients`, `campaigns`, `candidates`, `scoring_logs`, `conversations`, `chat_messages`, `chat_tokens`, `messages`, `events`, `invitations`, `memberships` (via FK chains), `users` (org-scoped only), `jobs` (org-scoped rows), and S10's `usage_events`) has `onDelete: cascade` from `organizations`, so `DELETE FROM organizations WHERE id=$1` leaves **zero org rows**. **Survivors by design:** operators (`users` with `org_id` NULL), global jobs (`jobs.org_id` NULL), and **`operator_audit` rows** — `operator_audit` is tenant-less with `target_org_id` `onDelete: set null` (`schema.ts:~684-686`). **Consequence:** after purge, the audit row's `target_org_id` is nulled, so the **purge audit must snapshot the org's `slug`/`name` in `metadata`** to stay queryable (Decision C).

**The queue resurrects work unless gated at four points (the "non-shippable as written" correction).** Cancelling a dead org's jobs is insufficient because new jobs regenerate. The chokepoints: **(1)** the `jobs/process` **raw-SQL backstop SELECT** (`jobs/process/route.ts:41-79`) re-enqueues `candidate-processing` for stuck candidates — add `AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = candidates.org_id AND o.status = 'active')`; **(2)** the **atomic claim loop** (`:85-106`) — filter claimed jobs to active orgs (via `jobs.org_id` once S10 lands, else a candidate join); **(3)** the **`handleJob()` entry** (`worker.ts:22-50`) — **the universal gate**, because the **Service Bus path has no claim loop** (messages dispatch straight to `handleJob`); **(4)** the worker **re-enqueue** paths `chat-nudge` (`worker.ts:269-276`), `chat-expire` (`:348-357`), and the `no-response` `send-email` (`:381-384`, covered transitively by the `handleJob` gate on the resulting email job). Each handler already loads the candidate (`handleEmailJob:55-58`, `handleChatInvitation:143-146`, `handleChatNudge:232-235`, `handleChatExpire:317-320`) — add a cheap org-status check. Non-active-org jobs should **skip-and-complete** (don't pile up, don't resurrect; on restore the backstop re-recovers candidate-processing) — see Decision D.

**The operator surfaces are ready to extend.** `PATCH /api/operator/organizations/[id]` (`[id]/route.ts:95-178`) is the audited-mutation template (`requireApiOperator` → load → mutate → `recordOperatorAudit({…, endedAt: now})` point-in-time). The org-detail page (`operator/orgs/[id]/page.tsx:143-318`) has the header/status badge, tier/billing save, `useToast`, and a **reusable `ConfirmModal`** (`src/components/ui/confirm-modal.tsx` — `{open, title, description, confirmLabel?, variant?: "danger"|"confirm", loading?, onConfirm, onCancel}`, already used by `ImpersonateButton`) for the destructive purge confirmation. Login error render: `app/login/page.tsx:126-131` (vermillion error line). Settings POPIA cards: `(admin)/settings/page.tsx:108-309` (already org-scoped; the deletion confirmation copy at `:312-340` needs to mention chat data).

**Tech stack:** Next.js 16.2.2 (App Router), Drizzle `drizzle-orm@^0.45.2` over postgres-js, jose HS256 (`ADMIN_AUTH_SECRET`, 8h), bcryptjs (12), Azure Blob Storage (`@azure/storage-blob`), vitest 4 `DATABASE_URL`-gated integration project (`*.itest.ts`, serial). Response helpers `success`/`error` (`api.ts:16-22`). Operator screens use the **control-plane palette** (`ink`/`paper`/`canvas`/`surface`/`border`/`cobalt`/`vermillion`, `green`/`warning`/`red` status); tenant/public use the admin/marketing palettes.

## Related Issues

- **S1 (done)** — created `organizations` with `status`/`suspended_at`/`deleted_at` + all org-scoped tables with `org_id` NOT NULL `onDelete: cascade`. S11 enforces/transitions `status` and relies on the cascade for purge.
- **S2 (done)** — the session seam (`getSession`/`tenantFromSession`/`getApiTenant`) and the login-disambiguation rule. **S11 adds the `org.status` check to the seam** (the cleanest place; `tenant.ts:56-81`) and to login/invite-accept.
- **S3 (done)** — `rbac.ts`: `run_popia_purge` (org_admin+) already gates tenant POPIA. S11 keeps it; the operator lifecycle/purge routes use `requireApiOperator` (not RBAC actions).
- **S4 + S5 (done)** — read/write isolation. **Already made POPIA access/deletion/expiry org-scoped** (`orgFilter` + `ctx.effectiveOrgId`) — the slice's "org-scope these" ask is satisfied (drift note 1).
- **S6 (done) — dependency.** Private blobs + org-prefixed paths (`blob-paths.ts`). S11's `purgeOrganizationData` deletes `cvs/{orgId}/**` + `logos/{orgId}/**` via a new prefix-delete.
- **S7 (done) — dependency.** Operator console + `operator_audit` + `requireApiOperator`. S11 adds `suspend`/`restore`/`soft_delete`/`purge_org` actions + routes + lifecycle buttons.
- **S8 (done)** — `users.org_id` nullable; org-level Owners. The seam status check covers org-level users (org_id non-null) and exempts operators (org_id null).
- **S9 (done)** — operator provisioning; the org-detail page S11 extends with lifecycle controls. The impersonate route's "any org status allowed" rule (Resolved Decision 5) is the operator-exemption precedent.
- **S10 (in flight — the critical dependency).** Populates `jobs.org_id` (S11's queue gate joins on it) and adds `EnqueueOptions.orgId` (re-enqueue gating). Build S11 rebased onto S10; pre-S10 fallback joins via `candidates.org_id`. No migration overlap (S11 adds none).
- **S12 (depends on S9)** — host routing moves public brand→org resolution to `middleware.ts`. **Coordinate:** S11 puts the public `org.status` refusal in the page/route handlers; S12 must not drop it when it reworks resolution.
- **S13 (depends on S5, S8, S10)** — drops `users.client_id`/`security_group` + the S1 triggers. Independent of S11 (hard-purge is a plain cascade `DELETE`); S13 finalises uniqueness.
- **S14 (depends on S8, S9, S10)** — seed rework. Independent; S11 touches no seed.

### Assumptions from siblings (do **not** build these in S11)

- **`jobs.org_id` population + `EnqueueOptions.orgId` (S10).** S11 *gates on* `jobs.org_id`/org-status; it does not populate `org_id` or thread `orgId` through enqueue sites (that's S10). If S11 starts before S10 merges, use the `candidates.org_id` join fallback and rebase.
- **Org-scoping of POPIA access/deletion/expiry (S4/S5 — already done).** Keep `orgFilter`/`ctx.effectiveOrgId`; do not re-implement.
- **`usage_events` table + `recordUsageEvent` (S10).** S11's cascade purge wipes `usage_events` automatically via its `org_id` cascade FK — no special handling, but note the table only exists once S10 lands.
- **Middleware host→org resolution (S12).** S11 gates public careers in the handlers; S12 owns the edge-routing rework.
- **Brand domain-email verification (a future slice, per S10 Decision D).** Out of scope.

## Implementation Plan

### Database Changes

**None expected.** `organizations.status`/`suspended_at`/`deleted_at` already exist; the cascade FKs already exist; the operator UI already renders the states. S11 is enforcement + routes + UI.

- **Optional (Decision B):** keep `status` free-text (mirrors `tier`); **do not** add a DB check constraint. Centralise the allowed values in code — add `export const ORG_STATUSES = ["active","suspended","deleted"] as const; export type OrgStatus = (typeof ORG_STATUSES)[number];` (e.g. in a new `src/lib/org-status.ts`) and validate in the operator routes. (If the team prefers a DB guard, a one-line `CHECK (status IN (...))` migration is additive and safe — but it is not required and the codebase doesn't constrain `tier` either.)
- **Optional Drizzle relation:** if you prefer `with: { organization: … }` loads in the worker over a direct lookup, add an `organization` relation to `candidatesRelations` in `schema.ts` (code-only, no migration). The spec below uses the centralised `getOrgStatus()` helper instead (Backend #1) to avoid relation churn.

### API / Backend Changes

> **Read the Next.js 16 route-handler / RSC `notFound`/`redirect` / `db.execute(sql…)` docs first (AGENTS.md).**

#### 1. The shared org-status primitive — `src/lib/org-status.ts` (NET-NEW)

```ts
export const ORG_STATUSES = ["active", "suspended", "deleted"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

/** Cheap PK lookup. Returns null if the org row is gone (hard-purged). */
export async function getOrgStatus(orgId: string): Promise<OrgStatus | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { status: true },
  });
  return (org?.status as OrgStatus) ?? null;
}
```
Reused by the seam, login, public routes, and worker — one definition of "is this org live". A purged org returns `null` (treat as deleted/gone).

#### 2. Enforce `org.status` in the seam (the universal gate — Decision A)

In `tenantFromSession()` (`tenant.ts:56-81`), after `effectiveOrgId` is computed, **for non-operators only**:
```ts
if (!isOperator && effectiveOrgId) {
  const status = await getOrgStatus(effectiveOrgId);
  if (status !== "active") {
    // suspended → 403; deleted/null → 401. RSC: redirect to /login?org=<status>.
    throw new OrgInactiveError(status ?? "deleted");
  }
}
```
- `requireTenant()` (RSC) maps `OrgInactiveError` → `redirect("/login?reason=suspended|deleted")`; `getApiTenant()` (routes) → `error(message, status===("suspended"?403:401))`. (Define a small typed error so both wrappers branch cleanly; mind the React `cache()` wrapper so the throw is consistent per request.)
- **Operators always pass** (`isOperator` short-circuits) — at-rest operators have no `effectiveOrgId`; acting operators must reach suspended/deleted orgs.
- This is what makes *"suspend blocks the org's users"* true for **already-logged-in** sessions, not just new logins.

#### 3. Fast-fail at login + invite-accept (clear message)

- `login/route.ts`: after the single-user match + bcrypt verify (`:36`), before `signToken` (`:40`): `if (!user.is_operator && user.org_id) { const s = await getOrgStatus(user.org_id); if (s === "suspended") return error("Your organisation is suspended — contact support", 403); if (s !== "active") return error("Your organisation is no longer available", 401); }`.
- `invite/accept/route.ts`: same guard before its `signToken` (~`:120`) — don't seat a user into a suspended/deleted org.

#### 4. Refuse public careers for suspended/deleted orgs

Resolve the org transitively and refuse (Decision A codes):
- **Apply `POST`** (`api/apply/.../route.ts:40`): beside the existing `campaign.status === 'active'` check, add `const s = await getOrgStatus(campaign.org_id); if (s !== 'active') return json({ error: s === 'deleted' ? 'Organisation no longer exists' : 'Applications are temporarily paused' }, s === 'deleted' ? 410 : 503);`.
- **Campaign landing RSC** (`c/[clientSlug]/[campaignSlug]/page.tsx`): include `campaigns.org_id` in `getCampaign()`'s select, then `if ((await getOrgStatus(row.org_id)) !== 'active') notFound()` (or render an "unavailable" view).
- **Chat page** (`c/[clientSlug]/[campaignSlug]/chat/page.tsx`) and **chat conversation `POST`** (`api/chat/[conversationId]/route.ts:43`): same check on the resolved `org_id` → `notFound()` / 410|503.
- **Magic-link `request-access`** (`api/chat/request-access/route.ts:40`): check `candidate.org_id`; if not active, **still return the enumeration-safe success** (don't leak org state via this endpoint), simply skipping token issue + email.

#### 5. Operator lifecycle routes (audited, confirmation-gated)

Add `"suspend"`, `"restore"`, `"soft_delete"`, `"purge_org"` to `OPERATOR_AUDIT_ACTIONS` (`operator-audit.ts:11-17`) — **no migration** (free-text action + in-code allow-list, mirroring `provision_org`). Then, following the `PATCH [id]` template (`requireApiOperator` → load → mutate → `recordOperatorAudit({…, endedAt: now})`):

```
POST /api/operator/organizations/[id]/suspend      → status:'suspended', suspended_at:now   (from active)
POST /api/operator/organizations/[id]/restore      → status:'active', suspended_at:null, deleted_at:null  (from suspended|deleted)
POST /api/operator/organizations/[id]/soft-delete  → status:'deleted', deleted_at:now        (from active|suspended)
POST /api/operator/organizations/[id]/purge        → purgeOrganizationData(id)                (ONLY from 'deleted')
```
- Each: `requireApiOperator()`; load org (404 if missing); validate the **state transition** (e.g. suspend only from `active`; **purge only from `deleted`** — the soft-delete interlock, Decision C); mutate; audit with `metadata` (`{ status_before, status_after }`; for purge: `{ slug, name, status_before, counts }` — see below). Suspend/restore/soft-delete are point-in-time `recordOperatorAudit` like `set_tier`.
- **Confirmation:** purge (and ideally soft-delete) requires a typed-confirmation body (e.g. `{ confirm: <org-slug> }`) the route validates — defence beyond the UI modal.

#### 6. `purgeOrganizationData(orgId)` — the hard purge (`popia.ts`, NET-NEW)

```ts
export async function purgeOrganizationData(orgId: string): Promise<void> {
  // 1. Snapshot identity for the audit BEFORE the cascade nulls target_org_id (Decision C) —
  //    the operator route reads org.slug/name and records the audit around this call.
  // 2. Wipe blobs by prefix (external system; outside the DB tx):
  await deleteOrgBlobsByPrefix(orgId, "cv");    // cvs/{orgId}/**   (CV container)
  await deleteOrgBlobsByPrefix(orgId, "logo");  // logos/{orgId}/** (logo container)
  // 3. One cascade delete wipes every org-scoped row (FK onDelete: cascade across the schema):
  await db.delete(organizations).where(eq(organizations.id, orgId));
  // Survivors by design: operators (users.org_id NULL), global jobs (jobs.org_id NULL),
  // operator_audit rows (target_org_id set null → metadata snapshot keeps them queryable).
}
```
- **Decision C — single cascade `DELETE`, not a hand-ordered teardown.** Every org-scoped table cascades from `organizations`; verify in the integration test that zero rows remain (Test Plan #7). An explicit FK-safe order (`chat_messages → chat_tokens → messages → conversations → scoring_logs → candidates → events → campaigns → memberships → password_reset_tokens → invitations → users(org-scoped) → clients → usage_events → jobs(org) → organizations`) is the documented fallback **only** if a future FK loses its cascade.
- **Blobs before rows:** prefix-delete keys off `cvs/{orgId}/`·`logos/{orgId}/`, so it does not need the (about-to-be-deleted) `cv_url`/`logo_url` values. Run it first/independently; the DB delete is the source of truth for "zero rows".

#### 7. Blob prefix-delete — `deleteOrgBlobsByPrefix(orgId, kind)` (`azure-storage.ts`, NET-NEW)

```ts
export async function deleteOrgBlobsByPrefix(orgId: string, kind: "cv" | "logo"): Promise<void> {
  if (!isStorageConfigured()) return;                 // local-dev safe no-op
  const container = kind === "cv" ? getContainerClient() : getLogoContainerClient();
  const prefix = `${kind === "cv" ? "cvs" : "logos"}/${orgId}/`;
  for await (const blob of container.listBlobsFlat({ prefix })) {   // SDK handles pagination
    await container.getBlockBlobClient(blob.name).deleteIfExists();
  }
}
```
Mirrors `deleteCV`'s `isStorageConfigured()` guard + `deleteIfExists()` idempotence.

#### 8. Extend `purgeCandidateData` with the chat tables (`popia.ts:16-55`)

After deleting `messages`/`scoringLogs` and before nullifying the candidate, add (FK-safe — `chat_messages` is a child of `conversations`):
```ts
await db.delete(chatMessages).where(
  inArray(chatMessages.conversation_id,
    db.select({ id: conversations.id }).from(conversations).where(eq(conversations.candidate_id, candidateId)))
);
await db.delete(conversations).where(eq(conversations.candidate_id, candidateId));
await db.delete(chatTokens).where(eq(chatTokens.candidate_id, candidateId));
```
(Or delete `chat_messages` directly by `org_id` + the candidate's conversation set; the subquery form is clearest.) The candidate row stays anonymised (`purged_at`) as today — this is a **soft** candidate purge; only the chat PII rows are hard-deleted. **Cross-check `MEMORY: project_chat_feature.md`**: chat is per-campaign, `chat_token` is SHA-256 on the candidate row *and* a `chat_tokens` table — purge both the table rows here and (already) the hashed value via the candidate nullify. **Recommended (secondary):** extend `handleDataAccessRequest` to include chat transcripts in the export, since chat is now the PII channel — POPIA "access" completeness. Flag in the PR if deferred.

#### 9. Queue-resurrection gating (the headline correction — Decision D)

- **`handleJob()` entry (`worker.ts:22-50`) — the universal gate.** At the top, resolve the job's org status and skip-and-complete if not active: post-S10 use `payload`'s org or `jobs.org_id`; pre-S10 (and for the Service Bus path, which lacks the table) resolve via `payload.candidateId → candidates.org_id`. `const s = await getOrgStatus(orgId); if (s !== 'active') { console.log('handleJob: skipping — org', s); return; }` — returning cleanly marks the DbQueue job `completed` (no requeue) and acks the Service Bus message. **This single gate covers both drivers.**
- **Backstop SELECT (`jobs/process/route.ts:41-79`):** add `AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = candidates.org_id AND o.status = 'active')` so a dead org's stuck candidates don't regenerate recovery jobs.
- **Claim loop (`:85-106`):** filter claimed jobs to active orgs. Post-S10: `… JOIN organizations o ON o.id = jobs.org_id WHERE o.status = 'active' …` (NULL-org global jobs always claimable). Pre-S10 fallback: skip this filter and rely on the `handleJob` gate (cheaper than a payload→candidate join in the hot claim path).
- **Re-enqueue guards (`worker.ts:269-276` nudge, `:348-357` expire):** before re-enqueuing, `if ((await getOrgStatus(candidate.org_id)) !== 'active') return;`. The `no-response` `send-email` re-enqueue (`:381-384`) is covered transitively by the `handleJob` gate on the resulting email job.

### Frontend Changes

> **The `frontend-design` skill is MANDATORY for every screen below** (project standard). Operator screens use the **control-plane palette** (`ink`/`paper`/`canvas`/`surface`/`border`/`cobalt`/`vermillion`; status `green`/`warning`/`red`) and the existing `ConfirmModal` + `useToast`. Login uses its existing chrome; public careers use the marketing/apply palette.

**1. Operator lifecycle actions (`operator/orgs/[id]/page.tsx`).** Add a **"Lifecycle"** card/section to the org-detail page exposing role-appropriate transitions driven by the current `org.status`:
- `active` → **Suspend** (warning) + **Soft-delete** (danger).
- `suspended` → **Restore** (confirm) + **Soft-delete** (danger).
- `deleted` → **Restore** (confirm) + **Purge permanently** (danger, **typed-slug confirmation**).
Each button opens the existing **`ConfirmModal`** (`variant="danger"` for soft-delete/purge) with explicit copy (purge: *"This permanently deletes all brands, campaigns, candidates, CVs, and chat data for {name}. This cannot be undone. Type {slug} to confirm."*), calls the matching `POST` route, shows the save-spinner, `toast()`s the result, and refreshes the page state. Reuse the header `STATUS_BADGE` (`:158-160`); no new status styling needed.

**2. Status badges (already present — verify only).** `operator/page.tsx` list dots (`:23-27`,`:194-199`) and the detail badge already cover `active|suspended|deleted`. Ensure the detail badge sits near the lifecycle actions; no new component.

**3. Suspended/deleted messaging.**
- **Login (`app/login/page.tsx:126-131`):** when the login `POST` returns 403/401 with the suspended/deleted message, render it in the existing vermillion error line (it already shows `data.error`). Optionally read `?reason=` (set by the seam redirect) to show a friendlier banner for users bounced mid-session.
- **Public careers:** the campaign/chat RSC pages render an **"This organisation isn't currently accepting applications"** view (or `notFound()`) when `getOrgStatus` is non-active — consistent with the existing inactive-campaign handling, no PII, with a route back to the public landing.

**4. Tenant POPIA tools in settings (`(admin)/settings/page.tsx`) — light touch.** The three POPIA cards are already org-scoped (drift note 1) — **no rescoping needed**. Update the **deletion confirmation copy** (`:312-340`) to state that chat conversations/transcripts are now included in the purge (matches Backend #8). That is the entire settings change.

### Edge Cases and Boundary Conditions

- **Live-session suspension (headline acceptance).** A user logged in before suspension must lose access on their **next request**, not in 8h — verified by the seam check (Backend #2). Test: mint a valid session, suspend the org, hit an `(admin)` route → 401/redirect.
- **Operators are never blocked.** An operator (and an operator *acting* on the org) must reach a suspended **and** a deleted org's console/impersonation. Test the seam exemption + the impersonate route on all three statuses.
- **Tenant isolation of lifecycle.** Suspending Org A must not affect Org B's logins or careers pages. Test cross-org non-interference.
- **Purge only from `deleted` (soft-delete interlock).** `POST …/purge` on an `active`/`suspended` org → rejected; must soft-delete first. Restore works from both `suspended` and `deleted`. Test the full transition matrix (active↔suspended, active/suspended→deleted→restore, deleted→purge).
- **Purge leaves zero rows + zero blobs, audit survives.** After purge: every org-scoped table has 0 rows for that org; no `cvs/{orgId}/**` or `logos/{orgId}/**` blobs remain; **operators, global jobs, and the `purge_org` audit row survive** (audit `target_org_id` nulled but `metadata.slug`/`name` preserved). Test all three survivor classes explicitly.
- **Chat PII actually deleted (POPIA).** After `purgeCandidateData`, the candidate's `conversations`/`chat_messages`/`chat_tokens` are gone (not just `messages`/`scoringLogs`); the candidate row is anonymised with `purged_at`. Test counts → 0 for the three chat tables.
- **No job resurrection for a dead org.** With a suspended/deleted org: the backstop SELECT inserts no recovery jobs; the claim loop skips its jobs; `handleJob` skips-and-completes; nudge/expire don't re-enqueue. Test by suspending an org with stuck candidates + scheduled chat jobs, ticking `jobs/process`, and asserting no new/processed work — and that **restore** lets the backstop recover normally.
- **Pre-S10 fallback path.** If S11 runs before S10 merges, `jobs.org_id` is unpopulated → the claim-loop filter is skipped and gating relies on the `handleJob` candidate-join. Test both code paths; rebase onto S10 before merge to enable the claim-loop filter.
- **Idempotent / safe re-runs.** Re-suspending a suspended org, restoring an active org, or purging an already-purged org (row gone) must no-op gracefully (404 on missing org for purge). `deleteOrgBlobsByPrefix` and `deleteCV` are idempotent (`deleteIfExists`).
- **Storage unconfigured (local dev).** `deleteOrgBlobsByPrefix` early-returns; purge still wipes DB rows. Test that purge succeeds with storage off.
- **Enumeration safety.** `request-access` for a suspended org returns the same success shape as for an unknown candidate (no org-state leak). Login returns a specific 403/401 (acceptable — the user owns that org).

### Test Plan

Extend the `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial), reusing the operator + two-org fixtures from `operator-isolation.itest.ts` (which already creates suspended-org fixtures) and the `getQueue()`/`@/lib/email` stubs. Add `lifecycle.itest.ts` and `org-purge.itest.ts` (+ DB-free unit tests).

- **DB-free unit tests (`npm test`):**
  - Transition validation: suspend only from active; purge only from deleted; restore from suspended|deleted; bad transitions rejected.
  - `getOrgStatus` maps a missing row → `null`.
  - Status→HTTP mapping: suspended→403 (login) / 503 (public); deleted→401 (login) / 410 (public).
  - `isOperatorAuditAction("purge_org")` → true after the allow-list edit.
- **DB-backed integration tests (gated):**
  1. **Seam enforcement:** a valid non-operator session whose org is then suspended → `getApiTenant()`/an `(admin)` route returns 401/redirect; an operator (at-rest and acting) on suspended/deleted orgs → allowed. Org B unaffected.
  2. **Login/invite gates:** login for a suspended org → 403; deleted → 401; active → 200. Invite-accept into a suspended org → rejected.
  3. **Public refusal:** apply `POST` / campaign page / chat for a suspended org → 503/unavailable; deleted → 410/not-found; `request-access` → enumeration-safe success with no token issued.
  4. **Lifecycle routes + audit:** operator suspend/restore/soft-delete each flips `status` (+ timestamps) and writes the matching `operator_audit` row; non-operators → 403.
  5. **`purgeCandidateData` chat extension:** seed a candidate with conversations/chat_messages/chat_tokens/messages/scoring_logs + a CV blob → after purge, all those rows = 0, CV blob deleted, candidate row anonymised with `purged_at`.
  6. **Purge interlock:** purge on active/suspended → rejected; soft-delete then purge → allowed.
  7. **`purgeOrganizationData` completeness:** provision Org A with brands/campaigns/candidates/chat/jobs/usage_events + CV & logo blobs → purge → **every** org-scoped table has 0 rows for Org A; no `cvs/{A}/**`/`logos/{A}/**` blobs; **operators, global (NULL-org) jobs, and the `purge_org` audit row (with `metadata.slug`) survive**; Org B fully intact.
  8. **No resurrection:** suspend an org with stuck candidates + scheduled nudge/expire → tick `jobs/process` → no recovery jobs inserted, none claimed, `handleJob` skips, no re-enqueue; **restore** → backstop recovers normally.
- **Build/typecheck:** `npm run build` — must compile against in-flight S10's `schema.ts`/worker/`jobs/process` edits (rebase first).

### Suggested Implementation Order

> Branch from / **rebase onto S10** (queue gating wants `jobs.org_id` + `EnqueueOptions.orgId`). S11 adds no migration, so no numbering coordination.

1. **Primitive:** `src/lib/org-status.ts` (`getOrgStatus`, `ORG_STATUSES`/`OrgStatus`).
2. **Enforcement (read paths):** seam check in `tenantFromSession` (+ `OrgInactiveError` mapping in `requireTenant`/`getApiTenant`); login + invite-accept fast-fail; public careers refusals. Integration-test seam + isolation + operator exemption first.
3. **Operator routes:** add the four audit actions; `suspend`/`restore`/`soft-delete`/`purge` routes (transition validation + audit + typed-confirmation). Test RBAC + transitions + audit.
4. **Blob prefix-delete:** `deleteOrgBlobsByPrefix` in `azure-storage.ts`.
5. **POPIA:** extend `purgeCandidateData` with the three chat tables (cross-check chat memory); add `purgeOrganizationData(orgId)`; (recommended) extend `handleDataAccessRequest` with chat transcripts.
6. **Queue gating:** `handleJob` entry gate (universal); backstop SELECT filter; claim-loop filter (post-S10); nudge/expire re-enqueue guards. Test no-resurrection + restore-recovers.
7. **Frontend (frontend-design skill):** lifecycle card + `ConfirmModal` wiring on org-detail; login/public messaging; settings deletion-copy update.
8. **Tests + `npm run build`** (rebased onto S10).

### Resolved Decisions (open questions answered)

> Resolved with best judgement on 2026-06-17 — proceed on these; each is reversible if product later disagrees.

**A. Enforce `org.status` at the seam (`tenantFromSession`), not only at login.** A login-only check leaves an 8h window for sessions minted before suspension, so *"suspend blocks the org's users"* would not hold for live users. The seam is `cache()`-wrapped (one PK lookup per request) and is the single point both RSC and routes flow through. Login/invite-accept also check, purely for a clean fast-fail message. **Operators are exempt** (`!ctx.isOperator`), and an acting operator's `effectiveOrgId` is the acted org — they must reach suspended/deleted tenants (per the impersonate route's stated rule). Codes: login 403 (suspended)/401 (deleted); public 503 (suspended)/410 (deleted).

**B. No migration; `status` stays free-text validated in code.** The columns exist and the codebase already treats `tier` as free-text with in-code validation — mirror that with an `ORG_STATUSES`/`OrgStatus` constant in `src/lib/org-status.ts`. A DB `CHECK` constraint is optional and additive but not required. Purge is a hard `DELETE`, needing no column.

**C. Hard purge = one cascade `DELETE FROM organizations` + prefix blob-deletes, gated on `status='deleted'`, with a metadata-snapshot audit.** Every org-scoped table cascades from the org row, so the single delete is correct and simplest; an explicit FK-safe teardown is the documented fallback only if a cascade is ever lost. Purge is allowed **only from `deleted`** (soft-delete interlock) + operator-only + typed-slug confirmation + audited. Because `operator_audit.target_org_id` is `set null` on cascade, the `purge_org` audit **must snapshot `slug`/`name` (and counts) in `metadata`** to remain queryable; operators and global (NULL-org) jobs survive by design.

**D. Queue gating: `handleJob` entry is the universal gate; backstop+claim filters are DbQueue optimisations; non-active-org jobs skip-and-complete.** Only the `handleJob` entry covers **both** drivers (the Service Bus path has no claim loop), so it is mandatory; the backstop SELECT and claim-loop filters additionally stop a dead org from *generating*/*being claimed* on the DbQueue path. Skip-and-complete (rather than leave-pending) avoids unbounded backlog during suspension and prevents resurrection; on **restore**, the `jobs/process` backstop re-recovers candidate-processing, and chat nudges/expiries are best-effort. Use `jobs.org_id` once S10 lands; the `payload.candidateId → candidates.org_id` join is the pre-S10 fallback.

**E. Candidate purge stays *soft* (anonymise + `purged_at`); only the chat PII rows are hard-deleted.** Consistent with today's `messages`/`scoringLogs` hard-delete + candidate nullify. The three chat tables (`conversations`/`chat_messages`/`chat_tokens`) are hard-deleted because chat is now the PII channel (`MEMORY: project_chat_feature.md`). Extending the **access**-request export to include chat transcripts is recommended for POPIA completeness but secondary to deletion.

**F. Build rebased onto in-flight S10.** The cleanest queue gate joins on S10's `jobs.org_id`; the re-enqueue guards sit alongside S10's `EnqueueOptions.orgId` threading. S11 adds no migration, so the only coordination is the gating join path — use the candidate-join fallback if S11 must start before S10 merges, then rebase.
