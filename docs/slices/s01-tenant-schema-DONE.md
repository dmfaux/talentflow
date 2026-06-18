# S1 · Tenant schema: organizations + brands + memberships + operators + `org_id` denormalisation

> **Phase 0 — Tenant foundation (operator-lockout-safe, no behaviour change)**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** introduce the org level above `clients`(=brands), per-brand memberships, two-tier roles, tenant-less operators, and denormalise `org_id` onto every leaf so all later scoping is one indexed predicate. Additive + backfilled; no runtime change.
- **Schema:** NEW `organizations` (id, name, `slug` unique, `tier` [moved from clients], `billing_email` [moved], `status` active|suspended|deleted, suspended_at/deleted_at, timestamps). ALTER `clients`: ADD `org_id NOT NULL → organizations.id ON DELETE CASCADE` (nullable during backfill, then NOT NULL); **keep `clients.slug` globally unique**; add `clients_org_id_idx`. NEW `memberships` (user_id, client_id, `brand_role` brand_admin|recruiter|viewer, `unique(user_id, client_id)`). ALTER `users`: ADD `org_id` (nullable for operators), `org_role` (owner|org_admin, null), `is_operator` (default false); DROP global `users_email_idx`; ADD `unique(org_id, email)` + partial unique on email WHERE `is_operator`; keep `client_id`+`security_group` transitionally (dropped in S13). ADD `org_id NOT NULL` to `campaigns, candidates, scoring_logs, messages, conversations, chat_messages, chat_tokens, events`. ALTER `jobs`: ADD `org_id` (see S10/§9 reconciliation). Indexes: `org_id` on every leaf + composite `(org_id, status)`/`(org_id, created_at)` for scoped aggregates. **Explicit `ON DELETE CASCADE` down the whole org subtree** (today FKs have no `onDelete`).
- **↳ Review correction (major — brand_id drift):** do **not** add an unconstrained `candidates.brand_id`. Use the single `candidates → campaigns.client_id` join for brand scoping; if a denormalised brand copy is later needed for a hot path, gate it with a `CHECK`/trigger invariant + verification query (§5.4).
- **Backend:** update `schema.ts`; write re-runnable migration `0026_*` that creates tables, adds columns nullable, **backfills** (one demo org wrapping existing clients-as-brands; set `clients.org_id`; cascade `org_id` down all leaves via up-joins; one membership per existing user → brand_admin; existing admins → `org_role='owner'`; mark `SEED_ADMIN` `is_operator=true`, `org_id NULL`), then SET NOT NULL. Include a **verification assertion: 0 leaf rows with null `org_id`**. Add a transitional `BEFORE INSERT` trigger deriving `org_id` from the parent campaign for not-yet-updated writers.
- **Acceptance:** migration clean on fresh DB **and** idempotent against the seeded DB; `count(*) WHERE org_id IS NULL = 0` on all leaves; uniqueness rules as specified; operators representable; app boots and apply/chat/admin behave identically (trigger fills `org_id`); no enforcement yet.
- **Depends on:** — · **Risks:** missed backfill row → NOT NULL failure (backfill before constraint, assert 0); cross-brand duplicate demo emails → pre-check/reseed; the compatibility trigger is load-bearing (cover with the verification query).

---

# Implementation Spec: S1 · Tenant schema (organizations + brands + memberships + operators + `org_id` denormalisation)

**Generated**: 2026-06-15
**Codebase snapshot**: branch `main` @ `82ad628`
**Change type**: Backend-only (schema, migration, ORM model — no user-facing surface; UI work is explicitly deferred to S8/S9/S14)

---

## Codebase Analysis

The data layer is **Drizzle ORM (`drizzle-orm` 0.45.2) over `postgres-js`** against PostgreSQL, with `drizzle-kit` 0.31.10 for generation. There is **no ORM tier above raw Drizzle and no test runner** in the repo (no `test` script in `package.json`, no `*.test.ts`); verification today is done with SQL assertions and the seed/migrate scripts.

Key files this slice touches:

