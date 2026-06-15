# TalentStream — Multi-Tenant (Org → Brands) Migration Plan

**Status:** Draft for review · **Date:** 2026-06-15 · **Scope:** Pivot from a TalentStream-operated managed service to a self-service, multi-tenant SaaS for large corporates.

> **How this plan was produced:** a 13-agent codebase audit mapped every subsystem and its tenancy gaps; eight product decisions were confirmed with the product owner; a design pass generated three independent slice plans (security-first / dependency-optimal / value-first) plus an exhaustive change inventory, which were synthesised and then **adversarially reviewed** against the real code. The reviewer's blocker/major findings are folded into the slices below and summarised in §9.

---

## 1. Executive summary

The codebase is, in the auditor's words, *"a single-tenant managed-service app wearing the vocabulary of multi-tenancy."* A `clients` table and a JWT carrying `clientId`/`securityGroup` exist, **but nothing enforces them**: `requireApiAuth()` (`src/lib/api.ts:13-20`) verifies only the token *signature* and discards the payload; `security_group` authorises nothing; ~24 admin routes and 4 direct-query server pages run unscoped. **The moment a second corporate logs in, it is a live cross-tenant breach** (read, write, account-takeover, and a global POPIA purge are all reachable by any authenticated user).

The migration is therefore dominated by **enforcement and identity work, not data-shape work**. We move in **15 vertical slices across 5 phases**, each independently shippable and ordered to (a) never lock out TalentStream staff and (b) close the breach completely *before* any external tenant is admitted.

**Target model:** an **organization** is the tenant and hard isolation boundary; the existing `clients` become **brands/divisions** under an org; users belong to one org and gain access to brands via **per-brand memberships**; roles are **two-tier** (org Owner/Org-Admin + per-brand Brand-Admin/Recruiter/Viewer); TalentStream staff are **tenant-less operators** with audited impersonation; auth stays bcrypt+JWT for now behind a **clean seam** and swaps to **Clerk** later.

**V1 cut line (safe for first external corporate):** S1–S6 (schema → seam → guards → read isolation → write isolation+RBAC → private blobs) **+ a layout-level guard, a minimal LLM rate-cap, and the `cv_url` backfill** (review-driven additions), plus thin cuts of operator provisioning/impersonation and the org-scoped POPIA fixes. Everything ergonomic or operator-facing can lag.

---

## 2. Confirmed product decisions

| # | Decision | Choice | Consequence |
|---|----------|--------|-------------|
| 1 | Operating model | **Self-service product; staff = support operators** | Operators get cross-tenant *view + audited impersonate*; no managed campaigns. Operator identity must exist above the tenant boundary. |
| 2 | Tenant shape | **Org → brands (two levels)** | New `organizations` table is the tenant; `clients` become brands beneath it. `org_id` is the isolation key on every table. |
| 3 | User→brand access | **Per-brand membership; many brands per user** | New `memberships(user_id, client_id, role)` join; `org_id` hard boundary, brand membership the soft filter. |
| 4 | Roles | **Two-tier**: org (Owner, Org-Admin) + brand (Brand-Admin, Recruiter, Viewer) | RBAC matrix; the inert `security_group` is replaced. |
| 5 | Onboarding | **Operator/sales-provisioned org**; Owner self-serves | No public signup → no anti-squatting on the critical path; need operator provisioning + member invites. |
| 6 | Auth | **Passwords now → Clerk later** | Keep custom auth minimal behind one seam; our DB stays the authz source (Clerk's flat orgs don't map onto our two-tier brand model). |
| 7 | Billing | **Defer payments; operator-set tier + usage metering now** | `tier`/`billing_email` move to the org; add per-org AI/usage metering to close cost exposure. |
| 8 | Data | **Pre-launch / demo-seed only** | Migrations may restructure freely + backfill + reset demo data; no zero-downtime/live-PII burden. |

---

## 3. Current architecture (as-is) & tenancy readiness (~25%)

- **Stack:** Next.js 16 App Router, Drizzle over postgres-js (`src/db/schema.ts`, lazy singleton `src/db/index.ts`). 12 tables.
- **Hierarchy:** `clients → campaigns → candidates → {scoring_logs, messages, conversations → chat_messages, chat_tokens}`; `events → campaigns`; `jobs` is a **global** queue with no tenant column.
- **Tenant references exist only on the top two levels** (`campaigns.client_id`, `users.client_id`). Leaf tables reach a client only by joining **up** through `campaigns`.
- **Auth:** staff email+password → HS256 JWT (`SessionPayload = {userId, securityGroup, clientId}`, `src/lib/auth.ts:11-15`) in `admin_session` cookie; `getSession` hard-rejects any other claim shape. Candidates use opaque sha256 chat tokens + magic links (`src/lib/chat-auth.ts`).
- **Enforcement is zero.** `requireApiAuth` discards the payload; `getApiSession` is used by 0 routes; `middleware.ts` skips all `/api`, re-implements its own signature-only verifier, and does `{slug}.{APP_DOMAIN} → /c/{slug}` rewriting for the public candidate site. `(admin)/layout.tsx` performs **no** auth.
- **Live exposure:** `campaigns` GET returns all clients; `candidates/[id]`, `cv`, `chat-transcript`, `open-chat` resolve by raw UUID; `users/[id]/password` resets *any* user; `users` POST/PATCH accept arbitrary `client_id`+`security_group`; `campaigns` PATCH `status=active` can publish another tenant's campaign; `popia/run-purge` purges **all** tenants.
- **Integrations single-account:** one email FROM; one Azure blob container with **public-blob access + wildcard CORS** (path-prefix-only separation); one AI key with **no metering** (chat fans out to **up to 3 LLM calls/message**); global jobs dedup index.

**Already in our favour:** `clients` is a credible tenant root (slug, branding, tier, billing_email); the JWT already carries a tenant claim; campaign slugs are already unique per client; the subdomain rewrite exists; candidate chat ownership checks (`chat-auth.ts`) are the one correctly-scoped pattern to copy.

---

## 4. Target architecture (to-be)

