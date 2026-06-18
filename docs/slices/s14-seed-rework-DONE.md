# S14 · 🎨 Seed/demo-data rework + terminology cleanup

> ✅ **DELIVERED** (branch `s04-read-isolation`, on top of landed S13). Highlights:
> - `src/db/seed.ts` rewritten into a self-contained, deterministic **two-org** demo builder (Northwind Group ×2 brands, Summit Holdings ×3 brands) with the full user cast + memberships, campaigns → candidates → scoring_logs/messages/conversations/chat_messages, the production analytics **events funnel** (`page_view → form_start → field_interact → form_submit|form_abandon`), `jobs.org_id` + org-namespaced dedup, and awaited/back-dated `usage_events`. An in-script **integrity assertion** throws on any null/mismatched `org_id` (verified: *0 nulls, 0 mismatches*).
> - New pure, unit-tested membership-grant helper + cast: `src/db/seed-cast.ts` (`buildMembershipRows` enforces owners/org_admins → 0 memberships, brand users → exactly their grant). Tests: `src/db/seed-cast.test.ts`, terminology grep-guard `src/terminology.test.ts`.
> - Shared-email demo seeded as two rows (Decision E: one `is_active:true`, one `false`). `SEED_DEMO_PASSWORD` with a production guard. One sample CV per org.
> - Terminology pass: ~23 user-visible "Client(s)" → "Brand(s)" strings renamed (route segments + `client_id`/`clientSlug` code identifiers retained).
> - **PR notes:** no migration (this is the pre-launch *reset*, not a restructure); the seed deliberately omits `client_id`/`security_group` (dropped in S13); `clients.slug` stays GLOBALLY unique (load-bearing for S12 — negative test confirms `23505`); `seed-admin.ts` retained as the env-driven prod bootstrap (Decision A) and already cleaned by S13.

> **Phase 3 — Cost control, lifecycle, routing, cleanup**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** a clean re-runnable multi-tenant demo + finish terminology (organization=tenant, brand=division).
- **Backend:** rewrite `seed.ts` → 2 orgs, 2–3 brands each (distinct global slugs/branding), Owner + Org-Admin + per-brand Recruiter/Viewer, brand-scoped campaigns/candidates/conversations/scoring_logs/events with correct denorm `org_id`, seeded `usage_events`; share a user email across orgs; **use production insert paths** (no trigger reliance). Idempotent.
- **Frontend:** 🎨 rename lingering "Clients" → "Brands" (sidebar, clients pages, wizard picker); fix copy implying client==tenant.
- **Acceptance:** fresh DB + seed → operator + 2 isolated orgs with assorted roles; all leaf rows have `org_id` (0 mismatches); demo logins (operator+impersonate, Org A Owner/Recruiter limited to brand, Org B Owner) show Org A Owner sees zero Org B data; same brand slug can't exist in both orgs but same email can.
- **Depends on:** S8, S9, S10 · **Risks:** grant exactly the right memberships (lockout/over-grant); seed must mirror production writers.

---

# Implementation Spec: S14 · 🎨 Seed/demo-data rework + terminology cleanup

**Generated**: 2026-06-18
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `2d663b5` (**S11 and S12 have both landed** — the tree carries `organizations.status/suspended_at/deleted_at` (S11) and the app-host/careers-subdomain split (S12)). **S13 (`s13-schema-cleanup.md`) is in the process of being delivered** — it drops `users.client_id` + `users.security_group`, removes the S1 triggers, and **edits the same two seed files this slice rewrites** (`db/seed-admin.ts`) plus `(admin)/users/[id]/page.tsx`. That overlap is the principal coordination risk — see **Coordination with in-flight S13** below.
**Change type**: **UI/UX + Backend** — the bulk is a **backend `seed.ts` rewrite (no migration)**; the UI portion is a **user-facing terminology pass** ("Client(s)" → "Brand(s)"). Because there is user-visible work, this is classified **UI/UX**, so a **Frontend Changes** section is present and the **`frontend-design` skill is mandatory** for that work (project standard: *frontend-design is required for all UI work in this repo*).