- **`src/db/schema.ts`** — single-file schema. Existing tables: `clients`, `campaigns`, `candidates`, `scoring_logs`, `users`, `password_reset_tokens`, `messages`, `conversations`, `chat_messages`, `chat_tokens`, `events`, `jobs`. Conventions observed and to be followed exactly:
  - `id: uuid().primaryKey().defaultRandom()`; snake_case columns; `created_at`/`updated_at` as `timestamp().defaultNow().notNull()`.
  - FK columns use `.references(() => parent.id)` **with no `onDelete`** today (e.g. `campaigns.client_id`, `candidates.campaign_id`, `messages.candidate_id`, `chat_messages.conversation_id`). This slice adds explicit `ON DELETE CASCADE` down the whole subtree.
  - Index helpers `index(...)`, `unique(...)`, `uniqueIndex(...)` returned from the second `pgTable` arg as an **array** (e.g. `campaigns` already has `unique("campaigns_client_id_slug_unique")` + two `index(...)`).
  - Partial unique indexes are already used with raw `sql` predicates — see `jobs_dedup_idx` (`schema.ts:428`) and `jobs_poll_idx` — the exact idiom needed for the operator-email partial unique.
  - `users` (`schema.ts:161`) currently: `client_id NOT NULL → clients.id`, `security_group NOT NULL`, `uniqueIndex("users_email_idx").on(email)` (the **global** email unique to be dropped), `index("users_client_id_idx")`.
  - `clients` (`schema.ts:18`) already carries `tier` (default `"standard"`) and `billing_email` — these are the columns the org level "inherits". **They are read/written at runtime** (`api/admin/clients/route.ts`, `api/admin/clients/[id]/route.ts`, and the entire `(admin)/clients/*` UI), so they **must remain in place transitionally** (organizations gets its own copy, backfilled; dropping the `clients` copies is out of scope for S1, deferred to S13 — see **Decision 3**).
- **`src/db/migrate.ts`** — runs `migrate(db, { migrationsFolder: "./drizzle" })`. The migrator applies each `drizzle/NNNN_*.sql` once, tracked by hash in `__drizzle_migrations`, ordered by **`drizzle/meta/_journal.json`**. Hand-written SQL migrations are first-class here: see `0010_backfill_template_status_log.sql` (pure `INSERT … SELECT` backfill) and `0020`/`0025` (hand-edited DDL with `sql` predicates). Every migration **must** have a matching `_journal.json` entry + `meta/NNNN_snapshot.json`, which `drizzle-kit generate` produces for you.
- **`drizzle.config.ts`** — `schema: "./src/db/schema.ts"`, `out: "./drizzle"`, dialect `postgresql`.
- **`package.json` scripts** — `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx src/db/migrate.ts`), `db:seed` (`tsx src/db/seed.ts`), `db:seed:admin` (`tsx src/db/seed-admin.ts`).
- **`src/db/seed.ts`** — wipes and reseeds 8 clients → campaigns → candidates → leaves. Candidate emails are generated with a random suffix (`…${randInt(1,999)}@domain`), so cross-brand duplicate emails are unlikely but **not impossible** — relevant to the `(org_id, email)` uniqueness backfill risk for `users` (seed users come only from `seed-admin.ts`; the generated candidates are not `users`).
- **`src/db/seed-admin.ts`** — creates one `clients` row + one `admin` `users` row from `SEED_ADMIN_*` env vars. The slice's literal text wants this account "promoted to operator", but **promotion is env-keyed and is deliberately kept out of the migration** (see **Decision 1**). S2's slice explicitly reworks `seed-admin.ts` to create a separate operator + Owner membership.

**Runtime writers that insert into the to-be-`NOT NULL` leaf tables** (these are what the transitional trigger must cover, since none of them set `org_id` and S5 is what later updates them) — enumerated by grep of `.insert(<table>)`:

| Leaf table (→ NOT NULL) | Runtime insert site(s) | FK the trigger derives `org_id` from |
|---|---|---|
| `campaigns` | `api/admin/campaigns/route.ts`, `api/admin/campaigns/from-job-spec/route.ts` | `clients.org_id` via `client_id` |
| `candidates` | `api/apply/[clientSlug]/[campaignSlug]/route.ts` | `campaigns.org_id` via `campaign_id` |
| `scoring_logs` | `src/lib/ai-scoring.ts` (×4) | `candidates.org_id` via `candidate_id` |
| `messages` | `src/lib/email.ts` | `candidates.org_id` via `candidate_id` |
| `conversations` | `src/lib/chat.ts` | `candidates.org_id` via `candidate_id` |
| `chat_messages` | `src/lib/chat.ts`, `api/chat/[conversationId]/route.ts` | `conversations.org_id` via `conversation_id` |
| `chat_tokens` | `api/chat/request-access/route.ts` | `candidates.org_id` via `candidate_id` |
| `events` | `api/events/route.ts` | `campaigns.org_id` via `campaign_id` |

