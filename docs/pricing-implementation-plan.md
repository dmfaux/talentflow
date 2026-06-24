# TalentStream — Usage-Based Billing: Implementation Plan

> Companion to `docs/pricing-model.md` (the numbers). Phased, file-level build plan grounded in the
> current code. Anchors are `path:line` at time of writing (2026-06-24) — re-confirm before editing.

## Guiding constraints (from the code)

- **Billable customer = the organization.** `usage_events.org_id` is `NOT NULL` (`schema.ts:797`);
  `organizations.tier` + `billing_email` are operator-owned (`schema.ts:26-27`). `clients.tier` is dead.
- **Metering is lossy by design** — `recordUsageEvent` is fire-and-forget (`usage.ts:43-59`). The *billed*
  number must come from a **frozen rollup**, never a live `SELECT SUM`.
- **Tenant reads must use `getApiTenant()` + `orgScope(usageEvents, ctx)`** (`api.ts:48-130`, `tenant.ts:204-221`).
  NEVER copy the operator raw-org-id path (it bypasses `orgScope` by design).
- **No scheduler exists** (`package.json:20` `jobs:poll` is a manual loop; same gap as the POPIA-purge TODO,
  `popia.ts:220-246`). This is the one piece of genuinely net-new infra.

---

## Phase 0 — Model migration (do first; time-critical)

`claude-sonnet-4-20250514` **retires 2026-06-15**. Migrate before anything else.

- `src/lib/ai/config.ts:40-58` — `DEFAULT_MODELS`: `anthropic` → `claude-sonnet-4-6`, `openai` keep,
  `openrouter` → `anthropic/claude-sonnet-4-6`.
- `src/db/seed.ts` — replace `claude-sonnet-4-20250514` seed references.
- Verify `.env.local` `AI_ANTHROPIC_MODEL=claude-haiku-4-5` is intended for dev (it is — that becomes the
  Essential tier model).

---

## Phase 1 — Schema (one migration via `drizzle-kit generate`)

New tables + columns in `src/db/schema.ts`. Drizzle/pg-core sketch:

```
plans                  (tier PK, base_fee_zar int, included_credits int, overage_discount_pct int,
                        hard_ceiling_credits int NULL)   -- credit sell price is global config: R1.20 ex VAT
model_tier_rates       (friendly_tier PK,           -- 'essential'|'professional'|'executive'|'_default'
                        internal_model_id text, credit_rate numeric, rank int)
                        -- credit_rate = billed credits per 1,000 normalised tokens: 0.4 / 1.0 / 2.5
                        -- (value-credit model — see docs/pricing-model.md). NOT a per-tier ZAR rate.
usage_rollups          (id, org_id FK→organizations CASCADE, period text,   -- 'YYYY-MM'
                        model_tier text, credits int, frozen_at timestamptz,
                        UNIQUE(org_id, period, model_tier))
invoices               (id, org_id FK CASCADE, invoice_no text UNIQUE, period_start, period_end,
                        currency 'ZAR', subtotal_ex_vat numeric, vat_amount numeric, total_incl_vat numeric,
                        status text,  -- draft|issued|paid|overdue|void
                        issued_at, due_at, paid_at NULL, eft_ref text NULL, created_at)
invoice_line_items     (id, invoice_id FK CASCADE, line_type text,  -- base|overage|chat|vat
                        model_tier text NULL, description text, quantity_credits int NULL,
                        unit_rate_zar numeric NULL, amount_zar numeric)
invoice_counters       (id PK=1, next_seq int)           -- or a pg SEQUENCE; gapless invoice_no
spend_alert_subscriptions (id, user_id FK→users CASCADE, org_id FK→organizations CASCADE,
                        alert_on_threshold bool, threshold_pct int NULL,
                        alert_on_summary bool, summary_cadence text NULL,  -- weekly|monthly
                        alert_on_hardcap bool, enabled bool default true,
                        unsubscribe_token text UNIQUE, last_alerted_period text NULL,
                        last_summary_sent_at timestamptz NULL, created_at, updated_at,
                        UNIQUE(user_id, org_id))
```

Columns on existing tables:
```
organizations: + max_model_tier text default 'executive'   -- all tiers open by default (owner's choice)
               + operator_max_model_tier text default 'executive'  -- the vendor cap (≥ org cap)
               + hard_ceiling_credits int NULL
campaigns:     + selected_model_tier text default 'professional'
usage_events:  + model_tier text NULL   -- stamped at write time; + index (org_id, model_tier)
```

Seed `plans` and `model_tier_rates` from `docs/pricing-model.md` §2/§4/§5. Include a `_default`
`model_tier_rates` row (Sonnet/Professional basis) so free-text/`unknown`/`local`/`openrouter` model
strings always price to a tier and never crash or read as R0.

---

