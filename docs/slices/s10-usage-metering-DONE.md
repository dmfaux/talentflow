# S10 · Per-org usage metering + jobs org-attribution + per-tenant dedup + queue fairness + per-brand email

> **Phase 3 — Cost control, lifecycle, routing, cleanup**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** close the cost-exposure gap (billing deferred, cost must be visible) and make the global queue tenant-safe.
- **Schema:** NEW `usage_events` (org_id, brand_id?, kind ai_tokens|campaign_created|candidate_created|chat_message|email_sent, provider/model?, input/output tokens?, campaign_id/candidate_id?, quantity, created_at; indexes on `(org_id, created_at)`/`(org_id, kind)`). Jobs dedup → **partial unique `(org_id, deduplication_id)`** (or org-namespace in code); `jobs.org_id` set on every enqueue. Optional `brands.reply_to_email`/`from_name`.
- **Backend:** instrument the **three** LLM surfaces with org-attributed token usage read from the SDK result — scoring (`ai-scoring.ts` via `ai/index.ts`/`providers.ts`), chat (`/api/chat/[conversationId]` — streamText + classifyTopicCoverage + detectWithdrawal), job-spec parsing — recorded async/best-effort. Meter campaign/candidate creation. Queue: `EnqueueOptions`/`JobPayload` gain `orgId`; `DbQueue`+`ServiceBusQueue` set `jobs.org_id` + namespace dedup; **all** enqueue sites pass `orgId`.
- **↳ Review correction (blocker — uncovered writer):** the `jobs/process/route.ts` **raw-SQL backstop** (`INSERT INTO jobs … SELECT … FROM candidates`, ~lines 41-79) bypasses `DbQueue.enqueue`. Rewrite it to populate `org_id` from `candidates.org_id`, and **reconcile `jobs.org_id` nullability**: candidate-derived jobs get a non-null `org_id`; genuinely-global jobs handled explicitly. List this writer by name in the S13 trigger-drop gate.
- **↳ Review correction (major — fairness risk):** treat **queue fairness as its own design note with pseudocode** preserving the atomic `FOR UPDATE SKIP LOCKED` claim + reclaim pass. Fairness is *not* isolation-critical — **may be deferred** so the V1 line doesn't depend on rewriting the claim loop. (Metering + dedup + `org_id` are the safely-additive parts.)
- **Backend (email):** `src/lib/email.ts` derive from/reply-to from the candidate's brand (via S1 denorm), safe default for unverified brands.
- **Frontend:** 🎨 operator per-org usage summary; optional Owner read-only usage page.
- **Acceptance:** every LLM call records an org-attributed `usage_events` row with SDK token counts; every job row has `org_id` (incl. backstop rows); two orgs' identical dedup keys don't collide; (if fairness shipped) a 1000-job tenant doesn't block another; per-brand from/reply-to used.
- **Depends on:** S5 · **Risks:** missing any of the 3 chat calls under-counts cost (use SDK counts, not estimates); fairness must not break reclaim semantics; normalise provider token reporting.

---

# Implementation Spec: S10 · Per-org usage metering + jobs org-attribution + per-tenant dedup + queue fairness + per-brand email

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `e5a31a1` ("Add role-aware tenant shell + brand switcher + member invites (S8)"). The branch name is stale; commits now run through **S8 (landed)** — `0028_lonely_mandarin.sql` (S8 `invitations`) is the latest migration in tree. **S9 is in flight** (its spec is written; its code — `organizations.contact_name/contact_email`, the `POST /api/operator/organizations` provision route, `seed-admin.ts` rework — is not yet committed). S10 **`Depends on: S5`** (landed); it does **not** depend on S9, but it **shares three files with in-flight S9** (`schema.ts`, `email.ts`, and the operator org-detail page) and must coordinate migration numbering.
**Change type**: **Backend** (the bulk: `usage_events` table, the `recordUsageEvent` helper, instrumenting the LLM surfaces, `EnqueueOptions.orgId` + org-namespaced dedup across `DbQueue`/`ServiceBusQueue` + all 15 enqueue sites, the `jobs/process` raw-SQL backstop rewrite, per-brand from/reply-to in `email.ts`) **and UI/UX** (operator per-org usage summary filling the existing S10 placeholder; optional Owner read-only usage page). The `frontend-design` skill is **mandatory** for the two screens — see Frontend Changes.

> **Two findings that reshape the slice as written — read first.**
> 1. **`jobs.org_id`, `jobs.deduplication_id`, and a partial-unique dedup index ALREADY EXIST.** They were added in `0026_tenant_schema.sql` (S1), with the schema comment at `schema.ts:637-638` stating verbatim *"jobs.org_id is populated by S10 (not 0026). Global jobs and the raw-SQL backstop legitimately leave this NULL."* So S10's jobs work is **populating `org_id` on enqueue** and **making dedup tenant-safe** — **not** adding the column or index. There is **no jobs migration** if we org-namespace the dedup key in code (Resolved Decision A).
> 2. **`ServiceBusQueue` never touches the `jobs` table** (`src/lib/queue/service-bus-queue.ts` — it sends to Azure and deduplicates via the Service Bus `messageId`). A composite DB index `(org_id, deduplication_id)` would make the *DbQueue* path tenant-safe but do **nothing** for the Service Bus path. **Org-namespacing the dedup key in code** (`"${orgId}:${rawDedupId}"`) is the only single approach that makes **both** drivers tenant-safe — which is exactly why the slice offers *"(or org-namespace in code)"*. **Choose org-namespacing** (Resolved Decision A); it also sidesteps the Postgres NULL-distinctness pitfall a composite unique index has for any future genuinely-global (NULL-org) job.