- **Tenant boundary:** new `organizations` table — the billing account, the isolation perimeter, and the only thing an operator can impersonate. `clients.org_id NOT NULL → organizations.id`; each brand keeps its own `slug`, branding, logo, public careers page. `tier`/`billing_email` move **up** to the org.
- **Identity:** a user belongs to one org (`users.org_id`; `NULL` only for operators). Brand access via `memberships(user_id, client_id, brand_role)` with `unique(user_id, client_id)`. Org Owner/Org-Admin (`users.org_role`) implicitly see all org brands.
- **Isolation = one indexed predicate, never a multi-join:** `org_id` is denormalised onto **every** leaf table (`campaigns, candidates, scoring_logs, messages, conversations, chat_messages, chat_tokens, events, jobs`) and backfilled. Brand-level filtering uses the **single** join to `campaigns.client_id` (see §5 invariant — we do **not** trust an unconstrained denormalised brand copy as the authz key).
- **The seam (Clerk-swappable):** a thin JWT carries only `{userId, orgId|null, orgRole|null, isOperator}`. **All** identity→tenant resolution lives in `src/lib/auth.ts` + new `src/lib/tenant.ts`: `getSession()`, `requireTenant()`, `requireBrandAccess(brandId, minRole)`, `requireOperator()`, `orgScope(table, ctx)`, `assertOwnership(row, ctx)`, `getBrandMemberships(userId)`. No route reads cookies/jose directly.
- **Operator model = deny-by-default + audited act-as:** an operator with no `actingOrgId` reaches **only** the operator console (the org predicate is `FALSE` on tenant rows). To touch tenant data they explicitly **act-as** an org → `effectiveOrgId = actingOrgId`, so the *same* scoping predicates apply, and every act-as is audit-logged. **No blanket bypass anywhere.**
- **Routing:** a dedicated authenticated **app host** (admin + operator console) split from public per-brand **careers subdomains** (`{brandSlug}.{APP_DOMAIN} → /c/{brandSlug}`). Brand `slug` stays **globally unique** to back the org-less subdomain rewrite; `organizations.slug` and `(org_id, email)` are separate namespaces.
- **Clerk later:** replaces *authentication/identity only*, keyed by `clerk_user_id`; our org/brand/membership/role model stays authoritative in our DB.

---

## 5. Cross-cutting principles & invariants

1. **Single identity seam.** All tenant resolution in `auth.ts` + `tenant.ts`. **CI grep forbids** direct `cookies()`/`jose` use outside the seam. This is what makes Clerk (S15) cheap and isolation auditable.
2. **Guard-by-default, not grep-by-default _(review correction)_.** `(admin)/layout.tsx` and `(operator)/layout.tsx` must call `requireTenant()` / `requireOperator()` so tenant context is resolved **once per shell**; child pages add `assertOwnership` for their specific resource. The layout is the structural chokepoint; the CI grep is a backstop, not the primary defence.
3. **Single scoping predicate.** Every guarded query uses `orgScope(table, ctx)` over denormalised `org_id` — never an ad-hoc multi-join. A missed join is a leak.
4. **Brand-key integrity _(review correction)_.** `org_id` is the denormalised hard boundary everywhere. For brand-level scoping, prefer the single join to `campaigns.client_id`. If a hot path keeps a denormalised `brand_id`, it **must** carry a DB `CHECK`/trigger invariant (`= parent campaign's client_id`) + a verification query — never an unconstrained copy as the authz key.
5. **Operator deny-by-default.** Non-acting operator predicate = `FALSE` on tenant rows; cross-tenant action only via explicit, audited act-as. Centralised so no route re-implements it.
6. **404, not 403, on cross-tenant resolves** (avoid existence disclosure); consistent across routes and RSC pages (`notFound()`).
7. **UI gating is cosmetic.** The server (S4/S5) is always the source of truth; `activeBrandId` and any client-supplied scope are re-validated server-side every request.
8. **Denormalisation invariant.** `org_id` set on **every** insert. A `BEFORE INSERT` trigger (S1) is the transitional shim, removed in S13 **only** once every writer — *including the raw-SQL `jobs/process` backstop (review correction)* — sets `org_id` explicitly.
9. **Rate-limit, don't just measure _(review correction)_.** Metering (S10) gives visibility; a **cap** is separate. A minimal per-org/per-conversation LLM rate-limit (S16) is required before external access because one shared AI key + chat's 3-call fanout = unbounded spend.
10. **Edge-safe verifier.** The shared token verifier (S2) is a leaf module depending only on `jose` + the secret — no `next/headers`, no db — so it can't pull node-only code into edge middleware.
11. **Auditability.** Operator impersonation, tier changes, org lifecycle (S7/S11) write to `operator_audit`; destructive ops are operator-only + confirmation-gated. *(Consider extending audit to high-value tenant mutations — password reset, role grants — see §12.)*
12. **AGENTS.md compliance.** This is a modified Next.js 16 — before editing middleware/auth/routing (S2, S12) or adding Clerk (S15), read `node_modules/next/dist/docs` and heed deprecations.
13. **Re-runnable migrations + idempotent seeds throughout.** Each slice leaves the app fully working and is PR-sized.
14. **Test gates.** Per-slice automated tests enumerate routes × {cross-org, insufficient-role} for reads (S4) and writes (S5); a post-purge scan asserts zero residual org rows/blobs (S11).

---

## 6. The vertical slices

> Legend: 🎨 = build UI with the **frontend-design** skill (consistent with the Tailwind v4 tokens in `src/app/globals.css`: `cobalt`, `ink`, `instrument-serif`, etc.). **↳ Review correction** = an amendment from the adversarial pass.

### Phase 0 — Tenant foundation (operator-lockout-safe, no behaviour change)

#### S1 · Tenant schema: organizations + brands + memberships + operators + `org_id` denormalisation
- **Goal:** introduce the org level above `clients`(=brands), per-brand memberships, two-tier roles, tenant-less operators, and denormalise `org_id` onto every leaf so all later scoping is one indexed predicate. Additive + backfilled; no runtime change.
- **Schema:** NEW `organizations` (id, name, `slug` unique, `tier` [moved from clients], `billing_email` [moved], `status` active|suspended|deleted, suspended_at/deleted_at, timestamps). ALTER `clients`: ADD `org_id NOT NULL → organizations.id ON DELETE CASCADE` (nullable during backfill, then NOT NULL); **keep `clients.slug` globally unique**; add `clients_org_id_idx`. NEW `memberships` (user_id, client_id, `brand_role` brand_admin|recruiter|viewer, `unique(user_id, client_id)`). ALTER `users`: ADD `org_id` (nullable for operators), `org_role` (owner|org_admin, null), `is_operator` (default false); DROP global `users_email_idx`; ADD `unique(org_id, email)` + partial unique on email WHERE `is_operator`; keep `client_id`+`security_group` transitionally (dropped in S13). ADD `org_id NOT NULL` to `campaigns, candidates, scoring_logs, messages, conversations, chat_messages, chat_tokens, events`. ALTER `jobs`: ADD `org_id` (see S10/§9 reconciliation). Indexes: `org_id` on every leaf + composite `(org_id, status)`/`(org_id, created_at)` for scoped aggregates. **Explicit `ON DELETE CASCADE` down the whole org subtree** (today FKs have no `onDelete`).
- **↳ Review correction (major — brand_id drift):** do **not** add an unconstrained `candidates.brand_id`. Use the single `candidates → campaigns.client_id` join for brand scoping; if a denormalised brand copy is later needed for a hot path, gate it with a `CHECK`/trigger invariant + verification query (§5.4).
- **Backend:** update `schema.ts`; write re-runnable migration `0026_*` that creates tables, adds columns nullable, **backfills** (one demo org wrapping existing clients-as-brands; set `clients.org_id`; cascade `org_id` down all leaves via up-joins; one membership per existing user → brand_admin; existing admins → `org_role='owner'`; mark `SEED_ADMIN` `is_operator=true`, `org_id NULL`), then SET NOT NULL. Include a **verification assertion: 0 leaf rows with null `org_id`**. Add a transitional `BEFORE INSERT` trigger deriving `org_id` from the parent campaign for not-yet-updated writers.
- **Acceptance:** migration clean on fresh DB **and** idempotent against the seeded DB; `count(*) WHERE org_id IS NULL = 0` on all leaves; uniqueness rules as specified; operators representable; app boots and apply/chat/admin behave identically (trigger fills `org_id`); no enforcement yet.
- **Depends on:** — · **Risks:** missed backfill row → NOT NULL failure (backfill before constraint, assert 0); cross-brand duplicate demo emails → pre-check/reseed; the compatibility trigger is load-bearing (cover with the verification query).