## Phase 2 — Model-tier resolver + metering stamp (the margin lever)

1. **`src/lib/ai/resolve-tier.ts`** (new) — `resolveModelForTier(tier, callType)`:
   - `callType === 'chat'` → **always** return the Essential model id (hard pin). Stamp `model_tier='essential'`.
   - else → clamp `tier` to `min(operator_max_model_tier, org.max_model_tier)`, return that tier's model id.
   - Pure + unit-tested; clamping here is defence-in-depth against a stale Executive selection under a
     lowered cap.
2. **`src/lib/ai/providers.ts:154-210`** — thread an optional `modelOverride`/`tier` into `callWithFallback`
   so the Anthropic-first chain uses the tier's model instead of the env default. Fallback rows keep their
   env models but are billed at the selected tier's sell rate (tier = intelligence intent, not which
   provider answered).
3. **Call sites** pass the campaign tier + stamp `model_tier` on the usage event:
   - scoring `ai-scoring.ts:134,153-163`; re-score `ai-scoring.ts:506,539-549`; job-spec `from-job-spec:176-191`
     → `resolveModelForTier(campaign.selected_model_tier, 'scoring')`, stamp the resolved tier.
   - chat `chat/[conversationId]/route.ts:114-272` → `resolveModelForTier(_, 'chat')`, stamp `'essential'`.
4. Extend `UsageKind`/`recordUsageEvent` (`usage.ts:12-59`) to carry `model_tier`.

---

## Phase 3 — Spend read layer + role-based Usage & Spend page

1. **`src/lib/usage.ts`** — add **read** helpers (today it only writes):
   `getOrgSpend(ctx, range)`, `getCampaignSpend(ctx, campaignId)`, `getSpendProjection(ctx)`.
   - GROUP BY `model_tier` (fallback to deriving via `model_tier_rates` for legacy NULL rows) →
     sum credits = `(input + 5×output)/1000` → price per-tier in ZAR → draw down `plans.included_credits`
     → add 15% VAT. NULL-token rows = 0 credits (conservative). Chat rows bucket to the always-Essential line.
   - Projection: month-to-date run-rate off the `(org_id, created_at)` index — on-read, **no rollup needed**.
2. **`/api/admin/usage`** (new) — `getApiTenant()` + `authorizeApiOrg(ctx, 'view_spend')` +
   `orgScope(usageEvents, ctx)`. Returns credits + ZAR only (never raw cost/margin). Accepts
   `range` + optional `campaign_id` (ownership-checked).
3. **`src/app/(admin)/usage/page.tsx`** (new) — `'use client'`, fetch pattern of `dashboard/page.tsx:604-629`;
   reuse `StatCard`/`BarChart`/`AreaChart`/`DonutChart` (`dashboard/page.tsx:131-473`). StatCards (MTD ZAR incl
   VAT, credits, ≈candidates), per-tier DonutChart, projection-vs-ceiling AreaChart, per-period history,
   per-campaign table.
4. **RBAC** — add `view_spend` to `ACTION_MIN_ROLE` at `org_admin` (`rbac.ts:47-56`) + assert in
   `rbac.test.ts:35-52` (owner/org_admin allow; brand_admin/recruiter/viewer/null deny).
5. **Nav** — one `orgOnly: true` "Usage & Spend" item in `sidebar.tsx:9-15`.
6. **Per-campaign Spend tab** — sibling to `campaigns/[id]/analytics/route.ts`; chat cost LEFT JOINs
   `candidates` (chat rows carry `candidate_id`, not `campaign_id`).
7. **Operator god-view** — extend `operator/page.tsx:163-206` + `operator/orgs/[id]/page.tsx:163-387` with
   credits + billed ZAR + **raw cost + margin** (operator shell ONLY).