> **Five findings that shape the slice — read first.**
> 1. **No migration. S14 is the "reset", not a "restructure".** The schema is already final for this slice: the `clients` table and every `client_id`/`clientSlug` **code identifier stay** — the rename is *user-facing copy only*. `usage_events.brand_id` was deliberately pre-named (`schema.ts:690-693`, *"Forward-looking name (S14 renames Clients→Brands); references clients.id"*) precisely so no column rename is needed now. The migration-plan gap table maps S14 to *"reset (pre-launch)"* (plan §8), i.e. **wipe + fresh re-seed**, not a Drizzle migration. **Do NOT generate a `0032`** (contrast S13, which owns `0031`).
> 2. **"Use production insert paths" cannot be literal HTTP calls — it means *mirror the writers' field population*.** `seed.ts` is a `tsx` script with no request context, cookie, or running server, so it cannot `POST` to the admin routes (they derive the org from `getApiTenant()` → a session cookie, `tenant.ts:48-65`). The mandate therefore reduces to: **stamp `org_id`/`brand_id` explicitly on every row exactly as the routes do** (`ctx.effectiveOrgId` / `campaign.org_id`), model roles via `org_role` + `memberships.brand_role` like the user/invite routes, hash passwords with `bcrypt(…, 12)`, and emit `usage_events` in the `recordUsageEvent` shape — **without leaning on the S1 triggers S13 removes**. Reuse *pure* shared helpers (`lib/auth` hashing/token, `lib/slug`, the `recordUsageEvent` value shape); **do not import AI/network paths** (e.g. `lib/chat.ts:createConversation` builds an AI greeting) — keep the existing deterministic local content generation.
> 3. **Today the seed creates ZERO login users, memberships, usage_events, or invitations, and is single-org.** `seed.ts` (`db:seed`) find-or-creates one `demo-org`, inserts 8 brands under it (`:656-674`), and demo leaf data — but **no users** (those live in `seed-admin.ts`), **no `usage_events`**, **no `memberships`**. `seed-admin.ts` (`db:seed:admin`) creates **one** Owner + **one** Operator from env vars and writes the legacy `client_id`/`security_group` columns S13 is removing (`seed-admin.ts:110,118,159,167`). So S14 is a genuine **rewrite**: it must add the full user cast, memberships, `usage_events`, and a *second* org.
> 4. **Two data-correctness drifts the rewrite must fix to genuinely "mirror production".** (a) Seeded `events` use `event_type` values `application_started`/`application_submitted` (`seed.ts:1179,1192`) that are **not** in the production `ALLOWED_EVENT_TYPES` set (`page_view, form_start, field_interact, form_submit, form_abandon` — `api/events/route.ts:6-12`). (b) Seeded `jobs` set **no `org_id`** (`seed.ts:1216-1289`) and a **non-namespaced** `deduplication_id`, whereas production stamps `jobs.org_id` and namespaces dedup (S10). Align both so the seeded queue/metering data is tenant-correct.
> 5. **A shared email across orgs is a *schema* capability the *app* deliberately does not support for login — now confirmed.** The acceptance wants "same email can [exist in both orgs]". The schema permits it (`users (org_id, email)` unique, NULL-distinct, `schema.ts:280`), but `api/auth/login/route.ts:27-34` resolves by email **globally without `.limit(1)` and returns 401 on any `matches.length !== 1`** among *active* users, and the invite path throws on a duplicate tenant email (`lib/invitations.ts:64-70`). So two *active* rows with the same email lock each other out of login. **Resolution (Decision E):** seed the shared email as two rows (different `org_id`) with **one `is_active: true` (loginable) and one `is_active: false`** — the constraint is demonstrated *and* every active demo user stays loginable. It is a schema-capability demonstration (forward-ready for host/org-disambiguated login under Clerk/S15), not a dual working login today.

---

## Codebase Analysis

S14 turns a single-org demo into a clean, re-runnable **two-org** demo whose every row is stamped through the same shape the production writers use, then finishes the "Clients → Brands" terminology already begun in S8. Four strands: **(a)** rewrite `seed.ts` to own the whole graph (orgs → brands → users+memberships → campaigns → candidates → scoring_logs/messages/conversations/chat_messages → events → jobs → `usage_events`); **(b)** reconcile `seed-admin.ts` (which S13 is also editing); **(c)** fix the two data drifts (Finding 4); **(d)** rename the ~23 lingering user-visible "Client" strings.

**The seed today (`src/db/seed.ts`, 1349 lines).** Deterministic LCG (`seed = 42`, `:43-71`) so a re-run reproduces identical data. It **truncates then rebuilds** (`:597-610` clears `chatMessages, conversations, chatTokens, events, jobs, scoringLogs, messages, candidates, campaigns, passwordResetTokens, users, clients`), find-or-creates `demo-org` (`:616-628`), uploads one shared sample CV via `uploadCV(orgId, …)` (`:636-652`), inserts 8 brands (`:656-674`), 2–4 campaigns/brand (`:699-720`), candidates (`:852-882`), scoring logs (`:920-975`), email messages (`:984-1044`), conversations + chat messages (`:1111-1140`), visitor events (`:1162-1204`), completed jobs (`:1216-1289`), and prints a summary (`:1298-1319`). Every leaf already carries an explicit `org_id` — good — but the **clear list omits** `memberships`, `usage_events`, `invitations`, and the seed creates **no users at all**.