`jobs` is written by `src/lib/queue/db-queue.ts` (`DbQueue.enqueue`) **and** by a **raw-SQL backstop** in `src/app/api/jobs/process/route.ts` (`INSERT INTO jobs (type, payload, deduplication_id) SELECT … FROM candidates …`, ~lines 41-79). Neither sets `org_id` — which is why **`jobs.org_id` stays nullable in S1** and its attribution is reconciled in S10/§9 (the backstop is named in the S13 trigger-drop gate). Do **not** make `jobs.org_id` `NOT NULL` here.

## Related Issues

- **S2 (Identity/session seam)** — *depends on S1.* Consumes the new columns: rewrites `auth.ts` `SessionPayload → {userId, orgId|null, orgRole|null, isOperator}` and reworks `seed-admin.ts` to **create the operator + attach the existing admin as Owner + `brand_admin` membership**. S1 only delivers the *structural capability* (the `is_operator` column, nullable `users.org_id`, `org_role`, `memberships`); the actual designation of a specific account as the operator is most cleanly S2's job (env-keyed). S1 must **not** add scoping/enforcement — S2 must precede S4 or operators get locked out.
- **S5 (WRITE isolation + RBAC)** — updates every mutating route to set `org_id` **explicitly** on insert. Once S5 lands, the S1 trigger becomes redundant for those writers.
- **S10 (usage metering + jobs attribution)** — owns `jobs.org_id` population (`EnqueueOptions`/`JobPayload` gain `orgId`; the raw-SQL backstop rewritten to set `org_id`), per-tenant dedup (`(org_id, deduplication_id)`), and `usage_events`. **`jobs.org_id` nullable in S1 is intentional and required by S10.**
- **S13 (schema cleanup)** — drops `users.client_id` + `users.security_group`, **drops the S1 triggers** (gated on verified writer coverage incl. the `jobs/process` backstop), and finalises uniqueness. The legacy columns S1 keeps are dropped here.
- **S14 (seed/demo-data rework)** — rewrites `seed.ts` to 2 orgs × 2-3 brands using **production insert paths (no trigger reliance)**. S1's `seed.ts` is left as-is (it relies on the trigger to fill `org_id`, which is acceptable for S1).

### Assumptions from siblings

Do **not** build these in S1 — they are allocated elsewhere:

- The new `SessionPayload` shape, `requireTenant`/`tenant.ts`, and operator-account *creation* → **S2**.
- Explicit `org_id` on inserts in mutating routes → **S5** (S1 relies on the trigger instead).
- `jobs.org_id` population + `usage_events` + per-tenant dedup → **S10** (S1 only adds the nullable `jobs.org_id` column + index).
- Dropping `users.client_id`/`security_group` and removing the triggers → **S13**.
- Multi-org demo seed via production paths → **S14**.
- Do **not** add an unconstrained `candidates.brand_id` (review correction §5.4). Brand scoping is the single `candidates → campaigns.client_id` join. If a hot-path denorm is ever needed, it must carry a `CHECK`/trigger invariant (`= parent campaign's client_id`) + verification query — not in S1.

## Implementation Plan

### Database Changes

**Migration file:** `drizzle/0026_tenant_schema.sql` (+ its `meta/0026_snapshot.json` and `_journal.json` entry).

**Recommended authoring workflow** (avoids the classic `ADD COLUMN … NOT NULL`-on-populated-table failure):