**Viral-cap UX (owner's requirement):** the projection card shows in-flight count and **R-cost to finish**
("X candidates still in process ≈ R Y to complete") with explicit **[Let them finish] / [Pause now]** — the
ceiling pauses *new* intake (graceful drain) but the client decides and sees the cost before proceeding.

---

## Phase 4 — Spend ceiling enforcement (the downside cap)

Today there is **no** throttle on scoring/chat (`process-candidate.ts:104-105`, `jobs/process/route.ts:100-131`).

- Add a `creditsThisPeriod(orgId)` check before enqueuing/scoring a candidate. At ≥ `hard_ceiling_credits`,
  **pause new intake** (skip enqueue) but let in-flight scoring + open chats drain.
- Surface the paused state + in-flight count/cost to the Usage page and via a "ceiling reached" alert.
- Fast operator/org cap-raise path (also an upsell).

---

## Phase 5 — Spend email notifications (opt-in)

1. **`spend_alert_subscriptions`** table (Phase 1). Self-service GET/PUT `/api/admin/spend-subscription`
   (`getApiTenant` + `view_spend`; user manages only their own row).
2. **`SpendAlertCard`** on Settings (`settings/page.tsx:96-309`), gated by `canManageOrg`.
3. **`spendAlertEmail`** HTML builder mirroring `passwordResetEmail`/`invitationEmail` (`email.ts:621-660`),
   sent via unmetered `sendTransactionalEmail` (`email.ts:118-143`). Variants: threshold / summary / hard-cap.
   One-click unsubscribe link (`/api/spend-alert/unsubscribe?token=…`, public, token-only).
4. Driven by the Phase 6 sweep; `last_alerted_period` makes each threshold fire once per period.

---

## Phase 6 — Invoicing (no payment processor) + the scheduler

1. **Scheduler** (the gating decision). Pick one: **Vercel Cron** (`vercel.ts` `crons`), an Azure Container
   Apps scheduled task, or an external tick hitting a secret-gated route (mirrors `jobs/process` `x-worker-secret`).
   Add an **org-scoped `JobPayload` variant** (every current variant is candidate-scoped; `worker.ts:31-53`
   resolves org via `candidateId`) + an org-active gate that needs no candidate. This also finally closes the
   POPIA-purge cron TODO.
2. **`/api/jobs/billing-close`** — per active org: freeze `usage_events` for the period into `usage_rollups`
   by `(period, model_tier)`, idempotent per `(org_id, period)`. NULL tokens = 0; chat → Essential line.
3. **Price** — convert each row's base units to billed credits via `model_tier_rates.credit_rate`,
   draw the single included-credit allowance down, then `overage_credits × R1.20 × (1 − discount)`; +15% VAT.
4. **Write** `invoices` + `invoice_line_items`: base line, one overage line per model tier, a **separate
   always-base chat line**, a VAT line. Gapless `invoice_no` via `invoice_counters` `SELECT … FOR UPDATE`
   (or a pg SEQUENCE) inside the txn.
5. **Deliver** — `invoiceEmail` HTML builder → `sendTransactionalEmail` to `billing_email`. SA tax-invoice
   fields (VAT no., 15% line, issue/due dates, EFT banking details). PDF deferrable.
6. **Reconcile** — operator-only `markInvoicePaid` route mirroring `operator/organizations/[id]/route.ts:176-254`;
   sets `status='paid'`, `paid_at`, `eft_ref`; audited in `operator_audit` (new free-text actions
   `issue_invoice`/`mark_invoice_paid`/`void_invoice`, `schema.ts:842-847`).
7. **Overdue** — same sweep flips past-due `issued` → `overdue`, emails a reminder, and after a grace window
   sets `org.status='suspended'` (`schema.ts:33-34`) via the existing lifecycle gate (`tenant.ts:71-84`).
   Marking paid reactivates.
8. **`/api/admin/invoices`** + `(admin)/billing` page (tenant statement) — `getApiTenant` + `orgScope(invoices)`.

---

## Phase 7 — Durability hardening

Billed number = frozen `usage_rollups` reconcile (tolerates small leakage from fire-and-forget metering).
Optionally upgrade the scoring usage write to transactional alongside `scoring_logs` (`ai-scoring.ts:207-224`).
Quantify expected leakage first before investing.

---

## Test scenarios (vitest + *.itest.ts)

- **Credit math** — (input + 5×output)/1000 base units → billed credits via tier rate (0.4/1.0/2.5) →
  ZAR at R1.20/credit; NULL-token rows = 0; `_default` fallback prices unknown/local/openrouter models.
  Pure helpers covered by `src/lib/pricing.test.ts`.
- **Tier resolver** — chat always Essential across all 3 chat calls; clamp stale Executive under lowered cap;
  precedence operator > org > campaign.
- **RBAC** — `view_spend` matrix (owner/org_admin allow; others deny); acting operator passes but tenant view
  hides raw cost/margin.
- **Tenant isolation** (`*.itest.ts`, throwaway `interview_insider_test`) — org A cannot read org B spend;
  `/api/admin/usage` uses `orgScope`, not the operator bypass.
- **Ceiling** — new intake pauses at ceiling; in-flight drains; cap-raise resumes.
- **Invoicing** — idempotent close per `(org, period)`; gapless `invoice_no` under concurrent close;
  per-tier + chat + VAT lines; candidate purge (`SET NULL`) doesn't alter a frozen invoice.
- **Notifications** — threshold fires once per period (`last_alerted_period`); unsubscribe no-ops gracefully.

---

## Suggested order

Phase 0 (now, time-critical) → 1 → 2 (margin lever, demoable) → 3 (visible value) → 4 → 5 → 6 (needs scheduler) → 7.
Phases 2–3 are a shippable first increment: selectable tiers + a role-based spend view reading existing
telemetry, no invoicing required.