> **Dependency / coordination status.**
> - **S5 (landed) — the real dependency.** Every mutating route now stamps `org_id` explicitly and `ctx.effectiveOrgId`/`effectiveOrgRole` are the org boundary (`src/lib/api.ts`). S10 reads `org_id` off the already-loaded candidate/campaign at each enqueue and LLM site — the attribution data is present because S5 put it there.
> - **S8 (landed, `e5a31a1`).** No direct overlap, but S10 builds on the post-S8 tree (`0028` is latest).
> - **S9 (in flight — shared files, coordinate; NOT a hard dependency).** S9 and S10 both edit `src/db/schema.ts`, `src/lib/email.ts`, and `src/app/operator/orgs/[id]/page.tsx`. **(a) Migration numbering:** S9 generates `0029_*` (org contact columns). After S9 merges, S10's `db:generate` yields `0030_*`. **If S9 has not merged when you generate, S10 also auto-numbers `0029_*` and collides** — rebase and regenerate; do not hand-pick. **(b) `email.ts`:** S9 only *reads* S8's `invitationEmail`; S10 changes the *transport* (`from`/`reply-to`). Low conflict, but rebase on S9 if it has merged. **(c) The operator Usage card:** S9 explicitly *leaves* the `orgs/[id]/page.tsx:204-217` "S10 placeholder" for S10 to fill — S10 replaces exactly that block. Build S10 on a branch **rebased onto S9 if S9 has merged**; otherwise build on `e5a31a1` and rebase before generating the migration.
> - **Downstream consumers (S11, S13, S14).** S10 produces three things siblings depend on: **(i) `jobs.org_id` populated on every writer** so **S11** can gate the `jobs/process` backstop SELECT + worker re-enqueue (nudge/expire) + `handleJob` entry on `org.status` (S11's resurrection-blocker); **(ii) a named, verified rewrite of `src/app/api/jobs/process/route.ts`** so **S13** can drop the S1 `BEFORE INSERT` triggers behind a verified-writer-coverage gate (S13 explicitly lists *"the `jobs/process` raw-SQL backstop"* in its trigger-drop gate); **(iii) a clean `usage_events` schema + production insert paths** so **S14** can seed realistic metered demo data ("use production insert paths, no trigger reliance"). **The S10 PR must name `jobs/process/route.ts` in its description as the writer S13's trigger-drop gate is waiting on.**

> **AGENTS.md mandate.** This is a modified **Next.js 16.2.2** (App Router). S10 edits a **streaming route handler** (`src/app/api/chat/[conversationId]/route.ts` — `streamText().toTextStreamResponse()` + the `after()` post-response hook), the **worker route handler** (`jobs/process/route.ts`), and the **email transport**. **Before writing/altering streaming, `after()`, route-handler, or `db.execute(sql…)` code, read the relevant guides under `node_modules/next/dist/docs/`** — the streaming/`after`/response APIs and `sql` interpolation idioms may differ from training data. Heed deprecation notices. Token usage from a stream is only available **after** the stream finishes (`await result.usage` inside `after()`), never inline — see Backend #2b.

---

## Codebase Analysis

S10 closes the **cost-visibility gap** (billing is deferred, but AI spend must be attributable per org before launch) and makes the **global background queue tenant-safe** (per-org dedup so two tenants' identical idempotency keys can't collide). Almost all the substrate already exists from S1–S8; S10 is **instrumentation + one new table + a queue-layer threading change + an email-transport change**, plus two thin operator/owner screens.

**The `jobs` table is already org-ready; the work is to *fill* it.** `schema.ts:624-657`: `jobs` has `org_id uuid` (nullable, FK→`organizations` `onDelete: cascade`, `:639-641`), `deduplication_id text` (`:636`), `status` (`:630`), `created_at` (`:642`), plus `index("jobs_org_id_idx")` (`:647`) and the partial-unique `jobs_dedup_idx` on `deduplication_id` WHERE `deduplication_id IS NOT NULL AND status IN ('pending','processing')` (`:651-655`). There is **no trigger on `jobs`** (unlike the leaf tables) — so `org_id` is populated **only by application code**, which is precisely what S10 wires up. Keep `org_id` **nullable** (do not add NOT NULL): the comment-blessed escape hatch for genuinely-global jobs stays, and in practice every current `JobPayload` variant carries a `candidateId` (see below), so every real job *will* get a non-null `org_id`.

**The queue abstraction is small and centralisable.** `src/lib/queue/types.ts`: `EnqueueOptions { deliverAt?, deduplicationId? }`, the `JobPayload` union, and `JobQueue { enqueue(payload, options?) }`. **Every `JobPayload` variant carries `candidateId`** (`candidate-processing`, `send-email`, `send-chat-invitation`, `rescore-after-chat`, `chat-nudge`, `chat-expire`) — so `org_id` is *always* derivable at the call site (the candidate/campaign is already loaded there post-S5). `DbQueue.enqueue` (`src/lib/queue/db-queue.ts:6-16`) inserts `{type, payload, deliver_at, deduplication_id}` with `.onConflictDoNothing()` (leaning on `jobs_dedup_idx`) — **it does not set `org_id`**. `ServiceBusQueue.enqueue` (`service-bus-queue.ts:35-43`) sends `{ body: payload, messageId: dedupId, scheduledEnqueueTimeUtc: deliverAt }` — **no jobs table, dedup is the `messageId`**. `getQueue()` (`queue/index.ts:7`) selects `ServiceBusQueue` iff `QUEUE_PROVIDER === "servicebus"`, else `DbQueue`. Threading `orgId` once through `EnqueueOptions` + both drivers + a shared namespacing rule covers all 15 call sites and both dedup mechanisms.

**The 15 enqueue sites (none org-aware today).** apply: `apply/[clientSlug]/[campaignSlug]/upload/route.ts:59`, `apply/[clientSlug]/[campaignSlug]/route.ts:174` & `:182`; admin: `admin/candidates/[id]/route.ts:89` & `:217`, `admin/candidates/[id]/open-chat/route.ts:66`; lib: `chat.ts:166`, `ai-scoring.ts:214` & `:233` & `:571`; worker re-enqueues: `queue/worker.ts:216`, `:220`, `:269`, `:350`, `:381`. Each already has the candidate (and thus `org_id`) in scope. The worker re-enqueues (`nudge`/`expire`/`no-response`) load the candidate with `{ campaign: { with: { client: true } } }` — `candidate.org_id` is right there.

**The raw-SQL backstop is the S13-gated writer.** `src/app/api/jobs/process/route.ts:40-80` runs **only when `QUEUE_PROVIDER !== "servicebus"`**: a bulk `INSERT INTO jobs (type, payload, deduplication_id) SELECT 'candidate-processing', jsonb_build_object(...), 'process-recovery-' || candidates.id FROM candidates WHERE …` recovering candidates stuck in `gating_passed`/`scoring`. It **does not set `org_id`** and bypasses `DbQueue.enqueue`. `candidates.org_id` is **NOT NULL** (`schema.ts:150-154`), so S10 can set it directly in the SELECT — and **must org-namespace the `deduplication_id`** there too (and update the throttle `NOT EXISTS` check that matches `'process-recovery-' || id`). This is the file S13's trigger-drop gate waits on.

**The claim loop is correct and must be preserved.** `jobs/process/route.ts:24-31` reclaims expired locks (`processing` → `pending`/`dead`); `:85-106` is the atomic batch claim (`UPDATE … WHERE id IN (SELECT … ORDER BY deliver_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING …`); `:111-130` dispatches via `handleJob()` (`queue/worker.ts`). **Fairness** (one tenant's 1000 jobs not starving another) means changing the *selection* inside that loop — it is **isolation-non-critical and may be deferred** (Backend #5 is a design note + pseudocode, not required for the V1 line).

**The AI layer discards token usage today.** `src/lib/ai/providers.ts:102-130` `callProvider(providerName, system, prompt)` calls `generateText()` at `:111` and returns `{ output, text, modelId }` — **the `result.usage` is dropped**. `callWithFallback` (`ai/index.ts`) returns `AIResult { output, text, providerName, modelId, attempts }` (no usage). **AI SDK is `ai@^6.0.153`** (`package.json:31`) → usage is `{ inputTokens, outputTokens }` (v6 names; **not** v4's `promptTokens`/`completionTokens`), and each field may be `undefined` — coalesce to `null`. So S10 must add `usage` to the provider return chain.

**The LLM surfaces and their org context (all reachable):**
- **Scoring** — `ai-scoring.ts` `scoreCandidate(candidateId)` (`:98-245`), LLM at `:133` via `callWithFallback`; `candidate.org_id` in scope (`:139`). **A second scoring call** lives in the same file: `rescoreWithChatContext` (`:395-583`, the `rescore-after-chat` handler) also calls `callWithFallback` — instrument both. Neither logs tokens today (`scoringLogs` writes at `:192-209` and `:549-566` omit token counts).
- **Chat — three calls** in `src/app/api/chat/[conversationId]/route.ts` (`conv.org_id` available at `:93`, `candidate_id` from params): **(a)** `classifyTopicCoverage` (`:233-304`, `generateObject` at `:243`); **(b)** the main `streamText` (`:152-160`); **(c)** `detectWithdrawal` (`:399-443`, `generateObject` at `:414`). The stream's usage is only available post-finish — the route already runs an `after(async () => { … await result.text … })` block (`:165-213`), the natural place to `await result.usage` and record.
- **Job-spec parsing** — `src/lib/ai/job-spec-schema.ts` `parseJobSpec(extractedText, clientName)` (`:226-282`) → `callProviderForJobSpec` (`:198-224`, `generateText` at `:206`); **does not receive `org_id`** — the call site `admin/campaigns/from-job-spec/route.ts:97` has `ctx.effectiveOrgId` (`:150`), so thread it in.

**There is no metering anywhere yet.** No `usage`/`usage_events`/`recordUsage` exists (confirmed by grep). `scoringLogs` and `operator_audit` are unrelated. S10 creates the table and the helper from scratch.

**The fire-and-forget pattern to mirror.** Best-effort side effects use `.enqueue(...).catch(err => console.error(...))` (e.g. `ai-scoring.ts:213-225`) — non-blocking, swallow-and-log. `recordUsageEvent` follows the same shape (insert, never throw into the hot path). For the chat stream, recording happens inside the existing `after()` hook.

**Email is a hardcoded-`from`, no-reply-to transport.** `src/lib/email.ts`: `sendTransactionalEmail(to, subject, htmlBody)` (`:65-69`) and `sendCandidateEmail(to, subject, htmlBody, candidateId)` (`:85-122`) both call `getTransport().send(FROM, to, subject, htmlBody)` where `FROM = process.env.EMAIL_FROM ?? "TalentStream <apply@talentstream.co.za>"` (`:60-61`). **The transport `send(from, to, subject, html)` has no reply-to parameter** (`:12-58`, Resend `:25-39` / SMTP `:41-55`) — S10 extends it. **There is no brand denorm on `candidates`** — the brand is reached via `candidate.campaign.client` (the relations at `schema.ts:556-569`); the **worker already loads candidates with `{ campaign: { with: { client: true } } }`** (`worker.ts:55-58, 143-145`), so the brand is in hand at the send sites without a new query. `clients` (brands) has **no** `from_email`/`from_name`/`reply_to_email` and **no domain-verification column** (`schema.ts:37-72`) — so "safe default for unverified brands" must be a *deliverability-safe* identity (Resolved Decision D), not raw brand-domain spoofing.

**The operator Usage card is a pre-built placeholder waiting for S10.** `src/app/operator/orgs/[id]/page.tsx:204-217` is a dashed-border card literally tagged `S10` with the text *"AI / token usage metering is available after S10."* It's a `"use client"` page fetching `GET /api/operator/organizations/[id]` (`:50-63`). That GET (`src/app/api/operator/organizations/[id]/route.ts:17-60`) returns `{ ...org, counts: { brands, campaigns, candidates } }` via three `count(*)` sub-queries — S10 extends it with a `usage` block. Response helpers `success(data, status)`/`error(message, status)` live at `src/lib/api.ts:16-22`. Operator screens use the **control-plane palette** (`ink`/`paper`/`canvas`/`surface`/`border`/`cobalt`/`vermillion`, `font-serif` headings, mono badges — `operator/layout.tsx`, `operator/orgs/[id]/page.tsx`).

**Tech stack:** Next.js 16.2.2 (App Router), Drizzle `drizzle-orm@^0.45.2` / `drizzle-kit@^0.31.10` over postgres-js (lazy singleton `src/db/index.ts`), AI SDK `ai@^6.0.153`, Azure Service Bus (optional, `QUEUE_PROVIDER=servicebus`), vitest 4 with a `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial). Migrations: `npm run db:generate` (drizzle-kit) → `drizzle/00NN_*.sql`, `npm run db:migrate` (`tsx src/db/migrate.ts`). Integration tests already stub `getQueue()` (`invitations.itest.ts:25`, `isolation.itest.ts:38`, `operator-isolation.itest.ts:32`).

## Related Issues

- **S1 (done)** — created `organizations`, `clients` (= brands), `candidates.org_id`, **and the `jobs` table already carrying `org_id`/`deduplication_id`/`jobs_dedup_idx`** (`0026_tenant_schema.sql`) with the explicit "populated by S10" comment. Also the `set_org_id_*` `BEFORE INSERT` triggers on leaf tables (no trigger on `jobs`).
- **S2 (done)** — the session seam (`getApiTenant`/`effectiveOrgId`). S10's per-org attribution reads `effectiveOrgId` at the job-spec/operator surfaces and `candidate.org_id` at the enqueue/LLM surfaces.
- **S3 (done)** — `rbac.ts` matrix. The optional Owner usage page is read-only; gate visibility owner/org_admin (an existing usage-read-style action or reuse the dashboard's gate).
- **S4 (done) + S5 (done) — S5 is the hard dependency.** S5 made every mutating route stamp `org_id`; S10 relies on that to read `org_id` off the loaded candidate/campaign at each enqueue and LLM site.
- **S6 (done)** — private blobs / org-prefixed paths. Disjoint from S10.
- **S7 (done)** — operator console + `operator_audit`. S10 adds **no** operator audit action (metering reads are not audited mutations); it only extends the operator org-detail **GET** + page.
- **S8 (done, `e5a31a1`)** — invitations / tenant shell. S10 builds on the post-S8 tree; no overlap.
- **S9 (in flight — shared files, coordinate).** S9 edits `schema.ts` (org contact columns → `0029`), `email.ts` (reads `invitationEmail`), and **leaves the `orgs/[id]/page.tsx:204-217` Usage placeholder for S10**. Coordinate migration numbering (S10 → `0030` post-rebase) and rebase on S9 before generating. See the Dependency note.
- **S11 (depends on S9; consumes S10)** — lifecycle suspend/soft-delete/purge. **S11's resurrection-blocker needs S10's `jobs.org_id`:** S11 gates the `jobs/process` backstop SELECT + worker re-enqueue (nudge/expire) + `handleJob` entry on `org.status`. S10 must populate `org_id` so those gates can join on it. (S11 also extends POPIA purge to chat tables — out of S10 scope.)
- **S12 (depends on S9)** — host/subdomain routing. Indirect to S10's per-brand email only (S12 ensures the brand resolves on the careers host); no schema/writer overlap.
- **S13 (depends on S5, S8, S10)** — drops the S1 `BEFORE INSERT` triggers **gated on verified writer coverage *including the `jobs/process` raw-SQL backstop*** and confirms `jobs (org_id, deduplication_id)` as a final uniqueness rule. **S10's backstop rewrite is the writer S13 is waiting on — name it in the S10 PR.** (Note: if S10 org-namespaces dedup in code rather than adding a composite index, S13's "`jobs (org_id, deduplication_id)`" expectation is satisfied *semantically* by the namespaced key on the existing single-column index — flag this to S13 so the reviewer doesn't expect a literal composite index.)
- **S14 (depends on S8, S9, S10)** — rewrites the rich multi-org `seed.ts` with **seeded `usage_events`** using **production insert paths**. S10 must expose `recordUsageEvent` + a clean table; S14 does the seeding. S10 does **not** touch any seed file.

### Assumptions from siblings (do **not** build these in S10)

- **`org.status` lifecycle gating of the backstop SELECT / worker re-enqueue / `handleJob` (S11).** S10 only *populates* `org_id`; S11 *gates on* it. Do not add suspend/purge checks to the queue in S10.
- **POPIA purge of chat/conversation tables (S11).** S10's `usage_events` carries no PII (token counts + ids) and is out of the purge path; do not extend purge in S10.
- **Multi-org `seed.ts` + seeded `usage_events` (S14).** S10 provides the table + `recordUsageEvent`; S14 seeds. Do not edit seeds in S10.
- **A spend *cap*/quota enforcement.** S10 is **visibility only** (metering). Any hard cap is a separate concern (the migration plan tracks it as a later "cost cap" item) — do not gate LLM calls on usage in S10.
- **Clients→Brands route/page/wizard rename (S14).** S10 adds `brand_id`/per-brand email columns and the operator usage card only.

## Implementation Plan

### Database Changes

**One additive migration. No `jobs` schema change (Resolved Decision A keeps the dedup index as-is).** Two parts in `src/db/schema.ts`:

**1. NEW `usage_events` table** (place near `jobs`, `schema.ts` ~`:620`). Import `sql` is already at `:1`.
```ts
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // forward-looking name (S14 renames Clients→Brands); references clients.id
    brand_id: uuid("brand_id").references(() => clients.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // 'ai_tokens' | 'campaign_created' | 'candidate_created' | 'chat_message' | 'email_sent'
    provider: text("provider"),   // ai_tokens only (e.g. 'anthropic')
    model: text("model"),         // ai_tokens only (modelId from the SDK result)
    input_tokens: integer("input_tokens"),   // ai_tokens only; SDK usage.inputTokens (coalesce undefined→null)
    output_tokens: integer("output_tokens"), // ai_tokens only; SDK usage.outputTokens
    campaign_id: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    candidate_id: uuid("candidate_id").references(() => candidates.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull().default(1),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_events_org_created_idx").on(table.org_id, table.created_at),
    index("usage_events_org_kind_idx").on(table.org_id, table.kind),
  ]
);
```
- `org_id` **cascade** (purged with the org — matches `jobs`/`candidates`); `brand_id`/`campaign_id`/`candidate_id` **`set null`** so an S11 candidate purge doesn't delete the cost ledger (the org-level aggregate survives until the org itself is purged). No trigger (insert paths set `org_id` explicitly — "production insert paths" per S14).
- Add a `usageEvents` relations block mirroring the existing relations style if other code needs `with:` joins (optional; the operator summary uses aggregate `count`/`sum`, not relations).

**2. `clients` (brands) per-brand email columns** (`schema.ts:37-72`, after `billing_email`):
```ts
from_name: text("from_name"),         // display name for outbound mail; deliverability-safe (Decision D)
reply_to_email: text("reply_to_email"), // candidate replies routed here
```
Both nullable, no backfill.

Then `npm run db:generate` → `drizzle/00NN_<name>.sql`, `npm run db:migrate`.

> **Migration-number coordination (S9 in flight).** Latest in tree is `0028_lonely_mandarin.sql` (S8). S9 generates `0029_*` (org contact columns). After rebasing onto S9, S10 becomes `0030_*`. **If S9 has not merged when you `db:generate`, S10 will also auto-number `0029_*` and collide** — regenerate against the post-rebase journal; do not hand-pick the number.

**S10 does NOT** add/alter the `jobs` table (org-namespaced dedup is code-only — Decision A), add a composite `(org_id, deduplication_id)` index, add NOT NULL to `jobs.org_id`, add a brand domain-verification column (Decision D), or touch any seed.

### API / Backend Changes

> **Read the Next.js 16 streaming / `after()` / route-handler docs first (AGENTS.md).** The chat route streams and records usage post-finish.

#### 1. The metering helper — `src/lib/usage.ts` (NET-NEW)

```ts
export type UsageKind =
  | "ai_tokens" | "campaign_created" | "candidate_created" | "chat_message" | "email_sent";

export interface UsageEventInput {
  orgId: string;
  brandId?: string | null;
  kind: UsageKind;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  campaignId?: string | null;
  candidateId?: string | null;
  quantity?: number; // default 1
}

/** Best-effort, fire-and-forget. NEVER throws into the caller's hot path. */
export function recordUsageEvent(input: UsageEventInput): void {
  void db.insert(usageEvents).values({
    org_id: input.orgId,
    brand_id: input.brandId ?? null,
    kind: input.kind,
    provider: input.provider ?? null,
    model: input.model ?? null,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    campaign_id: input.campaignId ?? null,
    candidate_id: input.candidateId ?? null,
    quantity: input.quantity ?? 1,
  }).catch((err) => console.error("recordUsageEvent failed:", err));
}
```
Mirrors the `.enqueue(...).catch(...)` best-effort pattern (`ai-scoring.ts:213-225`). A metering failure must never break scoring/chat/provisioning.

#### 2. Instrument the LLM surfaces (read SDK token counts, **never estimate** — slice risk)

**2a. Expose usage from the provider layer.** In `src/lib/ai/providers.ts:102-130`, capture `result.usage` from the `generateText()` call (`:111`) and add it to the return; thread it through `callWithFallback`'s `AIResult` (`ai/index.ts`) as `usage?: { inputTokens: number | null; outputTokens: number | null }`. Coalesce the v6 `undefined` fields to `null`. **Scoring** then records in `scoreCandidate` (after `:133`) and in `rescoreWithChatContext` (after its `callWithFallback`):
```ts
recordUsageEvent({
  orgId: candidate.org_id, kind: "ai_tokens",
  provider: aiResult.providerName, model: aiResult.modelId,
  inputTokens: aiResult.usage?.inputTokens ?? null,
  outputTokens: aiResult.usage?.outputTokens ?? null,
  campaignId: candidate.campaign_id, candidateId: candidate.id,
});
```

**2b. Chat — record all three calls** (`chat/[conversationId]/route.ts`, `conv.org_id` at `:93`):
- `classifyTopicCoverage` (`:233-304`) and `detectWithdrawal` (`:399-443`): destructure `const { object, usage } = await generateObject(...)` and **return the usage** to the POST handler (e.g. change return to `{ coveredIndices, usage }` / `{ withdrawn, usage }`), so the handler — which has org/candidate context — records them. Capture the model id from `getChatModel()` (expose it). Record on the success path; on the regex/silent-fallback paths, record nothing (no tokens were spent).
- `streamText` (`:152-160`): inside the **existing `after()` block (`:165-213`)**, after `await result.text`, add `const usage = await result.totalUsage;` and `recordUsageEvent({ orgId: conv.org_id, kind: "ai_tokens", provider: …, model: …, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, candidateId: conv.candidate_id })`. Use `totalUsage` (aggregates multi-step). **Do not block the stream** — recording stays inside `after()`.
- Also record one `{ kind: "chat_message", orgId: conv.org_id, candidateId: conv.candidate_id }` per inbound candidate message (volume counter; quantity 1).

**2c. Job-spec parsing** (`src/lib/ai/job-spec-schema.ts:198-282`): capture `result.usage` from `generateText()` (`:206`), return it from `callProviderForJobSpec`/`parseJobSpec`, and **thread `orgId` in** (add a param). The call site `admin/campaigns/from-job-spec/route.ts:97` has `ctx.effectiveOrgId` (`:150`) — pass it and record `ai_tokens` with the parsed campaign/brand ids.

**2d. Creation counters** (lighter, where org context is at hand): `candidate_created` at the apply candidate-insert (`apply/[clientSlug]/[campaignSlug]/route.ts`, after the candidate row is created — `org_id` from the resolved campaign); `campaign_created` at the campaign insert(s) under `src/app/api/admin/campaigns/` (the known site `from-job-spec/route.ts:150`; **grep for other `insert(campaigns)` sites** and meter each). These are best-effort `quantity:1` rows for the operator volume view; `ai_tokens` is the priority for cost.

#### 3. Queue org-attribution + per-tenant dedup (Resolved Decision A — org-namespace in code)

**3a. `EnqueueOptions` gains `orgId`** (`src/lib/queue/types.ts`): `orgId?: string | null`.

**3b. Namespace the dedup key once, in both drivers** (so all 15 call sites only pass `orgId`):
- `DbQueue.enqueue` (`db-queue.ts`): set `org_id: options?.orgId ?? null`, and `deduplication_id: options?.deduplicationId ? `${options.orgId ?? "global"}:${options.deduplicationId}` : null`. Keep `.onConflictDoNothing()` (existing `jobs_dedup_idx` now keys off the namespaced value → two orgs' identical raw keys no longer collide).
- `ServiceBusQueue.enqueue` (`service-bus-queue.ts`): set `messageId: options?.deduplicationId ? `${options.orgId ?? "global"}:${options.deduplicationId}` : undefined` (same namespacing → tenant-safe Service Bus dedup). (Optionally also stamp an `applicationProperties: { orgId }` for downstream attribution.)
- **Centralise** the `"${orgId ?? "global"}:${rawDedup}"` rule in a tiny shared helper in `queue/types.ts` or `queue/index.ts` so both drivers and the backstop use one definition.

**3c. Pass `orgId` at all 15 enqueue sites** (each already has the candidate/campaign → `org_id`): the apply, admin-candidate, open-chat, `chat.ts`, `ai-scoring.ts`, and `worker.ts` re-enqueue sites listed in Codebase Analysis. Worker re-enqueues read `candidate.org_id` (already loaded with `campaign.client`).

**3d. Rewrite the raw-SQL backstop** (`jobs/process/route.ts:40-80`) — **the S13-gated writer**:
- Insert `org_id`: `INSERT INTO jobs (type, payload, deduplication_id, org_id) SELECT 'candidate-processing', jsonb_build_object(...), ${candidates.org_id}::text || ':process-recovery-' || ${candidates.id}::text, ${candidates.org_id} FROM ${candidates} WHERE …` (candidates.org_id is NOT NULL → always non-null).
- **Update the throttle `NOT EXISTS`** that currently matches `recent.deduplication_id = 'process-recovery-' || candidates.id::text` to the **namespaced** form `recent.deduplication_id = candidates.org_id::text || ':process-recovery-' || candidates.id::text`, so the throttle still fires.
- The per-candidate in-flight `NOT EXISTS` (matching `payload->>'candidateId'`) is unchanged.
- **PR note for S13:** *"`src/app/api/jobs/process/route.ts` backstop now sets `org_id` from `candidates.org_id` and namespaces its dedup key per-org. This is a verified writer for the S13 trigger-drop gate."*

#### 4. Per-brand from/reply-to (`src/lib/email.ts`) — deliverability-safe (Resolved Decision D)

- **Extend the transport** `getTransport().send(...)` (`email.ts:12-58`) to accept an optional `from` override and `replyTo` (Resend → `replyTo`; nodemailer/SMTP → `replyTo`). Add an optional param/options object to `sendCandidateEmail` (and `sendTransactionalEmail` where a brand is known): `{ fromName?, replyTo? }`.
- **`brandEmailIdentity(brand)` helper** → `{ from, replyTo }`: `from = brand.from_name ? `${brand.from_name} <${addressOf(EMAIL_FROM)}>` : EMAIL_FROM` (**keep the verified envelope address**, personalise only the display name), `replyTo = brand.reply_to_email ?? undefined`. **Unverified-brand safe default:** when `from_name`/`reply_to_email` are null → fall back to the global `FROM` and no reply-to (today's behaviour). **Do not** send `From: <brand-domain>` — there is no SPF/DKIM/domain-verification for brand domains, so spoofing them would tank deliverability (Decision D).
- **Resolve the brand at the candidate send sites that already have it**: the worker (`worker.ts:55-58, 143-145`) loads `candidate.campaign.client` — pass that brand into `sendCandidateEmail`. Same at `apply/.../route.ts:163`. Record an `email_sent` usage event there too (`orgId: candidate.org_id, brandId: candidate.campaign.client.id, kind: "email_sent"`).

#### 5. Queue fairness — **design note + pseudocode (DEFERRABLE, not V1-blocking)**

Fairness is *starvation* protection, not *isolation* — the slice marks it deferrable and the migration-plan V1 line keeps only metering + dedup + `org_id`. **Ship 3a–3d for V1; gate this behind a follow-up.** The note (so it isn't lost): the current claim (`jobs/process/route.ts:85-106`) is a single `ORDER BY deliver_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED`, so one org with 1000 ready jobs monopolises every batch. A fair claim **must preserve** the atomic `FOR UPDATE SKIP LOCKED` and the reclaim pass (`:24-31`). Pseudocode (per-org round-robin cap per batch):
```sql
-- Claim at most CEIL(BATCH/active_orgs) per org per tick, via a window over org_id:
UPDATE jobs SET status='processing', locked_until=:lock, attempts=attempts+1
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY org_id ORDER BY deliver_at ASC) AS rn
    FROM jobs
    WHERE status='pending' AND deliver_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY deliver_at ASC
    FOR UPDATE SKIP LOCKED
  ) ranked
  WHERE rn <= :perOrgCap
  LIMIT :batch
)
RETURNING id, type, payload, attempts, max_attempts;
```
Validate the `FOR UPDATE SKIP LOCKED` semantics under the window in the target Postgres (lock-then-filter ordering); if the planner mis-locks, fall back to two-step (cheap `SELECT` of candidate ids with the window, then the atomic `UPDATE … WHERE id IN (…) FOR UPDATE SKIP LOCKED`). **`log`/document any cap so a single-tenant deployment isn't silently throttled** (`perOrgCap = BATCH` when one active org).

### Frontend Changes

> **The `frontend-design` skill is MANDATORY for both screens** (project standard). Operator screen uses the **control-plane palette** (`ink`/`paper`/`canvas`/`surface`/`border`/`cobalt`/`vermillion`, `font-serif` headings, mono `S10`-style badges — match `operator/orgs/[id]/page.tsx` & `operator/layout.tsx`). The optional Owner screen uses the **admin palette** (`charcoal`/`cream`/`accent`/`surface`/`border`, `TierBadge`, `EmptyState`, `useToast`).

**1. Operator per-org usage summary — replace the placeholder (`src/app/operator/orgs/[id]/page.tsx:204-217`).** Swap the dashed `S10` placeholder for a real **Usage** card reading the extended `GET /api/operator/organizations/[id]` `usage` block (#6 below): total input/output tokens (current billing period + all-time), a small per-`kind` breakdown (ai_tokens / candidates / campaigns / chat_messages / emails), and optionally top providers/models. Keep the control-plane card shell (`rounded-xl border bg-surface p-6`, `font-serif text-lg text-ink` heading). Add a period note ("last 30 days"). Loading/empty states consistent with the page.

**1b. Extend `GET /api/operator/organizations/[id]`** (`src/app/api/operator/organizations/[id]/route.ts:17-60`): add a fourth parallel query aggregating `usage_events` for the org — e.g. `SELECT kind, sum(quantity), sum(input_tokens), sum(output_tokens) … WHERE org_id=$id [AND created_at > now() - interval '30 days'] GROUP BY kind` (uses `usage_events_org_kind_idx` / `usage_events_org_created_idx`). Return alongside `counts` as `usage: { period: '30d', byKind: {...}, tokens: { input, output } }`. Still `requireApiOperator`-gated; no audit (read).

**2. (Optional) Owner read-only usage page.** Per the slice's *"optional Owner read-only usage page"* — a read-only `(admin)` page (e.g. `(admin)/settings` "Usage" tab or `(admin)/dashboard/usage`) showing the owner their **own org's** usage via a tenant GET (`GET /api/admin/usage` → `getApiTenant()` + aggregate `usage_events` WHERE `org_id = ctx.effectiveOrgId`). Gate owner/org_admin. **Scope-control note:** treat this as optional/stretch — the **operator** summary (#1) is the slice's required surface; ship the Owner page only if time allows, and clearly flag in the PR if deferred.

### Edge Cases and Boundary Conditions

- **Use SDK token counts, never estimates (slice risk #1).** All three chat calls + both scoring calls + job-spec must read `usage.inputTokens`/`outputTokens` from the SDK result. Missing any of the **three** chat calls under-counts cost — test each path produces a row. v6 fields can be `undefined` → store `null`, don't coerce to 0 (distinguish "unknown" from "zero").
- **Metering is best-effort and must never break the hot path.** A `recordUsageEvent` DB failure logs and is swallowed; scoring/chat/email/provisioning continue. Test: inject an insert failure → the user-facing operation still succeeds.
- **Streaming usage is post-finish only.** `streamText` usage is recorded inside `after()` after `await result.totalUsage`; never inline (would stall the stream). Test the chat stream still flushes tokens to the client and the usage row appears after completion.
- **Two orgs, identical dedup keys, no collision (headline acceptance).** With org-namespacing, Org A and Org B both enqueuing `process-${candidateId}` (or any shared key) produce distinct namespaced keys → both enqueue. Test on **both** drivers conceptually (DbQueue `jobs_dedup_idx`; Service Bus `messageId`). Also test **same-org** dedup still suppresses the true duplicate.
- **Every job row has `org_id`, including backstop rows (acceptance).** All 15 enqueue sites pass `orgId`; the backstop SELECTs `candidates.org_id` (NOT NULL). Genuinely-global jobs (none today) explicitly pass `null`. Test the backstop inserts a non-null `org_id`.
- **`jobs.org_id` stays nullable.** Do not add NOT NULL (the comment-blessed global escape hatch). But assert in tests that candidate-derived paths are non-null.
- **Per-brand email is deliverability-safe.** A brand with `from_name`/`reply_to_email` set → display name personalised, **envelope-from stays the verified `EMAIL_FROM` address**, Reply-To set. A brand with neither → exact current behaviour. Test both, and that no brand-domain address ends up in the `From` header.
- **Usage survives candidate purge, dies with org.** `candidate_id`/`brand_id`/`campaign_id` are `set null`; `org_id` cascade. Test that deleting a candidate keeps its `usage_events` rows (with `candidate_id` nulled) and that deleting the org removes them (S11 interaction surface).
- **Fairness is deferrable and must not regress reclaim (slice risk #2).** If fairness ships, the windowed claim must keep `FOR UPDATE SKIP LOCKED` + the reclaim pass intact; a single-org deploy must not be throttled. If deferred, say so explicitly in the PR.
- **Normalise provider token reporting (slice risk #3).** Different providers (anthropic/openai/openrouter/local) report usage through the same v6 `usage` shape via the AI SDK — record `provider` + `model` so the operator view can disaggregate; treat a provider that returns no usage as `null` tokens (not 0).

### Test Plan

Extend the `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial). Reuse the two-org fixtures from `isolation.itest.ts`/`operator-isolation.itest.ts` and the `getQueue()`/`@/lib/email` stubs. Add `usage-metering.itest.ts` and `queue-tenant-dedup.itest.ts` (+ DB-free unit tests).