**`seed-admin.ts` (188 lines).** Find-or-creates the org (`:65-76`), an *optional* brand (`:81-95`), an Owner (`:105-129`; sets `client_id` `:110` + `security_group:"admin"` `:118`), an *optional* `brand_admin` membership (`:133-144`), and an Operator (`:154-178`; `client_id:null`, `org_id:null`, `is_operator:true`, `security_group:"admin"` `:167`, with a trigger-blaming assertion at `:170-174`). **S13 deletes the `client_id`/`security_group` keys here and rewrites that assertion message** — direct overlap.

**The role model (already built — S1/S8/S9).** `OrgRole = "owner" | "org_admin"` (`lib/auth.ts:12`); `BrandRole = "brand_admin" | "recruiter" | "viewer"` (`lib/rbac.ts:10`); `ROLE_RANK` owner 4 / org_admin 3 / brand_admin 2 / recruiter 1 / viewer 0 (`lib/rbac.ts:17-23`). **Owners and Org-Admins reach every brand via `org_role` and carry NO membership rows** (`seed-admin.ts:132` comment; plan §3 "Org Owner/Org-Admin implicitly see all org brands"). Brand-scoped users carry a `memberships` row and `org_role = null`. Operators carry `org_id = null`, no membership. `SessionPayload = {userId, orgId, orgRole, isOperator}` is already final (`lib/auth.ts:14-19`).

**Uniqueness the seed must respect (no change, S13 finalises).** `organizations.slug` unique (`:23,37`); **`clients.slug` GLOBAL unique** (`:54,81`) — so every seeded brand slug must be globally distinct across both orgs; `users (org_id, email)` unique + operator-email partial unique (`:280-283`) — so the same email may exist once per org; `memberships (user_id, client_id)` unique (`:103`); `campaigns (client_id, slug)` unique (`:144`); jobs dedup via the partial `jobs_dedup_idx` (`:663-668`).

**Tech stack.** Next.js 16.2.2 App Router; Drizzle over postgres-js; seeds run via `tsx` (`db:seed`, `db:seed:admin` — `package.json:15-16`); vitest with a DB-free unit project and a `DATABASE_URL`-gated **serial** integration project sharing **one two-org fixture** (`vitest.integration.config.ts`, `*.itest.ts`, `describe.skipIf`).

## Related Issues