#### S2 · Identity/session seam: `getSession → requireTenant` (operator-aware, Clerk-ready)
- **Goal:** upgrade the session to carry org + operator identity and concentrate **all** identity resolution behind one swappable seam, **before** any scoping (the operator-lockout guard).
- **Schema:** `SessionPayload` → `{userId, orgId|null, orgRole|null, isOperator}` (JWT shape change invalidates sessions — fine pre-launch).
- **Backend:** rewrite `src/lib/auth.ts` (new payload; `getSession` parses new claims, drops the exact-3-claim reject; keep `signToken`/`verifyToken`/bcrypt isolated for the Clerk swap). NEW `src/lib/tenant.ts` (the seam): `requireTenant()` resolving the effective org (own org, or operator `actingOrgId`), `requireOrgRole`, `requireBrandAccess`, `requireOperator`, `getBrandMemberships` (resolved on demand, **not** in the JWT, cached per-request via React `cache()`). `src/lib/api.ts`: add `getApiTenant()` (API analog) replacing payload-discarding `requireApiAuth`. `login/route.ts`: sign the new payload (operators get `orgId NULL`). `middleware.ts`: extract the duplicated signature-only verifier into a **leaf edge-safe module** (jose + secret only — *review correction §5.10*) imported by both middleware and `auth.ts`. `seed-admin.ts`: also create an operator + attach the existing admin as Owner + brand_admin membership.
- **↳ Review correction (blocker — layout chokepoint):** make `(admin)/layout.tsx` (and later `(operator)/layout.tsx`) call `requireTenant()`/`requireOperator()` so tenant context is enforced once per shell (§5.2).
- **↳ Review correction (minor — login ambiguity):** decide login identity resolution **here**, not in S15. With `(org_id, email)` uniqueness, email-only `.limit(1)` is ambiguous. V1 choice: **operators globally unique; tenant emails kept effectively resolvable** (e.g. global-unique tenant email until Clerk, or subdomain/org context on the app host). Document the chosen rule.
- **Acceptance:** tenant cookie decodes to `{…, isOperator:false}`, operator to `{orgId:null, isOperator:true}`; `requireTenant` returns effective/acting org; `getApiTenant` no longer discards the payload; **only one** token-verify implementation exists; all routes still function (no scoping yet → no lockout); swapping to Clerk would touch only `auth.ts`+`tenant.ts`.
- **Depends on:** S1 · **Risks:** deploy logs out sessions (re-seed); **must precede S4** or operators are locked out; forbid direct cookie/jose reads outside the seam.

#### S3 · Guard library: `requireBrandAccess` + `orgScope`/`assertOwnership` + RBAC matrix
- **Goal:** the reusable enforcement primitives every read/write slice calls, with unit tests, before wide application.
- **Backend:** `orgScope(table, ctx)` → predicate: tenant user `eq(org_id, ctx.orgId)`; operator **without** act-as `FALSE` (closes the blanket-bypass hole); operator **with** act-as `eq(org_id, actingOrgId)`. `assertOwnership(row, ctx)` → **404** (not 403) when out of scope. `resolveOwnedResource(table, id, ctx)` fetches by id **and** asserts ownership in one query (fixes raw-UUID resolution). NEW `src/lib/rbac.ts`: role hierarchy (owner > org_admin > brand_admin > recruiter > viewer) + `can(action, role)`. Unit tests cover operator (acting/non-acting), owner, member, non-member, cross-org, and the RBAC matrix.
- **Acceptance:** predicates as specified; `resolveOwnedResource` 404s a valid cross-org UUID; `requireBrandAccess` denies a recruiter on a non-member brand, allows owner/admin + acting operator; matrix tests pass; **no production route uses the helpers yet** (zero behaviour change, still shippable).
- **Depends on:** S2 · **Risks:** operator implicit-bypass must be centralised + consistent; RBAC mistakes are security bugs (tests first); 404-vs-403 consistency.

### Phase 1 — Close the live breach (isolation + RBAC + blob privacy) — **V1 core**

#### S4 · READ isolation: all admin GETs + 4 direct-query server pages + POPIA-by-email
- **Goal:** enforce org/brand scoping on **every** read path so a second tenant sees only its own data.
- **Backend:** convert every admin GET to `getApiTenant()` + `orgScope`/brand predicate — `campaigns` GET (filter `eq(campaigns.org_id, ctx.orgId)`; restrict the `client_id` filter to in-org brands), `campaigns/[id]` + `report` + `analytics` + `candidates` + `cvs.zip` (resolve then `assertOwnership`), `candidates/[id]` + `cv` (404 **before** `generateSasUrl`) + `chat-transcript` + `open-chat` (via `resolveOwnedResource`), `clients` + `clients/[id]`, `users` + `users/[id]` (scope to org members; exclude operators), `dashboard` (inject the org predicate into **every** sub-query/CTE), `analytics` (ownership-check `campaign_id`), `check-slug` (campaign slug scoped; brand slug global per S1). Convert the **four direct-query server pages** (`(admin)/candidates/[id]/page.tsx`, `campaigns/[id]/{page,edit/page,report/page}.tsx`) to `requireTenant()` + `assertOwnership` → `notFound()` on mismatch. Scope `handleDataAccessRequest` (`popia.ts:51`) candidate-by-email lookup to `ctx.orgId`.
- **↳ Review correction:** rely on the **layout-level `requireTenant()` (S2)** as the default guard; per-page `assertOwnership` covers the specific resource. Add a CI check failing any admin GET/page lacking a guard.
- **Frontend:** campaigns "client" filter → "brand" filter limited to accessible brands; users list shows only org members.
- **Acceptance:** with two seeded orgs, an Org A user gets **404 for every Org B id** across all GETs + server pages (incl. `cv` with no SAS minted); dashboard/analytics totals reflect only Org A; brand-only recruiter sees only member brands; non-acting operator can load no tenant data, acting-as Org A sees exactly Org A; automated cross-org enumeration test passes.
- **Depends on:** S3 · **Risks:** one missed route/page = a hole (use the inventory as a checklist + CI grep); dashboard aggregate SQL must scope every sub-query; RSC pages use `notFound()` not a thrown 403.