1. Edit `src/db/schema.ts`. Per **Decision 5**, the DB-`NOT NULL` `org_id` columns (`clients` + the 8 leaves) are modelled **without** `.notNull()` in Drizzle for S1 — so the generated DDL emits them nullable and the existing insert sites still typecheck. Add the new tables, `org_id` columns (nullable in the model), indexes, cascades, and the new `users` uniqueness.
2. Run `npm run db:generate -- --name tenant_schema`. This emits `0026_tenant_schema.sql` **and** writes the matching `_journal.json` entry + `0026_snapshot.json`. Because the model leaves these `org_id` columns nullable, the generated `ADD COLUMN "org_id" uuid` statements are **already nullable** — no NOT-NULL-first hand-edit is required.
3. **Hand-edit only the `.sql` body** (the snapshot stays the source of truth for future diffs, so editing the script does not desync it):
   - After the generated `ADD COLUMN` statements, insert the **backfill** block, then the **verification assertion**, then per-table `ALTER COLUMN "org_id" SET NOT NULL` (for `clients` + the 8 leaves only — **not** `jobs`, **not** `users.org_id`).
   - Append the **trigger** DDL (leaf triggers + the `clients` sole-org shim + the `users` shim — **Decision 4**).
   - Make every statement **re-runnable** (`IF NOT EXISTS`, `WHERE … IS NULL`, `ON CONFLICT … DO NOTHING`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`).

   *(`drizzle-kit generate` cannot emit triggers, data backfills, or the `RAISE EXCEPTION` assertion — these are always hand-written, consistent with `0010`/`0020`/`0025`.)*

> **Intentional, documented drift (Decision 5):** after this migration the **DB** has `org_id NOT NULL` on `clients` + the 8 leaves, but the **Drizzle model/snapshot** still type them nullable. This is deliberate (it keeps S1 a zero-route-change PR). S5 adds `.notNull()` to the model, producing a `SET NOT NULL` that is a no-op against the DB but reconciles the snapshot. Until then, an unrelated `drizzle-kit generate` may bundle a harmless redundant `SET NOT NULL` — expected, not a bug.

**`schema.ts` additions / changes:**

```ts
// NEW — organizations (the tenant level above clients=brands)
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tier: text("tier").notNull().default("standard"),      // moved up from clients (copy)
  billing_email: text("billing_email"),                  // moved up from clients (copy)
  status: text("status").notNull().default("active"),    // active | suspended | deleted
  suspended_at: timestamp("suspended_at"),
  deleted_at: timestamp("deleted_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)]);

// NEW — memberships (per-brand role for a user)
export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  client_id: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  brand_role: text("brand_role").notNull(),              // brand_admin | recruiter | viewer
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("memberships_user_client_unique").on(t.user_id, t.client_id),
  index("memberships_user_id_idx").on(t.user_id),
  index("memberships_client_id_idx").on(t.client_id),
]);
```

`clients` — add the FK column + index (keep `slug` globally unique, keep `tier`/`billing_email` — see **Decision 3**). Per **Decision 5** the model omits `.notNull()`; the migration enforces `NOT NULL` at the DB:
```ts
org_id: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }), // DB NOT NULL; model nullable until S5
// (table cb) + index("clients_org_id_idx").on(t.org_id)
```

`users` — add tenant columns, **drop** the global email unique, add the two new uniqueness rules:
```ts
org_id: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }), // NULLABLE (operators)
org_role: text("org_role"),                                  // owner | org_admin | null
is_operator: boolean("is_operator").notNull().default(false),
// table cb: REMOVE uniqueIndex("users_email_idx"); keep users_client_id_idx; ADD:
uniqueIndex("users_org_email_idx").on(t.org_id, t.email),
uniqueIndex("users_operator_email_idx").on(t.email).where(sql`${t.is_operator}`),
index("users_org_id_idx").on(t.org_id),
```
*Keep `client_id` + `security_group` (dropped in S13).* Note Postgres treats `NULL`s as distinct in a multi-column unique, so `(org_id, email)` does **not** constrain operators (org_id NULL) — that is exactly why the partial unique on `email WHERE is_operator` is needed.

Each of the 8 leaves gets `org_id uuid NOT NULL → organizations.id ON DELETE CASCADE` **at the DB** (Drizzle model nullable until S5 — Decision 5) + indexes; `jobs` gets `org_id uuid` **nullable** (DB and model) + index:

| Table | `org_id` | Indexes to add |
|---|---|---|
| `campaigns` | NOT NULL | `campaigns_org_id_idx`, `campaigns_org_status_idx(org_id,status)`, `campaigns_org_created_idx(org_id,created_at)` |
| `candidates` | NOT NULL | `candidates_org_id_idx`, `candidates_org_status_idx`, `candidates_org_created_idx` |
| `scoring_logs` | NOT NULL | `scoring_logs_org_id_idx`, `scoring_logs_org_created_idx` |
| `messages` | NOT NULL | `messages_org_id_idx`, `messages_org_created_idx` |
| `conversations` | NOT NULL | `conversations_org_id_idx`, `conversations_org_status_idx` |
| `chat_messages` | NOT NULL | `chat_messages_org_id_idx` |
| `chat_tokens` | NOT NULL | `chat_tokens_org_id_idx` |
| `events` | NOT NULL | `events_org_id_idx`, `events_org_created_idx` |
| `jobs` | **NULLABLE** | `jobs_org_id_idx` |

**Explicit `ON DELETE CASCADE` down the subtree** — add `{ onDelete: "cascade" }` to every existing FK so a destroyed org/brand cascades cleanly: `campaigns.client_id`, `candidates.campaign_id`, `scoring_logs.candidate_id`, `messages.candidate_id`, `conversations.candidate_id`, `chat_messages.conversation_id`, `chat_tokens.candidate_id`, `events.campaign_id`, `users.client_id`, `password_reset_tokens.user_id`. The generated migration will `DROP CONSTRAINT … ` + `ADD CONSTRAINT … ON DELETE CASCADE` for each.

**Backfill (runs after columns are added nullable, before `SET NOT NULL`)** — all guarded for re-runnability:
```sql
-- 1. One demo org wrapping all existing clients-as-brands.
--    tier='standard' / billing_email=NULL by Decision 2 (org column defaults;
--    no canonical value exists when 8 heterogeneous brands collapse into one org).
INSERT INTO organizations (name, slug, tier, billing_email, status)
SELECT 'Demo Organization', 'demo-org', 'standard', NULL, 'active'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'demo-org');