- **S1 (done)** — introduced organizations/brands/memberships/operators and the `org_id` denorm the seed must populate.
- **S8 (done — dependency)** — added `memberships`, invitations, the two-tier role model, and **already renamed `sidebar.tsx` Clients → Brands**. S14 reuses these and finishes the *lingering* copy S8 didn't reach (wizard, clients pages, branding helper text).
- **S9 (done — dependency)** — operator org provisioning + the empty-org Owner bootstrap shape `seed-admin.ts` mirrors.
- **S10 (done — dependency)** — created `usage_events` + `recordUsageEvent` (`lib/usage.ts:43-59`) and the namespaced jobs dedup. S14 seeds metered data through this exact shape and adopts the dedup/`org_id` conventions (Finding 4).
- **S11 (LANDED)** — tenant lifecycle; `organizations.status` exists, so seeded orgs should set `status:"active"` explicitly (it defaults, but be explicit).
- **S12 (LANDED, `2d663b5`)** — app-host vs careers-subdomain routing; **depends on `clients.slug` staying GLOBALLY unique**. S14 reconfirms this by using globally-distinct brand slugs and a negative test — **do not weaken it**.
- **S13 (IN FLIGHT — the user's flagged coordination)** — schema cleanup. **Shares `db/seed-admin.ts` and `(admin)/users/[id]/page.tsx` with S14 and removes two columns the seed writes.** Dedicated section below.

### Coordination with in-flight S13 (per the delivery note)

S13 and S14 are the two Phase-3 cleanup slices and **touch overlapping files**. Five concrete points:

1. **Sequence S13 *before* S14's seed rewrite (recommended).** Once S13 has dropped `users.client_id` + `users.security_group`, the rewritten seed creates users with **only** `{org_id, org_role, is_operator, first_name, last_name, email, password_hash}` + `memberships` — never the legacy columns. This avoids writing code S13 would immediately delete *and* avoids the NOT-NULL problem in (2). Since S13 is mid-delivery, this is the natural order; **branch S14 from the tree that includes S13.**
2. **If they must proceed in parallel:** `security_group` is **NOT NULL until S13 drops it**, so a seed that omits it will fail on the current schema. In that case the seed must still set `security_group` (and may leave `client_id` null — nullable since S8), **and S13's grep-and-remove must be told to also clean the *new* `seed.ts`/`seed-admin.ts`**, not just today's versions. Flag this to S13's author so their `db/seed-admin.ts` edit doesn't silently miss the rewrite.
3. **`seed-admin.ts` ownership.** Decide whether S14 **absorbs** `seed-admin.ts` into a unified `seed.ts` (then S13's `seed-admin.ts` edits are moot / conflict) or **keeps it** as a slim operator+owner bootstrap. Recommend **unify** (see Decision A) and coordinate so S13 does not separately rework a file S14 is replacing; whoever lands second rebases.
4. **`(admin)/users/[id]/page.tsx` `infoItems` overlap.** S13 removes the "Security Group" row (`:197`) and reworks the brand display (`:198`, its Decision A); S14 wants that same row's label to read **"Brand"**. **Let S13 own that array** (it is already editing those exact lines) and set the label to "Brand" while it converts the value to the membership-derived brand name — *or* have S14's terminology pass touch `:198` only **after** S13 lands. **Do not both edit line 198 independently.**
5. **Don't reintroduce what S13 removes.** Whatever the order, the rewritten seed must not add *fresh* `client_id`/`security_group` writes once S13 has landed. S14 models brand association **via `memberships` only**, so it never needs `users.client_id` — which means S14 is happy for S13 to take its in-S13 `client_id` drop (S13 Decision A / Open Question 1).

> **Net:** the cleanest path is **S13 lands → rebase S14 → seed targets the post-drop user shape**. Put a one-line note in the S14 PR that the seed deliberately omits `client_id`/`security_group` (gone in S13) and that `clients.slug` stays global (load-bearing for S12).

### Assumptions from siblings (do **not** build/redo these in S14)

- **`memberships`, invitations, `org_role`, operator provisioning (S8/S9).** All exist. S14 *uses* them to seat the cast; it does not add schema.
- **`usage_events` + `recordUsageEvent` (S10).** Exist (`lib/usage.ts`). S14 seeds metered rows in this shape; it does not create the table or the writer.
- **Global brand-slug uniqueness (S1/S12/S13).** Already the live contract. S14 reconfirms via distinct slugs + a negative test; it does not change the constraint.
- **The legacy-column drop (S13).** S14 assumes the post-S13 user shape (no `client_id`/`security_group`); it does not perform the drop.

## Implementation Plan

### Database Changes

**None — S14 adds no migration (Finding 1).** The schema is final; `clients` stays `clients`. Two items are **data-correctness fixes inside the seed**, not DDL:

- **Stamp `jobs.org_id`** on every seeded job (from the candidate's `org_id`) and **namespace `deduplication_id`** the way S10's writers do — even though seeded jobs are all `status:"completed"` (so the partial unique index never bites), this is what "mirror production writers (no trigger reliance)" means.
- **Re-vocabularise seeded `events`** to the production tracker vocabulary and emit a **realistic funnel** the analytics route actually reads (confirmed: `analytics/route.ts:60-151` keys off `page_view`, `form_start`, `form_submit`, and `form_abandon` with `metadata.last_field`). Generate `page_view → form_start → field_interact → (form_submit | form_abandon{last_field})` per session, mirroring the client tracker (`ApplicationForm.tsx`, `HtmlTemplateRenderer.tsx`). The current `application_started`/`application_submitted` values are dead to the funnel — replacing them makes the seeded analytics populate instead of showing zeroes.

If, while rebasing, the schema is found to have drifted, regenerate via the journal-safe `npm run db:generate` flow — but **none is expected**.

### API / Backend Changes — the seed rewrite (the meat)

**1. Seed architecture (Decision A — resolved: `seed.ts` self-contained, `seed-admin.ts` retained).** Rewrite `seed.ts` into a **self-contained idempotent multi-org demo builder** that owns the whole graph **including its own operator** (so the demo needs no second script). **Keep `seed-admin.ts`** as the env-driven **production bootstrap** — its contract is fixed by the S9 acceptance (*"seed-admin yields a clean operator + demo org + Owner"*), so it must keep working; S13 still cleans its legacy `client_id`/`security_group` writes. The two are **environment-exclusive**: `db:seed` (rich demo, truncates) for local/demo; `db:seed:admin` (clean empty org) for a real deployment — never both against the same DB. This removes the fragile "must run `seed` before `seed:admin`" ordering that the old split imposed.

**2. The cast (concrete).** Reuse the existing `CLIENTS` branding blocks (`seed.ts:91-164`), re-slugged and split across two orgs so slugs stay globally distinct:

- **Org A** — `slug: "northwind-group"`, name "Northwind Group". **Brands (2):** `northwind-bank`, `northwind-insure`.
- **Org B** — `slug: "summit-holdings"`, name "Summit Holdings". **Brands (3):** `summit-retail`, `summit-logistics`, `summit-air`.

**Users** (all non-operator users share one `bcrypt(…,12)` demo password from a new `SEED_DEMO_PASSWORD`, guarded to non-production):

| User | Org | `org_role` | Memberships | Purpose |
|---|---|---|---|---|
| `owner@northwind.example` | A | `owner` | **none** | acceptance demo login (Org A Owner) |
| `admin@northwind.example` | A | `org_admin` | **none** | org-wide admin (no brand membership) |
| `recruiter@northwind.example` | A | `null` | `{northwind-bank, recruiter}` | acceptance demo login (recruiter limited to one brand) |
| `viewer@northwind.example` | A | `null` | `{northwind-insure, viewer}` | brand-scoped viewer |
| `owner@summit.example` | B | `owner` | **none** | acceptance demo login (Org B Owner) |
| `recruiter@summit.example` | B | `null` | `{summit-retail, recruiter}` | brand-scoped recruiter |
| `shared@demo.example` | A | `null` | `{northwind-bank, recruiter}` | **shared-email** demo (row 1, `is_active: true` — loginable) |
| `shared@demo.example` | B | `null` | `{summit-logistics, viewer}` | **shared-email** demo (row 2, different `org_id`, **`is_active: false`** — see Decision E) |
| `operator@talentstream.example` | — | `null` | **none** (`org_id:null, is_operator:true`) | acceptance demo login (operator + impersonate) |

This satisfies every required demo login (operator, Org A Owner, Org A brand-limited Recruiter, Org B Owner) and the "same email across orgs" capability, while the **membership-grant rules** avoid both failure modes the slice warns about: **owners/org_admins get NO membership** (org_role grants all-brand reach); **brand-scoped users get exactly their one membership and `org_role = null`** (under-grant ⇒ lockout; over-grant ⇒ a brand user with org-wide reach).

**3. Mirror each production writer (the org-stamping table).** For each table, populate `org_id`/`brand` the way its runtime writer does:

| Table | Production writer (org_id source) | Seed sets |
|---|---|---|
| `clients` (brands) | `api/admin/clients/route.ts:110-136` (`ctx.effectiveOrgId!`) | `org_id` = the org; globally-unique `slug`; branding |
| `users` | `api/admin/users/route.ts:152-176` / `auth/invite/accept:101-114` | `org_id`, `org_role`, `is_operator`, `password_hash` bcrypt(12); **no `client_id`/`security_group`** (post-S13) |
| `memberships` | `users/route.ts:180-186` (upsert on `(user_id, client_id)`) | `user_id, client_id, brand_role` — brand-scoped users only |
| `campaigns` | `api/admin/campaigns/route.ts:121-150` | `org_id = ctx.effectiveOrgId`, `client_id = brand.id`; per-brand-unique slug |
| `candidates` | `api/apply/[clientSlug]/[campaignSlug]/route.ts:140-155` | `org_id = campaign.org_id`; `popia_consent_at` / `data_purge_at` (+12mo) |
| `scoring_logs` | `lib/ai-scoring.ts:206-224` | `org_id = candidate.org_id` |
| `messages` | `lib/email.ts:176` path | `org_id` = candidate's org |
| `conversations` | `lib/chat.ts:33-41` (`createConversation(orgId,…)`) | `org_id` (do **not** import the helper — it builds an AI greeting; keep local scripts) |
| `chat_messages` | `api/chat/[conversationId]/route.ts:106-111` | `org_id = conv.org_id` |
| `events` | `api/events/route.ts:75-87` | `org_id = campaign.org_id`; **production `event_type` vocabulary** |
| `jobs` | `DbQueue.enqueue` / `jobs/process` backstop | **`org_id` (NEW)** + namespaced `deduplication_id` |
| `usage_events` | `lib/usage.ts:recordUsageEvent` | `org_id, brand_id, kind, provider/model/tokens, campaign_id, candidate_id, quantity` |

**4. Seed `usage_events` so the metering dashboard shows realistic data.** Emit rows matching the production call sites, **awaited + batched** (not the fire-and-forget `recordUsageEvent`, whose un-awaited insert could be dropped when the script closes the connection). Back-date `created_at` to the parent row's timestamp for a believable time series on `usage_events_org_created_idx`:

- `campaign_created` — one per campaign (`brand_id`, `campaign_id`).
- `candidate_created` — one per candidate (`brand_id`, `campaign_id`, `candidate_id`).
- `ai_tokens` — one per `scoring_log` (`provider`/`model` from the log; randomised realistic `input_tokens` ≈ 1 500–6 000, `output_tokens` ≈ 200–900; `campaign_id`, `candidate_id`).
- `chat_message` — one per seeded user-role chat message (`candidate_id`).
- `email_sent` — one per outbound `messages` row (`brand_id`, `campaign_id`, `candidate_id`).

**5. Idempotency / re-runnability.** Keep the **deterministic full-rebuild** pattern (the LCG makes a re-run reproduce identical data), **extending the clear list** (`seed.ts:597-610`) with `usageEvents`, `memberships`, and `invitations` (they also cascade from `users`/`clients`, but clear them explicitly for legibility). Find-or-create the **durable top-level rows** by natural key — organizations by `slug`, the operator by `email` — so a re-run doesn't churn UUIDs a demo bookmark might reference. In a dedicated demo DB the existing global truncate is fine; **do not** point this at the shared integration DB (see Test Plan). *Alternative:* full find-or-create on natural keys for every row (preserves manual edits, more code) — note but don't default to it.

**6. Credentials + storage.** Add `SEED_DEMO_PASSWORD` (hashed once, applied to all demo users) with a `requirePassword`-style guard that refuses a weak/default value under `NODE_ENV=production` (mirror `seed-admin.ts:25-32`). Upload **one sample CV per org** via `uploadCV(orgId,…)` so the org-scoped blob paths (`cvs/{orgId}/{brandSlug}/{candidateId}`) resolve per-tenant; keep the storage-not-configured → `cv_url = null` branch (`seed.ts:636-652`).

**7. End-of-seed verification assertion.** Before `client.end()`, assert the headline acceptance in-script and **throw on failure**: (a) `0` leaf rows with `org_id IS NULL` across `clients, campaigns, candidates, scoring_logs, messages, conversations, chat_messages, chat_tokens, events, usage_events`; (b) each leaf's `org_id` equals its parent's (`candidates.org_id = campaign.org_id`, `scoring_logs.org_id = candidate.org_id`, `events.org_id = campaign.org_id`, `chat_messages.org_id = conversation.org_id`, etc.). This makes "0 mismatches" a build-time guarantee, not a manual check.

### Frontend Changes — terminology pass ("Client(s)" → "Brand(s)")

> **The `frontend-design` skill is REQUIRED for this work** (project standard: frontend-design for all UI in this repo; the slice is marked 🎨). Its role here is to keep the renamed labels, filter controls, empty-state/placeholder copy, and the "organization ≠ brand" wording **consistent with the existing design system** — not to redesign. Invoke it before editing the components below.

**Scope = visible strings only.** The `/clients` and `/c/[clientSlug]` **route segments**, the `clients` table, and `client_id`/`clientSlug`/`Client` **code identifiers stay** (Finding 1). The sidebar was already renamed in S8 — **verify it reads "Brands"** and that no nav string lingers. The ~23 user-visible strings to rename → **Brand(s)**:

| File | Line(s) | String | Type |
|---|---|---|---|
| `(admin)/clients/[id]/page.tsx` | 62, 118 | "Client not found" | error |
| `(admin)/clients/[id]/page.tsx` | 140 | "Clients" | breadcrumb |
| `(admin)/clients/[id]/page.tsx` | 222 | "Edit Client" | modal heading |
| `(admin)/clients/new/page.tsx` | 275 | "Internal notes about this client…" | placeholder |
| `(admin)/clients/new/page.tsx` | 288 | "…best fits this client's needs." | helper (client==tenant conflation) |
| `(admin)/campaigns/page.tsx` | 257 | "Search role, client, location…" | placeholder |
| `(admin)/campaigns/page.tsx` | 286, 293 | "Client filter" / "All clients" | filter label + option |
| `(admin)/campaigns/page.tsx` | 340 | "Client" | table column header |
| `(admin)/users/[id]/page.tsx` | 198 | "Client" info-item label | label — **overlaps S13 (§Coordination pt 4)** |
| `components/admin/branding-section.tsx` | 29, 35, 210 | "the client's…" helper/desc copy | helper (conflation) |
| `components/admin/campaign-wizard.tsx` | 260, 265 | "Select a client" / "…taken for this client" | validation |
| `components/admin/campaign-wizard.tsx` | 603, 612, 619 | "Client" label / "Select a client…" / "Client can't change…" | form |
| `components/admin/campaign-wizard.tsx` | 1165 | "Client:" review-summary label | label |
| `components/admin/live-campaign-preview.tsx` | 59 | fallback display name `"Client"` | label |

**Copy implying client == tenant** (rewrite to distinguish *organization* = tenant from *brand* = division): `clients/new/page.tsx:288`, `branding-section.tsx:29,35,210`. Phrase brand-scoped copy as "this brand" and reserve "organisation/account" for tenant-level wording.

### Edge Cases and Boundary Conditions

- **0 org_id mismatches (the headline).** Enforced by the in-script assertion (Backend step 7); also covered by the integration test.
- **Shared email across orgs (Finding 5 / Decision E — confirmed).** The two `shared@demo.example` rows MUST have **different `org_id`**, be non-operator, and — because `login/route.ts:27-34` 401s on >1 active match — exactly **one is `is_active: true`** (loginable) and one `is_active: false`. This demonstrates the `(org_id, email)` constraint without locking the active user out. The row is **not** among the required demo logins. (The invite path cannot create the second row — `invitations.ts:64-70` throws on a duplicate tenant email — so it must be a direct seed insert.)
- **Operator ends with `org_id = null` (no trigger now).** Set `org_id: null, is_operator: true` explicitly; drop any "trigger guard" wording from the assertion (S13 reworded the old one).
- **Brand-slug global uniqueness (S12 contract).** Every brand slug is globally distinct across both orgs. Negative test: inserting a brand whose slug already exists under the *other* org must raise `23505`.
- **`jobs.org_id` + dedup namespacing.** Stamp `org_id` and namespace `deduplication_id`; candidate ids are UUIDs so completed-job dedup never collides, but parity matters (Finding 4).
- **`event_type` vocabulary (Finding 4 / Decision G — confirmed).** The funnel reads `page_view`/`form_start`/`form_submit`/`form_abandon(metadata.last_field)` (`analytics/route.ts:60-151`); the seed's current `application_*` values render an all-zero funnel. Emit the production funnel shape so the seeded analytics are non-trivial.
- **Storage not configured.** Keep the `cv_url = null` branch; the per-org sample upload must not throw when `isStorageConfigured()` is false.
- **Re-run safety.** The extended clear list must cover `memberships`/`usage_events`/`invitations`; the operator (find-or-created) survives or is recreated. A second `npm run db:seed` must yield byte-identical counts.
- **Seed truncation vs the shared `*.itest.ts` fixture.** The seed's **global truncate would wipe the two-org fixture** the serial integration suite shares — never run it against that DB (Test Plan).

### Test Plan

- **DB-free unit (`npm test`).** If the membership-grant logic is factored into a pure helper, unit-test that **owners/org_admins receive zero memberships** and brand users receive exactly one. Add a **grep guard** asserting none of the rename-target files still contain a user-visible "Client" string.
- **DB-backed integration — a *standalone* `seed-verify` (NOT in the shared serial suite).** Export the seed's `main()` (or a `seed(db)` function) so a test can run it against a **throwaway DB**, then assert:
  1. exactly **2 orgs** (`status:"active"`), brands **2 / 3** per org, globally-distinct slugs.
  2. **role wiring:** owners/org_admins have `org_role` and **0 memberships**; brand users have `org_role = null` and exactly their membership(s); operator has `org_id = null`, `is_operator`, 0 memberships.
  3. **0 leaf rows with null `org_id`**; every leaf `org_id` == parent `org_id`.
  4. **`usage_events`** present for **every** kind; counts line up (`campaign_created` == campaigns, `candidate_created` == candidates, `ai_tokens` == scoring_logs, `email_sent` == outbound messages).
  5. **shared email** exists as two rows with different `org_id`.
  6. **isolation:** with Org A's owner, `orgScope(candidates, ctx)` (`tenant.ts:217-221`) returns **zero Org B rows**.
  7. **negative:** inserting a brand with an existing slug under the other org raises `23505`.
  > Because the seed truncates globally, run this with its **own `DATABASE_URL`** (a separate config or a one-shot script), **not** inside the shared `*.itest.ts` fixture — otherwise it wipes the data the other integration tests depend on.
- **Regression.** Existing `*.itest.ts` use their own fixtures and are unaffected as long as the seed isn't auto-run. Confirm `npm run db:seed` (then `db:seed:admin` if the split is kept) completes and the summary shows the two-org counts.
- **Build/typecheck + manual UI.** `npm run build`; visually confirm via `frontend-design` that no "Client" copy remains and the org-vs-brand wording reads correctly.

### Suggested Implementation Order

> **Branch from a tree that includes S13** (Coordination pt 1). Keep `clients.slug` global (S12 contract).

1. **Rebase onto landed S13** (Decision D) so the seed targets the post-drop user shape; `seed.ts` self-contained, `seed-admin.ts` retained (Decision A).
2. **Rewrite `seed.ts`:** orgs → brands → users + memberships → campaigns → candidates → scoring_logs/messages/conversations/chat_messages → events → jobs → `usage_events`; deterministic; extend the clear list; add the end-of-seed verification assertion.
3. **Reconcile `seed-admin.ts`** — fold the operator into `seed.ts` (unify) or slim it to an operator+owner bootstrap; ensure **no `client_id`/`security_group`** (post-S13).
4. **Fix the two data drifts** — stamp `jobs.org_id` + namespace dedup; re-vocabularise `events` to `ALLOWED_EVENT_TYPES`.
5. **Add `SEED_DEMO_PASSWORD`** + production guard; per-org sample-CV upload.
6. **Frontend terminology rename** (invoke `frontend-design`) — the ~23 strings; coordinate `users/[id]/page.tsx:198` with S13.
7. **Tests + build** — `seed-verify` (standalone), grep guard, `npm run build`.
8. **PR notes** — no migration (reset, not restructure); seed omits `client_id`/`security_group` (S13); `clients.slug` stays global (S12); coordinate the shared `seed-admin.ts` / `users/[id]/page.tsx` edits with in-flight S13.

### Resolved Decisions (all open questions answered)

> Every question from the first draft has been resolved against the code; none remain open. The one residual *contingency* is the S13 landing order (Decision D), which has a documented fallback either way.

**Decision A — `seed.ts` self-contained; `seed-admin.ts` retained as the prod bootstrap.** `seed.ts` owns the whole demo graph including its own operator; `seed-admin.ts` stays the env-driven clean bootstrap its S9 acceptance fixes (*"clean operator + demo org + Owner"*). The two are **environment-exclusive** (`db:seed` truncates → demo/local only; `db:seed:admin` → real deployments), which removes the old fragile run-ordering. *(Refines the earlier "unify" lean — absorbing `seed-admin.ts` would break the S9 contract, so keep it.)*

**Decision B — model brand association via `memberships` only; never `users.client_id`.** Forward-compatible with S13's column drop and matches the production user/invite writers. S14 needs nothing from `users.client_id`, so S13 is free to drop it.

**Decision C — keep `clients.slug` global-unique (S12 contract).** Globally-distinct brand slugs across both orgs + a negative test; never per-org slugs.

**Decision D — land S13 first, then rebase S14 (best judgment).** Build the seed against the post-drop user shape so it writes neither `client_id` nor `security_group` — no throwaway code, no NOT-NULL trap. S13 is already in flight, so this is the natural order. *Fallback if forced to parallelise:* the seed retains `security_group` (NOT NULL until S13) and S13's grep-and-remove target is extended to cover the **rewritten** `seed.ts`/`seed-admin.ts` — flag this to S13's author so the cleanup doesn't miss the new files.

**Decision E — shared email = one active + one inactive row (confirmed).** `login/route.ts:27-34` 401s on any >1-active-match, so seed `shared@demo.example` twice (different `org_id`) with **one `is_active: true`, one `is_active: false`**. Demonstrates the `(org_id, email)` constraint without breaking login; it is a schema-capability demonstration, not a required demo login. Must be a direct seed insert (the invite path forbids the duplicate, `invitations.ts:64-70`).

**Decision F — one fixed `SEED_DEMO_PASSWORD` for all demo users (per the user).** A single env-var password, hashed once with `bcrypt(…,12)`, applied to every credentialed demo user (and the operator), behind a `requirePassword`-style guard that refuses a weak/missing value under `NODE_ENV=production` (mirror `seed-admin.ts:25-32`). No per-user credentials.

**Decision G — emit the production funnel vocabulary (confirmed).** `analytics/route.ts:60-151` reads `page_view`/`form_start`/`form_submit`/`form_abandon(metadata.last_field)`; the seed's `application_*` values produce an all-zero funnel. Generate the real funnel shape (`page_view → form_start → field_interact → form_submit | form_abandon{last_field}`) so seeded analytics are meaningful.