#### S5 · WRITE isolation + RBAC enforcement across all mutating routes
- **Goal:** close the write breach completely and enforce the two-tier role model on every mutation; **never trust body `client_id`/`org_id`/`security_group`**.
- **Backend (highlights):** `campaigns` POST (validate body brand ∈ ctx org + write role; set `org_id`), PATCH (`assertOwnership`; `status=active` publish gated to brand_admin/recruiter), DELETE/archive (ownership+role). `candidates/[id]` PATCH + `open-chat` (`resolveOwnedResource` + recruiter+). `from-job-spec` POST (org+brand+role **before** the LLM call; attribute usage in S10). `clients` POST (require org_admin/owner; bind `org_id`; remove client-supplied id), PATCH/`logo` (org+role; org-prefixed path in S6). `users` POST (org owner/admin only; bind to ctx org; create memberships within actor authority; **replace direct password-set with the invite flow, S8**), PATCH (no cross-org move/escalation), `[id]/password` (**target same-org + actor org_admin/owner or self; forbid operators/other orgs** — closes full account-takeover). `popia/run-purge`+`deletion-request` scoped to ctx org for tenant admins (operator-global only via act-as). **Public writes** (`apply` POST, `events` POST, chat inserts) set `org_id`/brand explicitly from the resolved campaign (not just via trigger). Replace `requireApiAuth` with `getApiTenant()` + `can(action, role)` on all remaining mutating routes.
- **Frontend:** hide/disable mutation controls by role (server remains source of truth); new-user form → invite flow.
- **Acceptance:** no write route accepts a body scope that escapes the actor's org/brands; Viewer 403 on all mutations; Recruiter manages candidates not brands/members; only Owner/Org-Admin manage members/brands; `users/[id]/password` cannot touch operators/other orgs; publish org+role gated; public inserts populate `org_id`/brand; tenant `run-purge` no longer hits other orgs; automated route × {wrong-org, insufficient-role} denial test passes.
- **Depends on:** S4 · **Risks:** many routes share the accept-body-`client_id` flaw (audit each); `api/apply` is public — derive org/brand from the resolved campaign, matching the trigger; invite-flow change spans API+UI (don't leave the old password-set path live).

#### S6 · Integrations hardening: private blobs + ownership-checked SAS + org-prefixed paths
- **Goal:** close the public-blob PII breach.
- **Backend:** `scripts/init-storage.ts` — container **private**, CORS restricted to the app host. `src/lib/azure-storage.ts` — `generateSasUrl` is the **only** CV read path; upload paths → `cvs/{orgId}/{brandSlug}/{candidateId}/…`, `logos/{orgId}/…` (take `orgId`); stop returning any raw `blockBlob.url`. Gate SAS issuance behind `resolveOwnedResource`/`assertOwnership` **before** `generateSasUrl` in `candidates/[id]/cv`, `cvs.zip`, and report CV downloads. `apply` upload writes to the org/brand path.
- **↳ Review correction (blocker for shippability — dangling blobs):** include a **`cv_url` backfill / one-off blob move inside this slice** (existing seeded values use `cvs/{clientSlug}/…`). Verify `generateSasUrl`/`deleteCV` resolve post-rename. **Acceptance add:** every non-null `cv_url` resolves to an existing blob after S6. Do **not** defer this to S14.
- **Frontend:** 🎨 report/candidate-detail request CVs via the SAS endpoint; careers-page logos via a public-logo path or long-TTL signed URL.
- **Acceptance:** direct blob GET without SAS → 403; CV download works for authorised admin via short-lived SAS; cross-tenant candidate → 404 before any SAS; new uploads under `cvs/{orgId}/…`; `cvs.zip`/report bundle only in-org CVs; no wildcard CORS; careers logo still renders.
- **Depends on:** S5 · **Risks:** flipping to private breaks embedded raw URLs (route logos via signed/public path); ensure connection-string credential extraction still works.

#### S16 · Minimal LLM abuse guards (per-org rate-limit / quota) — **pulled into V1** _(new, review-driven)_
- **Goal:** a **cap**, not just metering. One shared AI key + chat's up-to-3-calls/message = unbounded spend by a tenant or an abusive applicant.
- **Backend:** minimal per-org (and per-conversation/per-IP for the public chat) rate-limit/quota on the LLM surfaces — chat (`/api/chat/[conversationId]`), `from-job-spec`, scoring enqueue. Reject/queue past the cap with a clear error; default conservative limits, operator-overridable per tier.
- **Acceptance:** a single org/conversation cannot exceed the configured LLM call rate; limits are visible and operator-adjustable; normal usage unaffected.
- **Depends on:** S5 (needs org attribution) · **Risks:** thresholds need tuning (start conservative); keep the limiter cheap on the hot path.

### Phase 2 — Operate + onboard the tenant model

#### S7 · 🎨 Operator console + audited impersonation (act-as)
- **Goal:** the tenant-less operator surface: list/search orgs, view any org, set tier/plan manually, and **impersonate** so the *same* scoping applies, fully audited.
- **Schema:** NEW `operator_audit` (operator_user_id, action, target_org_id, started_at, ended_at, ip). Impersonation via a **short-lived act-as cookie/claim** read by `requireTenant`, **not** baked into the long-lived JWT.
- **Backend:** `tenant.ts` — active act-as sets `effectiveOrgId = actingOrgId` so S4/S5 scoping transparently applies; without act-as the operator predicate denies tenant data. Operator routes (`requireOperator`): list/search orgs, org detail, PATCH tier/billing_email + audit, POST `impersonate`/`impersonate/exit` (+audit), per-org usage (S10). Validate `isOperator` server-side on every act-as; time-box impersonation; exclude operators from tenant user lists.
- **Frontend:** 🎨 NEW `src/app/(operator)/` console (org list, detail, set-tier, impersonate); global **"Acting as <Org> — Exit"** banner in the `(admin)` layout when `actingOrgId` is set. `(operator)/layout.tsx` calls `requireOperator()` (§5.2).
- **Acceptance:** non-acting operator sees the console and **cannot** load tenant data; after impersonating Org A sees exactly Org A through the normal shell with the banner; exit restores the console; tier/usage readable; every act-as/tier change in `operator_audit`; non-operators 403 on `/api/operator/*`.
- **Depends on:** S4, S5 · **Risks:** highest-risk surface — `requireOperator`-gated, time-boxed, audited, never silently destructive.

#### S8 · 🎨 Role-aware tenant shell + brand switcher + member invites + brand-derived campaigns
- **Goal:** the self-service tenant experience.
- **Schema:** NEW `invitations` (org_id, email, client_id [nullable for org-level], org_role/brand_role nullable, `token_hash`, expires_at, accepted_at, invited_by; `unique(token_hash)`, `unique(org_id, email)` while pending) — mirrors the hardened sha256 single-use TTL token pattern.
- **Backend:** expose `ctx` to the `(admin)` layout via `requireTenant` + `getBrandMemberships`; add a **server-validated** `activeBrandId` (narrows S4 reads to one brand; `org_id` stays the hard boundary). POST `/api/admin/members/invite` (org_admin/owner) → invitation + email. POST `/api/auth/invite/accept` (public) → validate token, create org-scoped user + memberships + org_role, set password, sign session. `campaigns` POST + wizard drop required body `client_id` → derive from `activeBrandId` + membership. Members CRUD (org-scoped + RBAC).
- **Frontend:** 🎨 `sidebar.tsx` rename **Clients → Brands**, add **Members**, gate Members/Brands/Settings by `org_role`, brand-scoped active state, integrate the act-as banner; `(admin)/layout.tsx` org name + **BrandSwitcher** (caller's brands + "All" for owner/admin); Members page (list + invite modal with brand+role); accept-invite page; wizard shows the active brand as fixed context.
- **↳ Review correction (major — slug squatting/oracle):** with self-service brand creation + globally-unique slug, gate brand-slug creation behind operator approval **or** make `check-slug` return a generic "unavailable" (no cross-org existence confirmation) + per-org rate-limit/auth. Treat the existence oracle as a real risk.
- **Acceptance:** sidebar matches role; brand switcher lists only caller's brands (+All for owner/admin) and re-scopes lists; server rejects an `activeBrandId` the user isn't a member of; invite→accept→login yields a recruiter limited to the chosen brand; invite can't join another org; expired/used tokens rejected; campaign create never requires/accepts `client_id`; public apply still resolves by slug.
- **Depends on:** S5, S7 · **Risks:** invite token must mirror hardened magic-link semantics + be org-scoped; `activeBrandId` validated server-side every request (UI gating cosmetic).

#### S9 · 🎨 Operator org provisioning + org/brand settings
- **Goal:** complete onboarding (decision 5): operators provision org + first Owner; Owners self-serve org/brand settings.
- **Backend:** POST `/api/operator/organizations` (`requireOperator`) → create org + issue an org-level Owner invite (S8 mechanism). PATCH `/api/admin/organization` (owner/org_admin) for name/contact (tier/billing operator-only). Extend `clients` PATCH for brand branding/slug/careers fields (brand_admin/owner). Rework `seed-admin.ts` → operator + org + first Owner + memberships (replace `SEED_ADMIN_CLIENT_SLUG` single-tenant assumption).
- **Frontend:** 🎨 operator "New organization" form (name, slug, tier, owner email) + resend-invite; `(admin)/settings/page.tsx` org + active-brand settings (tier read-only for owners); repurpose `(admin)/clients/*` as brand management.
- **Acceptance:** operator creates Org B with Owner who accepts/logs in to a fully isolated, empty, self-controlled org; owner/org_admin create/edit brands in their org only (slug global-unique); tier/billing operator-only; non-operators 403 on provisioning; seed-admin yields a clean operator + demo org + Owner.
- **Depends on:** S7, S8 · **Risks:** Owner invite is the only bootstrap (resend + expiry); provisioning is powerful (`requireOperator` + audited); keep org-slug vs brand-slug distinct.

### Phase 3 — Cost control, lifecycle, routing, cleanup

#### S10 · Per-org usage metering + jobs org-attribution + per-tenant dedup + queue fairness + per-brand email
- **Goal:** close the cost-exposure gap (billing deferred, cost must be visible) and make the global queue tenant-safe.
- **Schema:** NEW `usage_events` (org_id, brand_id?, kind ai_tokens|campaign_created|candidate_created|chat_message|email_sent, provider/model?, input/output tokens?, campaign_id/candidate_id?, quantity, created_at; indexes on `(org_id, created_at)`/`(org_id, kind)`). Jobs dedup → **partial unique `(org_id, deduplication_id)`** (or org-namespace in code); `jobs.org_id` set on every enqueue. Optional `brands.reply_to_email`/`from_name`.
- **Backend:** instrument the **three** LLM surfaces with org-attributed token usage read from the SDK result — scoring (`ai-scoring.ts` via `ai/index.ts`/`providers.ts`), chat (`/api/chat/[conversationId]` — streamText + classifyTopicCoverage + detectWithdrawal), job-spec parsing — recorded async/best-effort. Meter campaign/candidate creation. Queue: `EnqueueOptions`/`JobPayload` gain `orgId`; `DbQueue`+`ServiceBusQueue` set `jobs.org_id` + namespace dedup; **all** enqueue sites pass `orgId`.
- **↳ Review correction (blocker — uncovered writer):** the `jobs/process/route.ts` **raw-SQL backstop** (`INSERT INTO jobs … SELECT … FROM candidates`, ~lines 41-79) bypasses `DbQueue.enqueue`. Rewrite it to populate `org_id` from `candidates.org_id`, and **reconcile `jobs.org_id` nullability**: candidate-derived jobs get a non-null `org_id`; genuinely-global jobs handled explicitly. List this writer by name in the S13 trigger-drop gate.
- **↳ Review correction (major — fairness risk):** treat **queue fairness as its own design note with pseudocode** preserving the atomic `FOR UPDATE SKIP LOCKED` claim + reclaim pass. Fairness is *not* isolation-critical — **may be deferred** so the V1 line doesn't depend on rewriting the claim loop. (Metering + dedup + `org_id` are the safely-additive parts.)
- **Backend (email):** `src/lib/email.ts` derive from/reply-to from the candidate's brand (via S1 denorm), safe default for unverified brands.
- **Frontend:** 🎨 operator per-org usage summary; optional Owner read-only usage page.
- **Acceptance:** every LLM call records an org-attributed `usage_events` row with SDK token counts; every job row has `org_id` (incl. backstop rows); two orgs' identical dedup keys don't collide; (if fairness shipped) a 1000-job tenant doesn't block another; per-brand from/reply-to used.
- **Depends on:** S5 · **Risks:** missing any of the 3 chat calls under-counts cost (use SDK counts, not estimates); fairness must not break reclaim semantics; normalise provider token reporting.

#### S11 · 🎨 Tenant lifecycle: suspend / soft-delete + complete org-scoped POPIA purge & cascade
- **Goal:** org lifecycle controls + tenant-complete deletion (today `purgeCandidateData` omits `conversations`/`chat_messages`/`chat_tokens`; `run-purge` is global).
- **Backend:** enforce `org.status` in the seam (login rejects suspended[403]/deleted[401]; operators retain console; public careers refuse suspended/deleted). Operator routes: `suspend|restore|soft-delete|purge` (`requireOperator` + audit + confirmation). `popia.ts`: **extend `purgeCandidateData`** to also delete `conversations`+`chat_messages`+`chat_tokens`; make access/deletion/expiry org-scoped; add `purgeOrganizationData(orgId)` cascading **all** org tables in FK-safe order + deleting blobs under `cvs/{orgId}/**`, `logos/{orgId}/**`.
- **↳ Review correction (non-shippable as written — job resurrection):** "cancel jobs for a suspended/purged org" is insufficient alone. Also gate the **`jobs/process` backstop SELECT** and **worker re-enqueue paths** (nudge/expire) and `handleJob` entry on `org.status`, else work regenerates for a dead tenant. Add these files to S11's key-file list.
- **Frontend:** 🎨 operator lifecycle actions + confirmation + status badges; suspended-org messaging on login + public pages; tenant POPIA tools in settings (org-scoped).
- **Acceptance:** suspend blocks the org's users + freezes its careers pages without affecting others; restore re-enables; soft-delete reversible until hard purge; `purgeCandidateData` now removes chat PII; `purgeOrganizationData` leaves **zero** org rows + no `cvs/{orgId}/**` blobs; tenant POPIA touches only the caller's org; cross-org purge operator-only + audited; **jobs for a purged/suspended org do not regenerate**.
- **Depends on:** S6, S7, S10 · **Risks:** cross-check the chat-feature design (`MEMORY: project_chat_feature.md`) when adding chat tables to purge; hard purge is destructive (operator-only, audited, confirmation-gated); cascade order must respect FKs.

#### S12 · Dedicated app host vs public careers subdomain routing
- **Goal:** cleanly separate the authenticated app host (admin + operator) from public per-brand careers subdomains.
- **Backend:** rework `middleware.ts` — explicit **app host** serving `(admin)`+`(operator)` with auth required; all other subdomains = public careers → `/c/{brandSlug}`; reserve `app`/`www`; host-aware `/api` early return; keep the shared verifier (S2) + local-dev fallback. Careers resolution carries `org_id` for downstream inserts. **Per AGENTS.md, read `node_modules/next/dist/docs` for Next.js 16 middleware/proxy conventions first.**
- **Frontend:** public careers unchanged visually (logos via S6 signed/public path); app-host login distinct from careers.
- **Acceptance:** app + operator console reachable only on the app host; a brand careers subdomain serves only that brand's active campaigns and cannot surface another org's; reserved hosts never resolve to a brand; apply/events on a careers host insert correct `org_id`/brand; localhost still works.
- **Depends on:** S9 · **Risks:** DNS/wildcard cert is infra (coordinate); keep brand→org resolution cheap/cached at the edge; coordinate `APP_DOMAIN` (demo links).

#### S13 · Schema cleanup: drop legacy single-tenant columns + remove triggers + finalise uniqueness
- **Goal:** remove transitional crutches once all readers/writers use the new model.
- **Schema/Backend:** DROP `users.client_id` + `security_group` (authz fully via `org_role` + memberships). DROP the S1 `BEFORE INSERT` triggers — **gated on verified writer coverage including the `jobs/process` raw-SQL backstop (review correction)**. Finalise `SessionPayload`. Confirm the only uniqueness rules are: `organizations.slug` unique, `clients.slug` global unique, `users (org_id, email)` + operator-email partial unique, `jobs (org_id, deduplication_id)`. Grep-and-remove dead `client_id`/`security_group` reads; update seeds.
- **Acceptance:** app builds + all flows pass with the columns removed; grep finds no references; dropping triggers causes no insert failures (apply/campaign/candidate/chat/**backstop** verified to set `org_id`); final constraints match decisions.
- **Depends on:** S5, S8, S10 · **Risks:** dropping triggers before *every* writer (incl. raw SQL) sets `org_id` → NOT NULL violations (gate on coverage); removing `client_id` touches public apply (re-verify).

#### S14 · 🎨 Seed/demo-data rework + terminology cleanup
- **Goal:** a clean re-runnable multi-tenant demo + finish terminology (organization=tenant, brand=division).
- **Backend:** rewrite `seed.ts` → 2 orgs, 2–3 brands each (distinct global slugs/branding), Owner + Org-Admin + per-brand Recruiter/Viewer, brand-scoped campaigns/candidates/conversations/scoring_logs/events with correct denorm `org_id`, seeded `usage_events`; share a user email across orgs; **use production insert paths** (no trigger reliance). Idempotent.
- **Frontend:** 🎨 rename lingering "Clients" → "Brands" (sidebar, clients pages, wizard picker); fix copy implying client==tenant.
- **Acceptance:** fresh DB + seed → operator + 2 isolated orgs with assorted roles; all leaf rows have `org_id` (0 mismatches); demo logins (operator+impersonate, Org A Owner/Recruiter limited to brand, Org B Owner) show Org A Owner sees zero Org B data; same brand slug can't exist in both orgs but same email can.
- **Depends on:** S8, S9, S10 · **Risks:** grant exactly the right memberships (lockout/over-grant); seed must mirror production writers.

### Phase 4 — Identity provider swap (deferred last)

#### S15 · Clerk authentication migration (identity swap behind the seam)
- **Goal:** replace bcrypt-JWT staff auth with Clerk for **identity/SSO only**; our org/brand/membership/role model stays authoritative.
- **Schema:** `users` ADD `clerk_user_id` (unique, nullable during cutover); after cutover drop staff `password_hash` + `password_reset_tokens` (keep candidate `chat_tokens`).
- **Backend:** implement `getSession`/`requireTenant` internals on Clerk's session (map Clerk user → our `users` row by `clerk_user_id` → org/memberships/roles). **Route/page call sites do not change.** Replace login/logout/invite-accept/password-reset with Clerk equivalents; retire the custom JWT; impersonation (our `actingOrgId`) layers on Clerk identity. Backfill/link existing users; brief dual-path before removing bcrypt. Consult `node_modules/next/dist/docs` + Clerk docs for Next.js 16 middleware.
- **Acceptance:** staff auth via Clerk and `requireTenant` resolves the same context; **no handler/page outside the seam + auth endpoints + middleware changed** (proves the seam held); existing users linked without lockout; candidate magic-link chat untouched.
- **Depends on:** S2, S8, S9 · **Risks:** do **not** use Clerk orgs for authz (keep ours); cutover without lockout (fallback window); test edge middleware × Clerk × careers-subdomain (S12) interaction.

---

## 7. Phasing & sequencing

```
S1 (schema + org_id denorm)
 └─ S2 (session/requireTenant seam, operator-aware; layout chokepoint; login rule)
      └─ S3 (guard lib: orgScope/assertOwnership/RBAC)
           └─ S4 (READ isolation: all admin GETs + 4 server pages + POPIA-by-email)
                └─ S5 (WRITE isolation + RBAC; stamp org_id on public writes)
                     ├─ S6  (private blobs + ownership SAS + cv_url backfill)  ┐
                     ├─ S16 (minimal LLM rate-cap)                            ├ Phase 1 ends → BREACH CLOSED
                     ├─ S7  (operator console + audited act-as)               ┘  (needs S4+S5)
                     │    └─ S9 (operator org provisioning + settings) (needs S7+S8)
                     ├─ S8  (role-aware shell + brand switcher + invites + brand-derived campaigns) (needs S5+S7)
                     │    └─ S9, S13, S14, S15
                     └─ S10 (usage metering + jobs org/dedup [+fairness opt] + per-brand email)
                          └─ S11 (lifecycle suspend/delete + complete POPIA cascade) (needs S6+S7+S10)
 S9  ─→ S12 (app host vs careers subdomain routing)
{S5,S8,S10} ─→ S13 (drop legacy columns + triggers + finalise uniqueness)
{S8,S9,S10} ─→ S14 (multi-org seed + terminology)
{S2,S8,S9}  ─→ S15 (Clerk swap behind the seam)
```

| Phase | Slices | Outcome |
|-------|--------|---------|
| **0 — Foundation** (lockout-safe, no behaviour change) | S1, S2, S3 | Schema + operator-aware seam + guards land before any scoping. |
| **1 — Close the breach** (V1 core) | S4, S5, S6, **S16** | Read + write isolation + RBAC + private blobs + LLM cap. A second tenant can log in with zero cross-tenant exposure. |
| **2 — Operate + onboard** | S7, S8, S9 | Operator console + impersonation, self-service shell + invites, org provisioning. |
| **3 — Cost / lifecycle / routing / cleanup** | S10, S11, S12, S13, S14 | Metering + queue safety, lifecycle + complete POPIA, host split, schema cleanup, multi-org seed. |
| **4 — Identity swap** (last) | S15 | Clerk behind the unchanged seam. |

**Operator-lockout guarantee:** S2 (org+operator session) and S3 (operator deny-without-acting + act-as semantics) land **before** S4/S5 enforce predicates, so staff never lose cross-tenant access; the operator console UI (S7) follows because the act-as *auth* already exists in the seam.

---

## 8. V1 cut line — safe to admit the first external corporate

**Mandatory (non-negotiable):**
- **S1–S5** — tenant schema + denorm, operator-aware seam *before* scoping, guard library, **complete** read isolation, **complete** write isolation + two-tier RBAC.
- **S6** — private blob container + ownership-checked SAS **including the `cv_url` backfill** (CVs are PII; container is currently public).
- **S16** — minimal per-org/per-conversation **LLM rate-cap** (metering alone is visibility, not a cap).
- **Layout-level `requireTenant()`/`requireOperator()` chokepoint** (from S2) — guard-by-default, not grep-by-default.
- **Login disambiguation rule** decided in S2 (per-org email uniqueness makes email-only login ambiguous).
- **To actually admit + onboard one tenant:** the act-as *auth* (S2/S3) + a minimal **S7** (operator view/act-as) + **S9 provisioning** + the **S8 invite portion + thin brand switcher**; and from **S11** the **org-scoped POPIA cascade + suspend/login-block** (the current global purge is a live destructive breach and the chat-PII purge gap must close).
- **Strongly recommended at the same line:** the **metering + per-tenant dedup** half of **S10** (real PII + AI spend flow at launch).

**Explicitly deferred past first external access** (don't affect isolation/RBAC/blob privacy): full operator console polish (S7/S9 niceties); org **hard-delete** cascade (needed before *offboarding*, not onboarding); **S10 queue fairness** (rewrite of the atomic claim loop — defer unless needed); **S12** host split (path-based routing + the existing rewrite suffice for a pilot on the app host); **S13** legacy cleanup (harmless once unused); **S14** full demo seed beyond the mandatory membership backfill; **S15** Clerk. Out of scope for V1: billing/checkout, per-brand custom domains, elaborate auth UI Clerk will replace.

**Rule of thumb:** anything that resolves/mutates by raw UUID without an ownership check, or operates globally (dashboard/analytics aggregates, POPIA access/deletion/purge, public blobs, uncapped LLM spend), is an immediate breach the instant a second org exists. Everything ergonomic can lag.

---

## 9. Adversarial review — findings & resolutions

The synthesised plan was reviewed by a skeptical engineer who verified the major claims against real files. Confirmed-real defects and how they're handled:

| Severity | Finding | Resolution (folded into) |
|----------|---------|--------------------------|
| **Blocker** | `(admin)/layout.tsx` never reads the session; auth is middleware-only (signature-only). Per-page guards + a grep are the only backstop. | **Layout-level `requireTenant()` chokepoint** added to S2/S4 + §5.2; V1-mandatory. |
| **Blocker** | `jobs/process/route.ts` inserts jobs via **raw SQL**, bypassing the queue abstraction → uncovered `org_id` writer; breaks the S13 trigger-drop gate. | Rewrite the backstop SELECT to populate `org_id`; reconcile `jobs.org_id` nullability; named in S10 + S13 gate (§5.8). |
| Major | Queue-fairness rewrite touches the atomic `FOR UPDATE SKIP LOCKED` claim loop — risky, presented as a bullet. | S10: fairness is its own design note + **deferrable** (not isolation-critical). |
| Major | Unconstrained `candidates.brand_id` denormalised copy used as a brand authz key → drift. | S1: drop it; brand scoping via the single campaign join, or a `CHECK`/trigger invariant (§5.4). |
| Major | Global brand slug + `check-slug` = cross-tenant **existence oracle + squatting** once self-service brand creation lands. | S8: operator approval or generic "unavailable" + per-org rate-limit/auth. |
| Major | S6 blob path rename leaves seeded `cv_url` dangling until S14. | S6: **`cv_url` backfill in-slice** + post-rename resolve check. |
| Major | No LLM **cap** at launch (only metering). | New **S16** pulled into V1. |
| Minor | Shared verifier could bundle node-only code into edge middleware. | S2: leaf module, jose+secret only (§5.10). |
| Minor | Login-by-email ambiguous under per-org uniqueness; deferred to S15. | Decided in **S2**, not S15. |
| Minor | Suspended/purged org work regenerates via the backstop + worker re-enqueue. | S11: gate backstop SELECT + re-enqueue + `handleJob` on `org.status`. |

---

## 10. Gap-coverage map (proves completeness)

| Gap / risk (from the audit) | Closed by |
|---|---|
| No tenant boundary above clients; clients hold tier/billing | S1 |
| No per-brand membership / two-tier roles | S1, S3, S5, S8 |
| Tenant-less operator + view/impersonate missing | S1, S2, S7 |
| Leaf tables have no `org_id` (multi-join scoping) | S1 |
| SessionPayload has no org/operator claims | S2 |
| `requireApiAuth` discards payload; enforcement zero | S2, S3, S4, S5 |
| No requireTenant/Brand seam; no Clerk boundary | S2, S3, S15 |
| Operator lockout if scoping precedes operator session | S2, S3, S7 |
| `campaigns` GET all clients; dashboard/analytics unfiltered | S4 |
| candidates/cv/chat-transcript/open-chat raw-UUID (cv mints SAS for any) | S4, S6 |
| clients/users GET expose cross-tenant directory | S4 |
| 4 direct-query server pages render PII with zero authz | S4 |
| campaigns POST arbitrary client_id; publish another tenant | S5 |
| candidates PATCH any candidate by UUID | S5 |
| users POST/PATCH arbitrary client_id+security_group (escalate) | S5 |
| users/[id]/password resets ANY user (takeover) | S5 |
| clients POST arbitrary id / no org binding; PATCH/logo any brand | S5, S6 |
| from-job-spec under any brand + uncosted LLM spend | S5, S10, S16 |
| security_group gates nothing | S3, S5, S13 |
| Public writes don't stamp org_id/brand | S5, S1 |
| Azure public blobs + wildcard CORS | S6 |
| Operator impersonation is a new concept | S2, S7 |
| No operator console (list/view/set-tier/provision) | S7, S9 |
| Operator routes could become the new leak | S3, S7 |
| Sidebar no role gating; no brand-scoped nav | S8 |
| Campaign create needs manual client_id | S8 |
| No member invite flow | S8 |
| No operator org provisioning | S9 |
| No self-service org/brand settings | S9, S14 |
| tier/billing must be operator-set manually | S1, S7, S9 |
| No per-org usage metering | S10 |
| Chat 3-LLM-call fanout unmetered / **uncapped** | S10, **S16** |
| jobs no tenant column; global dedup; starvation | S1, S10 |
| One global email FROM | S10 |
| popia run-purge global; access/deletion cross-tenant by email | S4, S5, S11 |
| purgeCandidateData omits chat PII | S11 |
| No tenant lifecycle (suspend/soft-delete/purge+cascade) | S1, S11 |
| Tenant-scoped uniqueness (email; slug vs subdomain) | S1, S12, S13 |
| No app-host vs careers-subdomain split | S12 |
| Candidate identity scoping across orgs | S1, S5, S11 |
| Legacy single-tenant columns + triggers | S13 |
| Single-tenant seed/terminology | S14 |
| Auth must migrate to Clerk without rewriting routes | S2, S3, S15 |
| Migrations must restructure + backfill + reset (pre-launch) | S1, S14 |

---

## 11. Frontend design standards

Per the standing preference, **every UI-bearing slice is built with the `frontend-design` skill** and stays consistent with the existing Tailwind v4 design system (`src/app/globals.css` tokens: `cobalt`/`accent`, `ink`, `surface`/`paper`, `border`, `instrument-serif`/`instrument-sans`/`jetbrains-mono`, the `warning`/`moss`/`vermillion` purposeful colours).

New surfaces (🎨 in §6) and their design intent:

- **Operator console (S7, S9)** — distinct from the tenant shell; an org directory (status/tier/usage), org detail, set-tier, and a deliberate **"Act as / Exit"** flow. Must *feel* like a control plane (dense, data-forward, unmistakably "internal/operator") so impersonation is never ambiguous. The persistent **"Acting as <Org> — Exit"** banner is a first-class, high-contrast component.
- **Role-aware tenant shell + brand switcher (S8)** — sidebar gated by role, a polished brand switcher (the org's brands + "All"), and an empty-state-rich Members page. Reuse existing `src/components/ui` patterns (`toast-provider`, `empty-state`, `confirm-modal`).
- **Member invite + accept (S8)** — invite modal (email + brand(s) + role) and a clean accept-invite/set-password page; minimal, since Clerk replaces it in S15 (don't over-build).
- **Org/brand settings (S9)** — org profile + per-brand careers branding; tier read-only for owners.
- **Usage views (S10)** — operator per-org usage summaries; optional owner read-only usage. Charts/figures should match the existing report aesthetic.
- **Lifecycle UI (S11)** — confirmation-gated suspend/delete/purge with status badges; suspended-org messaging on login + public pages.
- **Terminology pass (S14)** — "Clients" → "Brands" everywhere; copy distinguishes organization (tenant) from brand (division).

Implementation note: build UI **after** the slice's server-side guards exist, so the interface renders against already-isolated data (UI gating is cosmetic; the server is the source of truth).

---

## 12. Open questions / deferred decisions

1. **Login identity rule (decide in S2):** keep tenant email globally unique until Clerk, or add org/subdomain context on the app host? (Operators stay globally unique either way.)
2. **Brand-slug policy (S8/S12):** operator-approval gate vs. reserved-namespace vs. org-prefixed slugs + custom domains later — and how `check-slug` avoids the existence oracle.
3. **Queue fairness (S10):** ship the per-org cap now or defer? (Not isolation-critical; risky to the claim loop.)
4. **LLM rate-limit thresholds (S16):** starting per-org/per-conversation/per-IP limits and tier overrides.
5. **Tenant-side audit (review note):** should Owner actions (password reset, role grants) also write to an audit log, not just operator actions?
6. **Clerk org mapping (S15):** confirmed we keep our own org/brand model — verify nothing later assumes Clerk orgs.
7. **Custom domains for careers pages:** enterprise feature, deferred — affects the S12 routing model if pulled forward.
8. **Billing provider** (when payments arrive): Stripe vs. Vercel — out of scope now, but `usage_events` (S10) should capture what it will need.

---

*Generated from a research + design + adversarial-review workflow. Slice IDs are stable references for tracking; each slice is intended to be a PR-sized, independently-shippable unit that leaves the app fully working.*