UPDATE clients SET org_id = (SELECT id FROM organizations WHERE slug = 'demo-org')
WHERE org_id IS NULL;

-- 2. Cascade org_id down via up-joins (each guarded by org_id IS NULL)
UPDATE campaigns      c  SET org_id = cl.org_id FROM clients cl       WHERE c.client_id = cl.id      AND c.org_id IS NULL;
UPDATE candidates     ca SET org_id = c.org_id  FROM campaigns c      WHERE ca.campaign_id = c.id    AND ca.org_id IS NULL;
UPDATE scoring_logs   s  SET org_id = ca.org_id FROM candidates ca    WHERE s.candidate_id = ca.id   AND s.org_id IS NULL;
UPDATE messages       m  SET org_id = ca.org_id FROM candidates ca    WHERE m.candidate_id = ca.id   AND m.org_id IS NULL;
UPDATE conversations  cv SET org_id = ca.org_id FROM candidates ca    WHERE cv.candidate_id = ca.id  AND cv.org_id IS NULL;
UPDATE chat_tokens    t  SET org_id = ca.org_id FROM candidates ca    WHERE t.candidate_id = ca.id   AND t.org_id IS NULL;
UPDATE chat_messages  cm SET org_id = cv.org_id FROM conversations cv WHERE cm.conversation_id = cv.id AND cm.org_id IS NULL;
UPDATE events         e  SET org_id = c.org_id  FROM campaigns c      WHERE e.campaign_id = c.id     AND e.org_id IS NULL;
-- jobs: nullable, best-effort from payload candidateId (global jobs stay NULL — fine)
UPDATE jobs j SET org_id = ca.org_id FROM candidates ca
WHERE (j.payload->>'candidateId') IS NOT NULL
  AND (j.payload->>'candidateId')::uuid = ca.id AND j.org_id IS NULL;

-- 3. One brand_admin membership per existing user
INSERT INTO memberships (user_id, client_id, brand_role)
SELECT u.id, u.client_id, 'brand_admin' FROM users u
ON CONFLICT (user_id, client_id) DO NOTHING;

-- 4. Users: org_id from their client; existing admins → owner.
--    Decision 1: the migration does NOT promote anyone to operator. is_operator
--    stays its column default (false) for every existing user. Operator-account
--    creation is owned by S2's seed-admin.ts rework (a separate, tenant-less
--    account); the existing admin remains a tenant Owner + brand_admin here.
UPDATE users u SET org_id = cl.org_id FROM clients cl WHERE u.client_id = cl.id AND u.org_id IS NULL;
UPDATE users SET org_role = 'owner' WHERE security_group = 'admin' AND org_role IS NULL;
```

**Verification assertion (MUST run before `SET NOT NULL`; aborts the migration on any null leaf):**
```sql
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM clients WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM campaigns     WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM candidates    WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM scoring_logs  WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM messages      WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM conversations WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM chat_messages WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM chat_tokens   WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM events        WHERE org_id IS NULL
  ) s;
  IF bad > 0 THEN RAISE EXCEPTION 'org_id backfill incomplete: % leaf row(s) still NULL', bad; END IF;