- **DB-free unit tests (`npm test`):**
  - Dedup namespacing: `namespaceDedup("orgA","process-1") !== namespaceDedup("orgB","process-1")`; `null` org → `"global:process-1"`; no raw dedup → `undefined`/`null`.
  - `brandEmailIdentity`: brand with `from_name` → display-name-only `from`, verified address retained; brand with `reply_to_email` → `replyTo` set; brand with neither → global `FROM`, no `replyTo`; assert the envelope address never becomes a brand domain.
  - `recordUsageEvent` maps undefined token fields → null; default `quantity` 1.
  - AI SDK v6 usage extraction maps `{inputTokens, outputTokens}` (and undefined→null).
- **DB-backed integration tests (gated):**
  1. **AI token metering — all five LLM calls:** scoring (`scoreCandidate`), rescore (`rescoreWithChatContext`), chat `classifyTopicCoverage`, chat `streamText` (via `after`), chat `detectWithdrawal`, and job-spec `parseJobSpec` each insert an `ai_tokens` `usage_events` row with `org_id`, `provider`, `model`, and SDK `input_tokens`/`output_tokens` (stub the AI SDK to return a known `usage`). Org A's scoring writes only Org-A-scoped rows.
  2. **Tenant dedup — no cross-org collision:** Org A and Org B both `enqueue(..., { orgId, deduplicationId: "process-X" })` → **two** `jobs` rows (DbQueue), each with the right `org_id`; same-org duplicate enqueue → still **one** row.
  3. **Every job has `org_id`:** each of the 15 sites' enqueues lands a non-null `org_id`; the `jobs/process` backstop inserts rows with `org_id = candidates.org_id` and the namespaced throttle key; throttle still suppresses re-enqueue within the window.
  4. **Per-brand email:** a candidate whose brand has `from_name`/`reply_to_email` → transport receives the personalised `from` (verified address) + `replyTo`; a brand without → global `FROM`, no `replyTo`; an `email_sent` usage row is recorded with `org_id`+`brand_id`.
  5. **Operator usage GET:** `GET /api/operator/organizations/[id]` returns a `usage` block (per-kind sums + token totals) for that org only; non-operator → 403; an org with no events → zeroed/empty usage, not an error.
  6. **Lifecycle of usage rows (S11 surface):** delete a candidate → its `usage_events` rows persist with `candidate_id` null; delete the org → rows cascade-deleted.
  7. **(If fairness shipped):** seed Org A with 1000 ready jobs + Org B with 1 → one `process` tick claims at least one Org B job (no starvation); reclaim of an expired lock still works.
