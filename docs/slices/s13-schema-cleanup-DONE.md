# S13 · Schema cleanup: drop legacy single-tenant columns + remove triggers + finalise uniqueness

> **Phase 3 — Cost control, lifecycle, routing, cleanup**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** remove transitional crutches once all readers/writers use the new model.
- **Schema/Backend:** DROP `users.client_id` + `security_group` (authz fully via `org_role` + memberships). DROP the S1 `BEFORE INSERT` triggers — **gated on verified writer coverage including the `jobs/process` raw-SQL backstop (review correction)**. Finalise `SessionPayload`. Confirm the only uniqueness rules are: `organizations.slug` unique, `clients.slug` global unique, `users (org_id, email)` + operator-email partial unique, `jobs (org_id, deduplication_id)`. Grep-and-remove dead `client_id`/`security_group` reads; update seeds.
- **Acceptance:** app builds + all flows pass with the columns removed; grep finds no references; dropping triggers causes no insert failures (apply/campaign/candidate/chat/**backstop** verified to set `org_id`); final constraints match decisions.
- **Depends on:** S5, S8, S10 · **Risks:** dropping triggers before *every* writer (incl. raw SQL) sets `org_id` → NOT NULL violations (gate on coverage); removing `client_id` touches public apply (re-verify).

---

# Implementation Spec: S13 · Schema cleanup — drop legacy single-tenant columns + remove triggers + finalise uniqueness

**Generated**: 2026-06-18
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `a4af5a9` (**S11 has now landed** — `Add tenant lifecycle (suspend/soft-delete/purge) + org-scoped POPIA cascade (S11)`; `organizations.status/suspended_at/deleted_at` and the lifecycle/purge surfaces are in the tree). **S12 (`s12-host-routing.md`) is in the process of being delivered** — a `proxy.ts`/host-classifier rework that adds **no migration** and **touches none of S13's files**, but **depends on `clients.slug` staying GLOBALLY unique** (its org-less careers-subdomain rewrite). S13 *"finalise[s] uniqueness"*, so the two slices meet at exactly one point: S13 must **keep `clients.slug` global** — see **Coordination with in-flight S12** below.
**Change type**: **Backend-only** — a `0031` migration (drop 10 triggers + 6 functions + 2 columns), schema-model edits, and grep-and-remove of dead `client_id`/`security_group` reads. The only user-facing touch is the **deletion of two now-dead controls** (a read-only "Security Group" row + an inert edit field) on the user-detail page; that is pure dead-control removal with no layout/visual design, so the **`frontend-design` skill is *not* triggered** (mirroring S12's "no new UI" treatment). See **Frontend cleanup**.

> **Four findings that shape the slice — read first.**
> 1. **Writer coverage is verified at 100% — the trigger drop is safe.** Every one of the 10 trigger-covered tables (`campaigns`, `candidates`, `events`, `scoring_logs`, `messages`, `conversations`, `chat_tokens`, `chat_messages`, `clients`, `users`) has *explicit* `org_id` population in **every** production write path, including the **`jobs/process` raw-SQL backstop** the acceptance singles out (`api/jobs/process/route.ts:46-94` stamps `org_id` + an org-namespaced `deduplication_id` from `candidates.org_id`). Full matrix in **Writer-coverage matrix** below. The triggers are already pure no-ops (each is guarded by `IF NEW.org_id IS NULL`); dropping them removes dead weight, not live behaviour. **Gate satisfied — but re-run the matrix after rebasing onto current `main`** in case a new writer landed.
> 2. **`SessionPayload` is *already* finalised — this acceptance item is a verification, not a build.** `src/lib/auth.ts:14-19` is already `{ userId; orgId: string | null; orgRole: OrgRole | null; isOperator: boolean }` — it carries **no** `client_id`/`security_group`. "Finalise `SessionPayload`" therefore reduces to *confirming* no legacy field is reintroduced at the construction sites (login route + `token.ts`) and removing the now-stale "until S13" comments. Do **not** redesign the payload.
> 3. **`security_group` gates nothing; `users.client_id` still backs one UI feature.** The code already records that `security_group` is "NOT NULL until S13 and gates nothing" (`api/admin/users/route.ts:18`, `api/auth/invite/accept/route.ts:14`) — authz is fully `org_role` + `memberships.brand_role`. So `security_group` is a clean delete everywhere. **`users.client_id` is *not* yet inert**, though: the user-detail route still uses it for a legacy single-brand **display** (`api/admin/users/[id]/route.ts:85-92`) and a single-brand **"move"** (`:181-184`), behind a comment that says it is "kept … until S14" (`:85-86`). The membership-based replacement **already exists in the same file** (`:77-82` joins `memberships ⋈ clients`). **This is the one real decision in the slice** — see **Open Question 1** and **Decision A**.
> 4. **The `jobs` uniqueness wording in the slice predates S10's design — confirm, don't rebuild.** The acceptance lists `jobs (org_id, deduplication_id)` as a uniqueness rule, but S10 made dedup tenant-safe a *different* way: it **namespaces the value** (`namespaceDedup(orgId, dedupId)` → `"<org>:<key>"`, `lib/queue/db-queue.ts:17`, `service-bus-queue.ts:42`, and the raw backstop) and keys the **existing single-column partial** index `jobs_dedup_idx` on `(deduplication_id) WHERE deduplication_id IS NOT NULL AND status IN ('pending','processing')` (`schema.ts:663-668`) off that namespaced value. The per-tenant guarantee the slice asks for is met; the literal "`(org_id, deduplication_id)`" composite **does not exist and should not be added** (it would duplicate the guarantee and re-collide global jobs). Resolve the wording — see **Decision B**.

> **AGENTS.md mandate.** No Next.js request APIs change here, but the migration tooling has a sharp edge that this repo's own history demonstrates: **the `drizzle-orm/postgres-js` migrator runs only files registered in `drizzle/meta/_journal.json`.** `0026` (which carries the hand-written triggers being dropped) is registered there because it was **generated first, then hand-augmented**. Reproduce that exact flow for `0031` (Database Changes, step 0) — do **not** hand-create a stray `.sql`, or `npm run db:migrate` will silently skip it.

---

## Codebase Analysis

S13 removes the transitional single-tenant crutches now that the org/brand model is fully load-bearing. Four mechanical strands: (a) **drop the S1 triggers/functions** (verified no-ops), (b) **drop `users.client_id` + `users.security_group`** (plus their index/FK/relation), (c) **grep-and-remove** the handful of reads/writes of those columns and update seeds + integration fixtures, and (d) **confirm** the final uniqueness set. The substrate is already in place: `clients.org_id` is `.notNull()` (`schema.ts:49-53`), every writer stamps `org_id` (Finding 1), and `SessionPayload` is already org-based (Finding 2).

**The schema model (`src/db/schema.ts`).** The `users` table (`:249-287`) still carries `client_id` (`:258-260` — nullable since S8, FK→`clients.id` cascade) and `security_group` (`:270` — `text NOT NULL`), with a `users_client_id_idx` index (`:284`) and a Drizzle `usersRelations.client` one-relation that references `users.client_id` (`~:551`). The triggers + functions live in `drizzle/0026_tenant_schema.sql` (`:197-272`); the columns were born in `drizzle/0003_magenta_sersi.sql` (both `NOT NULL`) and `client_id` was loosened in `drizzle/0028_lonely_mandarin.sql:16`.

**The uniqueness set today (for the "finalise" acceptance).** Already exactly the decided rules: `organizations.slug` unique (inline `.unique()` `:23` + `organizations_slug_idx` `:37`); **`clients.slug` GLOBAL unique** (`:54` + `clients_slug_idx` `:80`); `users (org_id, email)` unique (`users_org_email_idx` `:280`) **plus** the operator-email partial unique (`users_operator_email_idx … WHERE is_operator` `:281-283`); and jobs dedup via `jobs_dedup_idx` (`:663-668`, Finding 4). The legitimate adjacent constraints — `memberships (user_id, client_id)` (`:103`), `campaigns (client_id, slug)` (`:144`), `invitations (org_id, email) WHERE accepted_at IS NULL` (`:348-350`) — are intended and stay. **S13's "confirm uniqueness" is mostly an assertion test, not new DDL.**

**The legacy reads/writes to remove (the grep target).** Concentrated in five files (full table in **API/Backend Changes**): the two user routes (`api/admin/users/route.ts`, `api/admin/users/[id]/route.ts`), the invite-accept route (`api/auth/invite/accept/route.ts`), the user-detail page (`(admin)/users/[id]/page.tsx`), and the admin seed (`db/seed-admin.ts`). **Do not touch `rbac.test.ts:62,80`** — those use the literal string `"security_group"` as a *fake unknown role* to assert fail-closed RBAC; unrelated to the column.

**Tech stack.** Next.js 16.2.2 App Router; Drizzle over postgres-js with **hand-augmentable SQL migrations** in `drizzle/` (config `drizzle.config.ts`, runner `tsx src/db/migrate.ts` via `npm run db:migrate`, generator `npm run db:generate`); seeds `db:seed` (`src/db/seed.ts`) + `db:seed:admin` (`src/db/seed-admin.ts`); vitest with a DB-free unit project (`vitest.config.ts`, `*.test.ts`) and a `DATABASE_URL`-gated serial integration project (`vitest.integration.config.ts`, `*.itest.ts`, `describe.skipIf`).

## Related Issues

- **S1 (done)** — created the BEFORE INSERT triggers (`0026_tenant_schema.sql:197-272`) S13 now drops. They were always documented as transitional (`0026:191-196`).
- **S5 (done — dependency)** — flipped writers to stamp `org_id` explicitly and set `clients.org_id` `.notNull()`. This is *why* the triggers are no-ops and *why* the drop is safe.
- **S8 (done — dependency)** — made `users.client_id` nullable (`0028:16`) for org-level members and added invitations. Means the column is already optional before removal.
- **S10 (done — dependency)** — populated `jobs.org_id` and introduced `namespaceDedup` tenant-safe dedup (Finding 4). Determines the final `jobs` uniqueness shape S13 confirms.
- **S11 (LANDED — `a4af5a9`)** — tenant lifecycle. Added `organizations.status/suspended_at/deleted_at` and the purge cascade. No interaction with S13's columns; its presence just means S13 branches from a tree where `org.status` already exists. (Note: S12's own spec, written earlier the same day, still calls S11 "in flight" — it has since landed.)
- **S12 (IN FLIGHT — the user's flagged coordination)** — dedicated app host vs careers-subdomain routing. **No migration, no shared files** with S13, but its org-less subdomain rewrite is *structurally* premised on `clients.slug` being globally unique. See the dedicated section below.
- **S14 (depends S8/S9/S10 — seed rework)** — reconfirms global brand-slug uniqueness and is the slice the user-page comment defers the `client_id` UI to ("kept … until S14", `users/[id]/route.ts:85-86`). **Open Question 1 / Decision A resolve whether the `client_id` UI rework happens in S13 or S14.**

### Coordination with in-flight S12 (per the delivery note)

S12 is being delivered concurrently. Three concrete, non-blocking coordination facts — **S13 and S12 can land in either order**:

1. **`clients.slug` MUST stay GLOBALLY unique — this is the live contract.** S13's "finalise uniqueness" must **not** weaken `clients.slug` to a per-org unique (e.g. `(org_id, slug)`). S12 maps `{brandSlug}.{appDomain}` 1:1 to a brand with no org disambiguator on the host; a per-org slug would silently break that rewrite. The current schema (`schema.ts:54,80`) is already correct — **the action is to *assert and preserve* it**, and to add a one-line note in the S13 PR that this is load-bearing for S12 (and S14, which reconfirms the same).
2. **No file overlap → no merge conflict.** S12 edits `src/proxy.ts`, a new `src/lib/host.ts`, `.env.example`, and `api/auth/logout/route.ts`. S13 edits `src/db/schema.ts`, the `0031` migration, the two `api/admin/users/*` routes, `api/auth/invite/accept/route.ts`, `(admin)/users/[id]/page.tsx`, `db/seed-admin.ts`, and `*.itest.ts` fixtures. Disjoint.
3. **No migration-number contention.** S12 adds **no** migration; S13 owns `0031` outright. Whichever lands second needs no renumber.

> **Net:** the only thing S13 owes S12 is *restraint* — finalise uniqueness without touching the brand-slug global constraint. Call it out explicitly in the S13 PR so a reviewer doesn't "tidy" `clients.slug` into a per-org rule while S12 is mid-flight.

### Assumptions from siblings (do **not** build/redo these in S13)

- **`org_id` stamping on all writers (S5/S10).** Already done and verified (Finding 1). S13 *relies* on it to drop the triggers; it does not re-add stamping.
- **Org-based `SessionPayload` (S2/S5).** Already the live shape (Finding 2). S13 confirms, does not redesign.
- **Tenant-safe dedup via value-namespacing (S10).** Already implemented (Finding 4). S13 confirms the index, does not add a composite.
- **Membership-based brand display (S8).** The `memberships ⋈ clients` view already exists in `users/[id]/route.ts:77-82`; S13 reuses it if it takes Decision A, rather than inventing a new query.

## Implementation Plan

### Database Changes

**Migration: `drizzle/0031_<name>.sql` (hand-augmented generate).**

**Step 0 — produce the file the journal-safe way (AGENTS.md).** After removing the two columns + index + relation from `schema.ts` (API/Backend step 1), run `npm run db:generate`. drizzle-kit will emit the `DROP INDEX` / `ALTER TABLE … DROP COLUMN` statements **and** register the new tag in `drizzle/meta/_journal.json` + write the snapshot. Then **hand-edit the generated `0031_*.sql`** to *prepend* the trigger + function drops (drizzle-kit does not track triggers/functions — exactly the asymmetry that made `0026` a hand-augmented file). Keep the `--> statement-breakpoint` marker after every statement, inline on `ALTER`/`DROP` lines, matching `0030_sad_boomer.sql`.

**Order matters:** triggers reference the functions, so drop **triggers first, then functions, then index/FK/columns.** Target SQL (verbatim names from `0026:197-272`, `:284`, FK `users_client_id_clients_id_fk` from `0026:167`):

```sql
-- (1) Drop the 10 transitional BEFORE INSERT triggers (S1).
DROP TRIGGER IF EXISTS trg_campaigns_org_id ON campaigns;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_candidates_org_id ON candidates;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_events_org_id ON events;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_scoring_logs_org_id ON scoring_logs;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_messages_org_id ON messages;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_conversations_org_id ON conversations;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_chat_tokens_org_id ON chat_tokens;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_chat_messages_org_id ON chat_messages;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_clients_org_id ON clients;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_users_org_id ON users;--> statement-breakpoint
-- (2) Drop the 6 trigger functions (now unreferenced).
DROP FUNCTION IF EXISTS set_org_id_from_client();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_campaign();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_candidate();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_conversation();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_default_org();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_client_user();--> statement-breakpoint
-- (3) Drop the legacy users columns (index + FK cascade-drop with the column,
--     but drizzle-kit emits these explicitly — keep them for parity).
DROP INDEX IF EXISTS users_client_id_idx;--> statement-breakpoint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_client_id_clients_id_fk;--> statement-breakpoint
ALTER TABLE users DROP COLUMN client_id;--> statement-breakpoint
ALTER TABLE users DROP COLUMN security_group;
```

- **No data migration needed:** `security_group` data is discardable (gates nothing); `users.client_id` was already backfilled into `memberships` by `0026:90-92`, so the single-brand association survives as a membership.
- **Uniqueness finalisation = assertions, not DDL.** The decided set already matches the schema (Codebase Analysis). Do **not** add a `jobs (org_id, deduplication_id)` composite (Decision B) and do **not** alter `clients.slug` (S12 contract). Cover the set with a schema-introspection integration test instead (Test Plan).
- **Reversibility note for the PR:** `DROP COLUMN` is destructive; there is no down-migration in this repo's forward-only convention. Confirm a DB snapshot/backup exists before applying to any shared environment.

### API / Backend Changes

**1. `src/db/schema.ts` — remove the model.** Delete `client_id` (`:258-260`), `security_group` (`:270`), the `users_client_id_idx` line (`:284`), and the `usersRelations.client` one-relation that references `users.client_id` (`~:551`). Leave `org_id`, `org_role`, `is_operator`, the two email unique indexes, and every *other* table's `client_id` (those are FKs to `clients`, not the legacy user column) untouched.

**2. Grep-and-remove the dead reads/writes.** Exact sites (all confirmed):

| File | Line(s) | What | Action |
|---|---|---|---|
| `api/admin/users/route.ts` | `18`, `20` | `// Legacy security_group …` comment + `const LEGACY_SECURITY_GROUP = "user"` | Delete |
| `api/admin/users/route.ts` | `50`, `173` | `client_id: users.client_id` in LIST select + POST-return select | Delete columns |
| `api/admin/users/route.ts` | `157`, `164` | POST insert `client_id: brand.id` / `security_group: LEGACY_SECURITY_GROUP` | Delete; brand association is via the membership the route already creates — **verify** a membership is written so a new user still gets brand access |
| `api/admin/users/[id]/route.ts` | `85-92` | `legacyClient` lookup via `users.client_id` | **Decision A** — replace with the membership view (`:77-82`) or defer to S14 |
| `api/admin/users/[id]/route.ts` | `100`, `101`, `239` | GET/PATCH responses returning `security_group` / `client_id` | Delete `security_group`; `client_id` per **Decision A** |
| `api/admin/users/[id]/route.ts` | `181-184` | PATCH single-brand "move" `updates.client_id = brand.id` | **Decision A** — re-express as a membership mutation, or defer to S14 |
| `api/auth/invite/accept/route.ts` | `14`, `16`, `105`, `112` | legacy comment + const + insert `client_id` / `security_group` | Delete; org/brand already come from `inv.org_id` + the membership/brand_role on the invite |
| `db/seed-admin.ts` | `110`, `118`, `159`, `167` | owner + operator inserts setting `client_id` / `security_group` | Delete those keys (org_id/org_role already set explicitly) |
| `db/seed-admin.ts` | operator-insert assertion (`~:170`) | error text *"the trigger guard did not fire"* | Reword/retain — the operator still must end with `org_id = null`, but the *reason* is the explicit `org_id: null`, not a trigger; update the message so it doesn't reference a dropped trigger |

- **`security_group` is unconditionally safe** to delete at every site (Finding 3) — no authz branch reads it.
- **`SessionPayload` (`lib/auth.ts:14-19`)** — confirm the login route and `token.ts` construct only `{ userId, orgId, orgRole, isOperator }`; remove any "until S13" comments. No type change expected (Finding 2).
- **Seeds:** `db/seed.ts` stamps `org_id` on `clients` (`:656-674`) and does not set the legacy user columns — **verify** it creates no users carrying them; if it does, strip those keys too. `db/seed-admin.ts` still needs the `brand` lookup only if it writes a membership for the owner — confirm and keep that membership path.

**3. Verify (do not move) `org.status` and `org_id` stamping.** S13 changes neither. After rebasing onto current `main` (which now includes landed S11), re-run the writer-coverage matrix once more (Finding 1) and S11's lifecycle/isolation `*.itest.ts` to prove the trigger drop changed no insert outcome.

### Frontend cleanup (dead-control removal — `frontend-design` NOT required)

> Pure deletion of two defunct controls; no new screens, layout, or visual design. Per the same reasoning S12 applied to its cross-surface wiring, the **`frontend-design` skill is not triggered**.

In `src/app/(admin)/users/[id]/page.tsx`: remove the `security_group: string` field from the `UserRecord` interface (`:12`); remove the read-only **"Security Group"** info-card row (`:197`); remove the inert **`securityGroup`** edit `<label>`/`<select>` (`:327-333`) and the form read + PATCH passthrough that the API already ignores (`:81`, `:99`). Handle the `client_id: string` interface field (`:13`) and the single-brand display per **Decision A** (switch to the membership-derived brand name the route already returns, or defer with S14). Nothing else on the page changes.

### Edge Cases and Boundary Conditions

- **Insert after trigger drop must still set `org_id` (the gate).** For each covered table, an insert that *omits* `org_id` must now fail with a NOT NULL violation rather than being silently rescued — that is the intended post-S13 contract. Verify every production path passes (Finding 1); add a negative test that an `org_id`-less insert into e.g. `candidates` raises (proves the safety net is truly gone and writers are truly covered).
- **Operator seed still ends with `org_id = null`.** The operator insert sets `org_id: null` + `is_operator: true` explicitly, so dropping `trg_users_org_id` (whose guard already skipped operators) changes nothing — but the seed's assertion message must stop blaming/crediting the trigger.
- **`clients` runtime creation does not regress.** The single-org default trigger (`set_org_id_default_org`) is dropped; confirm both runtime brand writers set `org_id` explicitly — `api/admin/clients/route.ts:114` (`org_id: ctx.effectiveOrgId!`) and `seed-admin.ts:90` (`org_id: org.id`) — so brand creation works once >1 org exists.
- **New-user brand access after `client_id` removal.** Creating a user (`POST /api/admin/users`) and accepting a brand invite must still grant brand access via a **membership** row, not the dropped `users.client_id`. Verify the membership is written in both paths.
- **`jobs` dedup unaffected.** The drop touches no jobs trigger (jobs has none); `namespaceDedup` + `jobs_dedup_idx` continue to provide per-tenant dedup (Finding 4). Confirm the existing `queue-tenant-dedup.itest.ts` still passes.
- **`rbac.test.ts` false positive.** The literal `"security_group"` at `:62,:80` is an unknown-role fixture — leave it; a blind grep-delete would break the fail-closed RBAC test.
- **Integration fixtures break on the dropped columns.** Every `*.itest.ts` that inserts a user with `security_group` (`provisioning.itest.ts:152,173`; `invitations.itest.ts:128`; `isolation.itest.ts:146`; `lifecycle.itest.ts:184,199,214`; `operator-isolation.itest.ts:168,184`; `org-purge.itest.ts:210,236`) will fail to compile/insert once the column is gone — strip the key (and any `client_id`) from each fixture in the same PR.
- **S12-in-flight regression.** Re-assert `clients.slug` is globally unique after the migration (schema-introspection test) so a concurrent reviewer cannot land a per-org slug change that breaks S12's subdomain rewrite.

### Test Plan

- **DB-free unit (`npm test`).** Add/extend a guard test asserting `SessionPayload`'s shape contains no `client_id`/`security_group` (Finding 2). Confirm `rbac.test.ts` still passes untouched.
- **DB-backed integration (`*.itest.ts`, gated, serial) — new `schema-cleanup.itest.ts`:**
  1. **Triggers/functions gone:** query `pg_trigger`/`pg_proc` (or `information_schema`) and assert none of the 10 trigger names / 6 function names exist.
  2. **Columns gone:** assert `information_schema.columns` has no `users.client_id` / `users.security_group`.
  3. **Uniqueness set matches decisions:** introspect indexes and assert exactly — `organizations.slug` unique; **`clients.slug` GLOBAL unique** (explicit S12 guard); `users (org_id, email)` unique + operator-email partial unique; `jobs_dedup_idx` present on `(deduplication_id)` partial (Decision B). 
  4. **Negative insert:** an `org_id`-less insert into `candidates` raises NOT NULL (safety net removed, writers covered).
  5. **Brand access via membership:** a freshly created user / accepted brand invite has the expected `memberships` row (no reliance on `users.client_id`).
- **Regression:** re-run the full `*.itest.ts` suite after stripping legacy keys from the fixtures, plus `queue-tenant-dedup.itest.ts` and S11's lifecycle/isolation tests — all green proves the trigger drop changed no insert outcome.
- **Build/typecheck:** `npm run build` (must compile with the two columns and the relation removed). Apply the migration to a throwaway DB first: `DATABASE_URL=… npm run db:migrate` then `npm run test:integration`.

### Suggested Implementation Order

> Branch from current `main`/HEAD (S11 landed). No need to wait for S12 — but **do not touch `clients.slug`** (S12 contract).

1. **Schema model:** edit `src/db/schema.ts` (remove `client_id`, `security_group`, the index, the `usersRelations.client` relation).
2. **Generate + augment the migration:** `npm run db:generate` → hand-prepend the trigger/function drops into the generated `0031_*.sql` (journal-safe; Database step 0). Apply to a throwaway DB.
3. **Decision A:** convert the user-detail brand display/move to memberships (or formally defer to S14 and scope `client_id` out of this PR — but then the "grep finds no references" acceptance is only met for `security_group`; record that explicitly).
4. **Grep-and-remove:** clear the dead reads/writes (the table above), update `seed-admin.ts` + the operator assertion message, confirm `SessionPayload` construction sites.
5. **Frontend cleanup:** delete the two dead controls on `users/[id]/page.tsx`.
6. **Fix fixtures:** strip `security_group`/`client_id` from the listed `*.itest.ts` files.
7. **Tests + build:** add `schema-cleanup.itest.ts`, run unit + integration + `npm run build`.
8. **PR note:** flag that `clients.slug` global-uniqueness is preserved (load-bearing for in-flight S12) and that S13 adds `0031` while S12 adds no migration.

### Resolved Decisions & Open Questions

**Decision A — `users.client_id` UI: convert to memberships in S13 (recommended), with a clean fallback to S14.** S13's acceptance is *"grep finds no references"* to `client_id`, which cannot hold while `users/[id]/route.ts:85-92,181-184` and the page still read/write it. The membership-based brand view **already exists** in the same route (`:77-82`), so the conversion is low-risk: render the brand name from the membership join and re-express the single-brand "move" as a membership mutation (or drop the per-user move if brand membership is managed elsewhere). **Fallback:** if the team prefers to keep the user-page rework in S14, S13 drops only `security_group` + the triggers/functions and **defers the `users.client_id` column drop to S14** — but then the S13 PR must state that the "no `client_id` references" half of the acceptance is intentionally carried into S14. *Recommend the in-S13 conversion* since the substrate is already present and it satisfies the acceptance as written.

**Decision B — `jobs` uniqueness: confirm S10's namespaced single-column index; do NOT add a composite.** The slice's literal `jobs (org_id, deduplication_id)` predates S10. Per-tenant dedup is already delivered by `namespaceDedup(orgId, dedupId)` + the partial `jobs_dedup_idx` (Finding 4). Adding a real `(org_id, deduplication_id)` composite would double-guard and would wrongly constrain global (`org_id IS NULL`) jobs. **Resolution:** update S13's acceptance wording to "per-tenant dedup via namespaced `deduplication_id` + `jobs_dedup_idx`" and assert that index in the schema test.

**Decision C — keep `clients.slug` global-unique (S12 contract).** "Finalise uniqueness" explicitly excludes any move to per-org brand slugs while S12's org-less subdomain rewrite is in flight (and S14 reconfirms the same). Assert-and-preserve.

**Open Question 1 — In or after S13 for the `client_id` UI?** Drives Decision A; the only genuinely product-facing choice. Confirm with whoever owns S14's seed/UI scope before starting, since it changes whether the `client_id` *column* drops in this PR or the next.

**Open Question 2 — Does `seed-admin.ts` write an owner membership today?** If the owner's brand access depended solely on `users.client_id`, dropping it without a corresponding `memberships` insert would leave seeded owners brand-less. Verify the membership path before deleting the seed's `client_id` (it should already exist from S8, but confirm).