END $$;
```
Then `ALTER TABLE <each> ALTER COLUMN "org_id" SET NOT NULL;` for `clients` + the 8 leaves (**not** `jobs`, **not** `users.org_id`), and drop `users_email_idx` / create the two new `users` unique indexes.

**Transitional `BEFORE INSERT` triggers** (fill `org_id` only when the writer left it NULL — once S5 sets it explicitly, the `IS NULL` guard makes the trigger a no-op; removed in S13). Use one function per parent column and share it across tables with the same parent:

```sql
-- derive from clients (campaigns)
CREATE OR REPLACE FUNCTION set_org_id_from_client() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM clients WHERE id = NEW.client_id;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- derive from campaigns (candidates, events)
CREATE OR REPLACE FUNCTION set_org_id_from_campaign() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM campaigns WHERE id = NEW.campaign_id;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- derive from candidates (scoring_logs, messages, conversations, chat_tokens)
CREATE OR REPLACE FUNCTION set_org_id_from_candidate() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM candidates WHERE id = NEW.candidate_id;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- derive from conversations (chat_messages)
CREATE OR REPLACE FUNCTION set_org_id_from_conversation() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM conversations WHERE id = NEW.conversation_id;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- clients: no parent. Decision 4 — fill from the SOLE org when exactly one
-- exists; if 0 or >1 orgs exist, leave NULL so the NOT NULL constraint rejects
-- the insert LOUDLY (by the time a 2nd org exists, S5/S9 must set org_id).
CREATE OR REPLACE FUNCTION set_org_id_default_org() RETURNS trigger AS $$
DECLARE org_count int;
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT count(*) INTO org_count FROM organizations;
    IF org_count = 1 THEN SELECT id INTO NEW.org_id FROM organizations; END IF;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- users: derive org_id from the user's client, but NEVER for operators