- **Build/typecheck:** `npm run build` — must compile the new `usage_events` table + `brand` email columns + `EnqueueOptions.orgId` + provider-usage threading, and merge cleanly with in-flight S9's `schema.ts`/`email.ts` edits.

### Suggested Implementation Order

> Rebase onto **S9 if it has merged** (shared `schema.ts`/`email.ts`/operator page); otherwise build on `e5a31a1` and rebase before generating the migration.

1. **Schema + migration:** add `usage_events` + `clients.from_name`/`reply_to_email` to `schema.ts`; `npm run db:generate` (renumber to `0030_*` after S9's `0029`); `npm run db:migrate`.
2. **Metering helper:** `src/lib/usage.ts` (`recordUsageEvent`, `UsageKind`).
3. **Queue attribution + dedup:** `EnqueueOptions.orgId` + the namespacing helper; `DbQueue` (`org_id` + namespaced dedup); `ServiceBusQueue` (namespaced `messageId`); thread `orgId` through all 15 sites; **rewrite the `jobs/process` backstop** (`org_id` + namespaced throttle). Integration-test cross-org dedup + backstop org_id first.
4. **LLM instrumentation:** provider-layer `usage` passthrough → scoring (×2) + job-spec; chat (×3, `after()` for the stream). Test all five produce rows.
5. **Per-brand email:** transport `replyTo`/`from` extension + `brandEmailIdentity` + wire candidate send sites; record `email_sent`.
6. **Creation counters:** `candidate_created` (apply) + `campaign_created` (campaign inserts).
7. **Operator usage GET + card** (frontend-design skill): extend `[id]` GET with the `usage` aggregate; replace the `:204-217` placeholder. **(Optional)** Owner usage page.
8. **Tests + `npm run build`.** PR description **names `jobs/process/route.ts` as the S13-gated writer** and notes the org-namespaced-dedup decision (so S13 doesn't expect a literal composite index).

### Resolved Decisions (open questions answered)

> Resolved with best judgement on 2026-06-17 — proceed on these; each is reversible if product later disagrees.

**A. Per-tenant dedup → org-namespace the key in code; keep the existing single-column `jobs_dedup_idx`. Reject the composite `(org_id, deduplication_id)` index.** The slice explicitly offers *"(or org-namespace in code)"*. Namespacing (`"${orgId ?? "global"}:${rawDedup}"`, centralised in the queue layer) makes **both** the DbQueue path (existing partial-unique index now keys off the namespaced value) **and** the Service Bus path (`messageId`) tenant-safe with **one** rule and **zero migration**. A composite DB index would (i) do nothing for Service Bus, which has no `jobs` table, and (ii) hit Postgres NULL-distinctness for any future genuinely-global (NULL-org) dedup'd job. Flag to S13 that its *"`jobs (org_id, deduplication_id)`"* uniqueness expectation is met *semantically* by the namespaced key, not a literal composite index.

**B. Keep `jobs.org_id` nullable.** Do not add NOT NULL. The `schema.ts:637` comment reserves NULL for genuinely-global jobs and the backstop. In practice every current `JobPayload` carries a `candidateId` so every real job gets a non-null `org_id`; the acceptance *"every job row has org_id (incl. backstop rows)"* is satisfied behaviourally while preserving the global escape hatch S11/S13 expect.

**C. `usage_events` FK lifecycle → `org_id` cascade; `brand_id`/`campaign_id`/`candidate_id` `set null`.** Cost is incurred at the org level; a candidate/brand purge (S11) should not erase the org's spend ledger, but purging the whole org should. This also keeps `usage_events` PII-free and outside the POPIA candidate-purge path. `quantity` defaults to 1; token columns are nullable (ai_tokens-only; "unknown" ≠ "zero").

**D. Per-brand email → personalise the display name + set Reply-To, keep the verified envelope-from; no brand domain-verification column in S10.** `clients` has no SPF/DKIM/domain-verification, and the verified sending domain is `EMAIL_FROM` (`talentstream.co.za`). Sending `From: <brand-domain>` would fail authentication and tank deliverability. So the "safe default for unverified brands" is: `from_name` → display name only (address stays the verified one), `reply_to_email` → Reply-To, and **no brand fields set → exact current behaviour**. A real brand-domain verification flow (+ a `domain_verified_at` column and DNS setup) is a deliberate **future slice**, not S10.

**E. `brand_id` (not `client_id`) on `usage_events`.** Follows the migration plan's forward-looking terminology (S14 renames Clients→Brands wholesale); references `clients.id`. The one-off naming mismatch with `campaigns.client_id` is intentional and disappears at S14.

**F. Metering is visibility-only — no cap in S10.** S10 records usage; it never gates an LLM call on accumulated spend. Any hard quota/cap is a separate later concern. Keep the hot paths un-gated.