-- (is_operator=true is inserted with an explicit NULL org_id — don't clobber).
CREATE OR REPLACE FUNCTION set_org_id_from_client_user() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.is_operator IS NOT TRUE THEN
    SELECT org_id INTO NEW.org_id FROM clients WHERE id = NEW.client_id;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Attach (DROP TRIGGER IF EXISTS … first for re-runnability):
-- campaigns    → set_org_id_from_client
-- candidates   → set_org_id_from_campaign
-- events       → set_org_id_from_campaign
-- scoring_logs → set_org_id_from_candidate
-- messages     → set_org_id_from_candidate
-- conversations→ set_org_id_from_candidate
-- chat_tokens  → set_org_id_from_candidate
-- chat_messages→ set_org_id_from_conversation
-- clients      → set_org_id_default_org      (Decision 4)
-- users        → set_org_id_from_client_user (Decision 4)
```

**The two writers with no campaign/candidate ancestor are now resolved (Decision 4):**
- `clients` (`api/admin/clients/route.ts`, `seed-admin.ts`, `seed.ts`) — DB `org_id` is `NOT NULL` but the brand-create writer supplies none in S1 (session has no orgId until S2). The `set_org_id_default_org()` trigger fills it from the sole org for the entire S1→S5/S9 window (only the demo org exists then). Once a second org is provisioned (S9), an org-less brand insert fails loudly on `NOT NULL` rather than silently misattributing — which is correct, because by then S5 has the writer setting `org_id` explicitly. *(A column `DEFAULT → demo-org` was rejected: it would outlive the single-org window and silently misattribute new brands.)* Trigger dropped in S13.
- `users` (`api/admin/users/route.ts`, `seed-admin.ts`) — `org_id` is nullable so inserts never fail, but the `set_org_id_from_client_user()` trigger keeps tenant users correct (derives `org_id` from `client_id`) while skipping operators. Trigger dropped in S13.

### API / Backend Changes

No HTTP endpoints, services, or auth flows change in S1 (that is S2+). Backend work is limited to:

- **`src/db/schema.ts`** — the table/column/index/cascade changes above, plus Drizzle `relations(...)` for `organizations` (`many(clients)`, `many(users)`) and `memberships` (`one(users)`, `one(clients)`), and add `organization: one(organizations, …)` to `clientsRelations`/`usersRelations`. (Relations are query-builder metadata only — no runtime behaviour change.)
- **`drizzle/0026_tenant_schema.sql`** + `meta/0026_snapshot.json` + `_journal.json` entry.
- **No changes to `auth.ts`, `api.ts`, route handlers, queue, or `email.ts`** — the trigger preserves identical runtime behaviour, and **Decision 5** (DB `NOT NULL`, Drizzle column nullable until S5) means the 8 leaf insert sites + the 2 `clients` insert sites compile **unchanged** (`$inferInsert` does not require `org_id`). Confirm a clean `next build` / typecheck after the schema edit; expect zero route edits in this PR.

### Edge Cases and Boundary Conditions

- **`ADD COLUMN NOT NULL` on populated tables** — must be nullable-first → backfill → `SET NOT NULL`. The generated migration's inline `NOT NULL` will fail on the seeded DB; this is the primary hand-edit.
- **Idempotency / re-runnability** — migration must succeed both on a **fresh** DB and re-applied against a **seeded** DB (and survive a re-run after partial failure): `INSERT … WHERE NOT EXISTS` for the demo org, `… IS NULL` guards on every backfill `UPDATE`, `ON CONFLICT DO NOTHING` on memberships, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`, `CREATE … IF NOT EXISTS` for tables/indexes.
- **`jobs.org_id` left NULL** — intentional; do not assert non-null on `jobs`. Global jobs (no candidate in payload) and the raw-SQL backstop legitimately produce NULL until S10.
- **Orphan / dangling leaf rows** — if any leaf row's parent chain is broken (e.g. a candidate whose campaign was hard-deleted pre-cascade), its `org_id` stays NULL and the assertion will abort the migration. Pre-check with the assertion query; clean or delete orphans before constraining.
- **`clients` brand creation during the S1→S5 window** — handled by the `set_org_id_default_org()` trigger (Decision 4): fills from the sole org while only the demo org exists, and fails loudly on `NOT NULL` once a 2nd org is provisioned (by which point S5 sets `org_id` explicitly).
- **Operator vs tenant uniqueness** — `(org_id, email)` does not de-dupe operators (NULL org_id); the `email WHERE is_operator` partial unique does. Two operators cannot share an email; an operator and a tenant user *can* share an email (different constraints) — acceptable and intended (S2 login resolution decides the rule).
- **Cross-brand duplicate user emails** — collapsing all clients into one demo org means all existing users share one `org_id`; if two existing users had the same email under different clients, `(org_id, email)` would now collide. Seed users come only from `seed-admin.ts` (single admin), so this is near-zero in practice, but the migration should surface a clear error rather than a constraint violation — consider a pre-check `SELECT email FROM users GROUP BY email HAVING count(*)>1` before creating the unique index.
- **Trigger no-op after S5** — the `IS NULL` guard means once S5 sets `org_id` explicitly the trigger does nothing; this is what makes the S13 drop safe.

### Test Plan

There is **no automated test framework** in this repo, so verification follows the existing SQL-assertion + script pattern (mirroring `0010`'s backfill and `seed.ts`'s summary counts). Recommended gates:

- **Fresh-DB gate:** on an empty database, `npm run db:migrate` applies `0000…0026` cleanly; tables `organizations`/`memberships` exist; `clients.org_id` + the 8 leaf `org_id` are `NOT NULL`; `jobs.org_id` nullable.
- **Seeded-DB gate (idempotency):** `db:migrate` → `db:seed` → re-run `db:migrate`; the migration is a no-op the second time and raises no error; the embedded assertion passes (0 null leaves).
- **Backfill correctness (SQL assertions, runnable as a throwaway `tsx` script following the `db:*` convention, or psql):**
  - `SELECT count(*) FROM <each leaf> WHERE org_id IS NULL` = 0 for all 8 leaves + `clients`.
  - Every leaf's `org_id` equals its parent's `org_id` (spot-check one join per chain, e.g. `candidates ↔ campaigns`, `chat_messages ↔ conversations`).
  - `SELECT count(*) FROM memberships` = `SELECT count(*) FROM users` (one brand_admin each), all `brand_role='brand_admin'`.
  - Existing admin users have `org_role='owner'`.
- **Uniqueness rules:** inserting a second `organizations` row with `slug='demo-org'` fails; a second `clients` row with an existing global slug fails; two tenant users with the same `(org_id, email)` fail; two `is_operator` users with the same email fail; an operator + a tenant user sharing an email **succeeds**.
- **Trigger / no-behaviour-change smoke test:** with the app running against the migrated+seeded DB, exercise **apply → score → chat → admin list**: submit an application (inserts `candidates` + `events`), let scoring run (inserts `scoring_logs`, `messages`), open a chat (inserts `conversations`, `chat_messages`, `chat_tokens`), and confirm each new row has a non-null `org_id` matching the demo org — proving the trigger fills it without any route change. (`/run` or `vercel:verification` can drive this.)
- **Cascade check (non-destructive, in a transaction you roll back):** `BEGIN; DELETE FROM organizations WHERE slug='demo-org'; SELECT count(*) FROM candidates; ROLLBACK;` → confirms the subtree cascades to 0.

### Suggested Implementation Order

1. **Read the modified-Next.js docs note** (`AGENTS.md`) — this slice is pure DB/Drizzle, but confirm no migrate-runner conventions changed under `node_modules/next/dist/docs` if you touch anything app-level.
2. Edit `src/db/schema.ts`: add `organizations` + `memberships`; add `org_id` (+ `org_role`, `is_operator`) and indexes; swap `users` uniqueness; add `{ onDelete: "cascade" }` to all subtree FKs. **Decide the TS-nullability of leaf `org_id` (recommend nullable-in-TS for S1)** so existing insert sites still typecheck.
3. `npm run db:generate -- --name tenant_schema` → get `0026_tenant_schema.sql` + snapshot + journal entry.
4. Hand-edit `0026_tenant_schema.sql`: nullable-first columns → backfill block → verification assertion → `SET NOT NULL` → uniqueness swap → trigger functions + attachments → `clients`/`users` shims. Make every statement re-runnable.
5. Apply on a **fresh** DB (`db:migrate`); then `db:seed`; then **re-run** `db:migrate` to prove idempotency.
6. Run the SQL backfill/uniqueness/cascade assertions; run the apply→score→chat→admin smoke test to confirm trigger-filled `org_id` and identical behaviour.
7. `next build` / typecheck clean; open the PR (schema + single migration + snapshot + journal; no route changes).

### Resolved Decisions

These were the open questions; each is now decided and baked into the plan above. Rationale and any sibling-slice follow-on are noted.

1. **Operator designation is NOT done in the migration.** `0026` stays env-agnostic and leaves `is_operator` at its default (`false`) for every existing user. Two reasons: (i) migration SQL cannot read `SEED_ADMIN_EMAIL`, and (ii) the slice's literal "mark `SEED_ADMIN` `is_operator=true`" **contradicts S2**, which keeps the existing admin as a tenant **Owner + brand_admin** and creates a **separate, tenant-less operator**. You cannot do both to one account, so S2's model wins. S1 only makes operators *representable* (column + nullable `org_id` + partial-unique), satisfying the "operators representable" acceptance criterion at the schema level. **Follow-on:** S2's `seed-admin.ts` rework creates the operator account (optionally keyed on a new `SEED_OPERATOR_EMAIL`). If a runnable operator is wanted for manual S1 testing before S2, add that idempotent block to `seed-admin.ts` — never to the migration.

2. **Demo org seeds with `tier='standard'`, `billing_email=NULL`** (the `organizations` column defaults). Collapsing 8 heterogeneous brands into one synthetic org yields no canonical tier or billing address; defaulting avoids accidentally over-provisioning the demo org with an elevated tier. Real per-org values are set when orgs are properly provisioned (S9) / reseeded as 2 orgs (S14). *Revisit only if* a stakeholder wants the demo org to exercise a non-standard tier for demo purposes — then hardcode that tier in the one INSERT.

3. **`clients.tier` / `clients.billing_email` stay in S1; removal is deferred to S13.** They are read/written by the live `(admin)/clients` UI + API, so dropping them in S1 would break behaviour. The org level becomes the conceptual source of truth for tier/billing, making the `clients` copies transitional duplicates. **Follow-on (add to sibling slices):** S9 must repoint the tier/billing read+write UI to the org (tier already "operator-only / read-only for owners" in S9); **add `clients.tier` + `clients.billing_email` to S13's column-drop list**, gated on S9 landing.

4. **`clients` org_id is filled by a sole-org trigger; `users` by a client-derived trigger** (both shown above, both dropped in S13). Rejected the column-`DEFAULT → demo-org` alternative because it would outlive the single-org window and silently misattribute brands created after S9. The sole-org trigger instead **fails loudly** (`NOT NULL` violation) once >1 org exists — correct, because S5 has the writer setting `org_id` by then. This preserves true no-behaviour-change in the S1→S5 window without a footgun.

5. **DB `NOT NULL`, Drizzle model nullable until S5.** `clients` + the 8 leaves are `NOT NULL` at the database (enforced + trigger-filled), but their Drizzle columns omit `.notNull()` in S1 so all existing `.insert()` sites typecheck unchanged — keeping S1 a **zero-route-change** PR (the alternative, `.notNull()` now, would force editing 8+ insert sites and duplicate S5's work). The resulting model-vs-DB drift (model nullable, DB strict) is intentional and documented; S5 adds `.notNull()`, emitting a no-op `SET NOT NULL` that reconciles the snapshot. No reads of `org_id` exist before S4, so the temporarily-nullable type is harmless.
