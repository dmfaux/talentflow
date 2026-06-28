# Implementation Spec: Recruiter-added candidates (manual add to a campaign)

**Generated**: 2026-06-27
**Codebase snapshot**: `main` @ `420fafc`
**Change type**: UI/UX (recruiter modal + form changes) **and** Backend (endpoints, schema, email, audit)

---

## Implementation status

- **Phase 1 — backend core: DELIVERED** (branch `feat/recruiter-added-candidates`). Migration `0042_whole_owl.sql` (6 additive nullable columns + the `consent_attested_by` FK); `src/lib/consent.ts` (versioned attestation registry + pure `validateConsent`); `src/lib/manual-candidate.ts` (gating decision, skip/invite orchestration, invite-token issuance, six audit-event writers, dedup + post-action hooks); `chat-auth.ts` token fixes (parameterised TTL + non-consuming verify); `process-candidate.ts` pasted-`cv_text` short-circuit. Tests: `consent.test.ts` (7 unit) + `manual-candidate.itest.ts` (11, DB-backed) green; full integration suite 222/222.
- **Deferred from phase 1:** the race-safe DB unique constraint on `(campaign_id, email)` — adding it to existing data risks failing on pre-existing duplicates, so it needs a production duplicate-audit first. v1 uses the app-level dedup check (`findCampaignCandidateByEmail`); all writers lowercase email, so a later plain `unique(campaign_id, email)` will suffice once the data is clean.
- **Phase 2 — steps 1–2: DELIVERED.** Email: `recruiterInvite` + `recruiterAddedNotice` templates (`email.ts`) + type/subject registry entries (`email-slots.ts`, `theme-copy.ts`); the added-notice carries a POPIA opt-out link. Endpoint: `POST /api/admin/campaigns/[id]/candidates` (added beside the existing GET) — auth (`recruiter+`), active/paused guard, dedup (409), multipart/JSON CV (file→`uploadCV` via the deferred `uploadCv` callback, or pasted text), consent validation, both paths wired to `manual-candidate.ts`, branded email send, and `candidate_notified` audit. `addCandidateBySkip` refactored from a ready `cvUrl` to a deferred `uploadCv(candidateId)` callback (blob path is candidate-id-keyed). Tests: `email.test.ts`/`theme-copy.test.ts` updated (2 new snapshots) + `manual-candidate-route.itest.ts` (8, DB-backed: both paths, multipart file, dedup, closed-campaign 409, viewer 403, no-CV/bad-consent 400). Full suites green: 435 unit, 230 integration.
- **Phase 2 — steps 3–4 (next):** invite-completion in the public apply route (`?invite=` token upgrade), `opt-out` endpoint (reuses the persistent chat token via `?t=`), `resend-invite`, the `consent_confirmed` hook on chat verify, and the POPIA audit CSV export.
- **Phase 3 (after):** the UI — add-candidate modal, campaign-page button, candidate-table `invited`/`recruiter_manual` affordances, `ApplicationForm` `?invite=` handling (mandatory `frontend-design` skill).

---

## Codebase Analysis

The whole feature is a controlled variant of the existing **public application flow**, so most of it is mirroring patterns that already exist.

- **Candidate creation today** lives in `src/app/api/apply/[clientSlug]/[campaignSlug]/route.ts`. It: resolves the campaign by slug, refuses unless `status === "active"`, validates name/email/POPIA, dedupes by `(campaign_id, email)`, runs `evaluateGating`, inserts the `candidates` row with `status: gating_passed ? "gating_passed" : "gating_failed"`, stamps `popia_consent_at = now` and `data_purge_at = now + 12 months`, generates a chat token, uploads the CV, sends the application-received email, and enqueues `{ type: "candidate-processing" }` when a CV is stored and the org is under its spend ceiling. **This is the reference implementation for the skip path.**
- **`candidates`** (`src/db/schema.ts:312-373`) — `status` and `gating_passed` already exist; `status` is a free-text `text` column (no PG enum), so new status values need **no migration**, only code constants. `source`, `popia_consent_at`, `data_purge_at`, `chat_token_hash` all exist. New consent/attestation columns and an invite-token reference are the only schema additions.
- **Gating** (`src/lib/gating.ts`) — `evaluateGating(answers, gatingConfig)` returns a boolean; every question must be answered with a value in its `pass_criteria`. Reused as-is on the "recruiter answers gating" branch.
- **Human-in-the-loop audit** (`src/lib/rejection.ts`) — the canonical pattern to mirror: a focused module that owns state transitions and appends `candidateActionAudit` rows. `getCandidateAuditTrail(candidateId)` already resolves actor name/email for the detail UI. `action` is free-text `text` (`schema.ts:968`), so the six new event names need **no migration**.
- **`candidate_action_audit`** (`src/db/schema.ts:955-1004`) — columns `org_id`, `candidate_id` (`onDelete: set null`, survives POPIA purge), `actor_user_id` (`null` = system/AI), `action`, `from_status`, `to_status`, `reason`, `reason_sent_to_candidate`, `metadata` (jsonb). The six events all fit this shape; the attestation wording/version and gating answers go in `metadata`. **No new columns on this table.**
- **Auth** — API routes use `getApiTenant()` → `{ ctx, response }` then `authorizeApiBrand(ctx, clientId, "recruiter")` (returns a denial `Response` or `null`); see `src/app/api/admin/candidates/[id]/rejection/route.ts`. RSC pages use `canAccessBrand(ctx, clientId, "recruiter")` for cosmetic gating. Role ranks live in `src/lib/rbac.ts` (`recruiter: 1`, `viewer: 0`); `can("manage_candidate", role)` is `recruiter+` — the exact gate this feature needs.
- **Magic-link tokens** — `generateMagicLinkToken()` / `verifyMagicLinkToken(raw)` in `src/lib/chat-auth.ts`, backed by the `chat_tokens` table (`schema.ts:615`: `candidate_id`, `org_id`, `token_hash`, `expires_at`, `used_at`). **Caveat:** `MAGIC_LINK_TTL_MS` is hardcoded to 1 hour and `verifyMagicLinkToken` consumes (`used_at`) on first read — both need adjusting for a 14-day, GET-viewable invite (see API section). Issued today in `src/app/api/chat/request-access/route.ts:69`.
- **Email** (`src/lib/email.ts`) — `sendCandidateEmail(to, subject, html, candidateId, brandIdentity)` is metered/branded and writes a `messages` row (its id is what `candidate_notified` should record). Templates are functions returning HTML (`applicationReceivedEmail`, `gatingPassedEmail`, `invitationEmail` — note the existing one is a *staff* invite). Subjects resolve via `resolveEmailSubject(type, data)` against `DEFAULT_EMAIL_COPY.perType[type]`, so two new `EmailTemplateType` keys are needed.
- **Admin UI** — campaign detail at `src/app/(admin)/campaigns/[id]/page.tsx` already computes `canManageCampaign = canAccessBrand(ctx, campaign.client_id, "recruiter")` and renders `CampaignActions` + `CandidateTable`. The "Add candidate" button belongs next to `CampaignActions`, gated on `canManageCampaign && (status === "active" || status === "paused")`. `src/components/admin/candidate-actions.tsx` is the established client-component pattern (fetch → toast → `router.refresh()`).

## Related Issues

No formal issue tracker is wired into this repo (specs live in `docs/`, e.g. `campaign-themes-spec.md`). Relationships to existing delivered work:

### Assumptions from siblings
- **Human-in-loop rejection** (`candidate_action_audit`, migration 0040) is **already delivered** — extend it; do not rebuild the audit table.
- **Usage-based pricing / spend ceiling** (`getCeilingStatus`, migrations 0038/0039) is delivered — the skip path must respect it exactly like the public path (hold at `gating_passed`, no job, when `over`).
- **POPIA purge** (`data_purge_at`, `purged_at`, `org-purge`) is delivered — opt-out reuses the existing purge machinery rather than inventing deletion.
- No sibling is building manual-add, invite tokens, or the consent-attestation surface — those are net new here.

## Implementation Plan

### Database Changes

Generate with the project's drizzle-kit flow (do **not** hand-name the file); the next sequence number is **`drizzle/0042_*.sql`**. Add to `candidates` in `src/db/schema.ts`:

```sql
-- candidates: provenance of the gating decision on manual adds
ALTER TABLE "candidates" ADD COLUMN "gating_source" text;          -- null = public/self-answered; "recruiter_override" | "recruiter_answered"
-- Recruiter consent attestation (skip path). popia_consent_at stays NULL until the candidate confirms.
ALTER TABLE "candidates" ADD COLUMN "consent_attested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "candidates" ADD COLUMN "consent_attested_at" timestamp;
ALTER TABLE "candidates" ADD COLUMN "consent_basis" text;          -- verbal | written | prior_application | existing_relationship | other
ALTER TABLE "candidates" ADD COLUMN "consent_basis_note" text;     -- required when consent_basis = 'other'
-- Invite path: link the 14-day invite token + its expiry for the "invite pending / resend" control.
ALTER TABLE "candidates" ADD COLUMN "invite_expires_at" timestamp;
```

Notes:
- **No PG enum changes.** `candidates.status` and `candidate_action_audit.action` are free-text; new values are TS constants only.
- **Invite token storage:** reuse the existing `chat_tokens` table (it already maps `token → candidate_id` with `expires_at`/`used_at`) as the **source of truth for validity**. `invite_expires_at` on the candidate is a **deliberate denormalised mirror** (decision: keep it) so the recruiter list renders "invite pending / expired" with no join — consistent with how the codebase denormalises `org_id`. Keep the two in sync wherever a token is issued or resent.
- `consent_basis` is validated against the `ConsentBasis` string-union in `src/lib/consent.ts` (not a DB check constraint) — matches the codebase's "validate in code" convention.

### New status values (free-text, no migration)

Add to a shared constants location (e.g. extend the candidate-status union near the schema or in `src/lib/rejection.ts`'s neighbourhood):

- **`invited`** — stub created by the invite path; awaiting the candidate to complete the public form. Not counted as "applied" in `totalApplied`/`passedGating` roll-ups in `campaigns/[id]/page.tsx` (audit those reducers and exclude `invited`).
- Skip-path and completed-invite candidates reuse existing statuses (`gating_passed` / `gating_failed` / downstream scoring states) — **no new state needed there**.
- **`withdrawn`** already exists and is the opt-out target.

State machine additions:

```
(invite path)  ──create──▶ invited ──candidate submits form──▶ gating_passed | gating_failed ─▶ (normal pipeline)
                                  └──14d no completion──▶ invited (expired flag via invite_expires_at; recruiter resends or it lingers)
(skip path)    ──create + CV + attest──▶ gating_passed | gating_failed ─▶ (normal pipeline, auto-scored)
(opt-out)      any active status ──candidate clicks opt-out──▶ withdrawn ─▶ data purge
```

### API / Backend Changes

Put the shared logic in a new module **`src/lib/manual-candidate.ts`** (mirroring `rejection.ts`): it owns the insert, the consent record, the six audit writes, the email dispatch, and token issuance, so both the route and tests call one place.

**1. Recruiter add — `POST /api/admin/campaigns/[id]/candidates`** (new: `src/app/api/admin/campaigns/[id]/candidates/route.ts`)

- Auth: `getApiTenant()` → load campaign org-scoped (`orgScope(campaigns, ctx)`) → `authorizeApiBrand(ctx, campaign.client_id, "recruiter")`.
- Guard: `409` unless `campaign.status` is `active` or `paused`.
- Dedup: reject `409` if `(campaign_id, email)` already exists (mirror `apply/route.ts:137-141`), returning the existing candidate id so the UI can link to it.
- Body (JSON or multipart when a CV file is attached):
  ```jsonc
  {
    "path": "invite" | "skip",
    "name": "…", "email": "…", "phone": "…?",
    // skip only:
    "cv_text": "…?",                 // OR a multipart "cv" file; one is REQUIRED on skip
    "gating": { "<qid>": "<value>" } | null,   // null ⇒ recruiter_override
    "consent": { "basis": "verbal|written|prior_application|existing_relationship|other", "note": "…?", "attestation_version": "v1" }
  }
  ```
- **Invite path:** insert stub `{ status: "invited", source: "recruiter_manual", popia_consent_at: null, data_purge_at: now+12mo }`; issue a 14-day token (see token note); set `invite_expires_at`; send the branded invite email; audit `manual_add` (`to_status: invited`, `metadata: { path: "invite" }`) and `candidate_notified`. No gating/CV/consent rows yet.
- **Skip path:** require a CV (`cv_text` non-empty **or** an uploaded file → `uploadCV`); `400` if neither. Compute `gating_passed`:
  - `gating == null` → `gating_passed = true`, `gating_source = "recruiter_override"`.
  - `gating` provided → `gating_passed = evaluateGating(gating, campaign.gating_config)`, `gating_source = "recruiter_answered"` (a vouched candidate **can** `gating_fail`).
  Insert with `popia_consent_at: null`, `consent_attested_by: ctx.userId`, `consent_attested_at: now`, `consent_basis`, `consent_basis_note`, `source: "recruiter_manual"`, `data_purge_at: now+12mo`, `status: gating_passed ? "gating_passed" : "gating_failed"`. Generate chat token. Then mirror `apply/route.ts:233-258`: if `gating_passed && cvStored && !getCeilingStatus().over` enqueue `candidate-processing`. Send the "you've been added" notice. Audit **all** of: `manual_add`, `consent_attested` (`metadata: { basis, note, attestation_version, wording }`), `gating_recorded` (`metadata: { gating_source, answers }`), `cv_provided` (`metadata: { provenance: "file"|"paste", filename? }`), `candidate_notified` (`metadata: { kind: "added_notice", message_id }`).
- Validation rules: `name`/`email` as in the public route (reuse `EMAIL_RE`); `consent.basis` required and in-set on skip; `consent.note` required when `basis === "other"`; `400` on a skip with no CV.

**2. Invite completion** — extend `POST /api/apply/[clientSlug]/[campaignSlug]/route.ts` with an optional `invite_token`:
- When present and valid, **UPDATE the existing stub** (resolve `candidate_id` from the token) instead of inserting; skip the dedup check; flip `invited → gating_passed|gating_failed`; set real `popia_consent_at = now` (candidate consented on the form themselves); store gating/CV; consume the token (`used_at`). Enqueue processing as normal. No `consent_attested`/`consent_basis` (this is real first-party consent). Audit `consent_confirmed` is **not** needed here — that event is reserved for the skip-path candidate later confirming; on invite completion, `popia_consent_at` is simply set.
- **Token caveats to fix in `chat-auth.ts`:** (a) parameterise the TTL — add `generateMagicLinkToken(ttlMs = MAGIC_LINK_TTL_MS)` and pass 14 days; (b) the form must be *viewable* before submission, so add a non-consuming `verifyMagicLinkToken(raw, { consume: false })` for the GET that renders the form, and only consume on the successful POST. Today's function consumes on first call, which would burn the link when the candidate merely opens it.

**3. Skip-path consent confirmation** — when a skip-path candidate first follows the "you've been added" CTA or first authenticates to chat, set `popia_consent_at = now` (if still null) and audit `consent_confirmed`. Hook this into the existing chat-access/verify path (`src/app/api/chat/verify/route.ts`) guarded by `source === "recruiter_manual" && popia_consent_at === null`.

**4. Opt-out (POPIA objection)** — `POST /api/candidates/opt-out/[token]` (public, token-based, new route): resolve token → candidate, set `status = "withdrawn"`, trigger the existing data-purge path (set/observe `data_purge_at`; reuse the org-purge machinery), audit a `manual_add`-sibling event (suggest action `opt_out`). Return a simple confirmation page. The opt-out link is embedded in the skip-path notice email.

**5. Resend invite** — `POST /api/admin/candidates/[id]/resend-invite` (new): recruiter+; only valid while `status === "invited"`; re-issue token, bump `invite_expires_at`, resend invite email, audit `candidate_notified`.

**New audit action values** (free-text, mirror `REJECTION_AUDIT_ACTIONS`): `manual_add`, `consent_attested`, `gating_recorded`, `cv_provided`, `candidate_notified`, `consent_confirmed`, `opt_out`. Add a `MANUAL_ADD_AUDIT_ACTIONS` const in `manual-candidate.ts`.

**POPIA export** — add `GET /api/admin/candidates/[id]/audit/export` returning **CSV** of `getCandidateAuditTrail(id)`; recruiter+; org-scoped. The trail already resolves actor name/email; just serialise. **CSV is the v1 deliverable** (portable + machine-readable, which is what POPIA subject-access needs); a rendered PDF is deferred as presentation polish.

### Consent attestation wording (the source of truth)

Lives as a **versioned code constant**, not a CMS field — new module `src/lib/consent.ts`:

```ts
export const CONSENT_ATTESTATIONS = {
  v1: "I confirm I have the candidate's consent to add them to this campaign and to process their personal information for recruitment purposes under POPIA.",
} as const;
export type AttestationVersion = keyof typeof CONSENT_ATTESTATIONS;
export const CURRENT_ATTESTATION: AttestationVersion = "v1";

export const CONSENT_BASES = ["verbal", "written", "prior_application", "existing_relationship", "other"] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];
```

The skip-path `consent_attested` audit row stores **both** `attestation_version` **and** the verbatim `wording` (`CONSENT_ATTESTATIONS[version]`) in `metadata`, so a later edit to the copy can never retroactively change what a recruiter agreed to. No column on `candidates` is needed for the wording — the audit row is the legal record. Adding a `v2` is append-only; never mutate an existing entry. The modal renders `CONSENT_ATTESTATIONS[CURRENT_ATTESTATION]` and submits `CURRENT_ATTESTATION`; the server validates the submitted version is a known key and re-derives the wording server-side (never trusts client-sent wording).

### Frontend Changes

> **The `frontend-design` skill MUST be used when implementing these UI changes.** It is mandatory for consistency with the project's design system (the shared `ui/*` primitives + Modal shell noted in the rebrand foundation).

- **Add-candidate entry point** — a button beside `CampaignActions` in `src/app/(admin)/campaigns/[id]/page.tsx`, rendered only when `canManageCampaign && (campaign.status === "active" || campaign.status === "paused")`.
- **New client component `src/components/admin/add-candidate-modal.tsx`** (pattern: `candidate-actions.tsx` — `useState`, `useToast`, `fetch`, `router.refresh()`):
  - Step 1: name + email + a path toggle (**Invite to apply** / **Add directly**).
  - Invite branch: nothing more required; submit.
  - Skip branch: **required** CV (file upload *or* a "paste CV text" textarea — mirror the dual input the backend accepts); an optional "Answer screening questions" expander rendering `campaign.gating_config` (reuse the select/radio rendering from `ApplicationForm.tsx`); a **required** consent block — attestation checkbox with the exact wording (carry `attestation_version`) + a `consent_basis` picklist + a conditional note field when "other".
  - Submit as multipart when a file is attached, else JSON.
- **Candidate table** — surface `status === "invited"` rows with an "Invite pending" badge and a "Resend"/"Expired" affordance (reads `invite_expires_at`); reuse `STATUS_TONE`. Add a `source === "recruiter_manual"` indicator/filter so recruiter-sourced candidates are reportable.
- **Public form** — `ApplicationForm.tsx` must accept an `?invite=<token>` query param, pass it through on submit, and pre-fill name/email from the stub (a small loader resolving the token via the non-consuming verify).

### Edge Cases and Boundary Conditions

- Skip path with neither CV file nor `cv_text` → `400` (must use invite path).
- `gating_source = "recruiter_answered"` that fails → candidate lands in `gating_failed`; do **not** enqueue scoring; recruiter should see why.
- Duplicate `(campaign_id, email)` → `409` + link to existing; never a second row.
- Campaign flips to `closed`/`archived` between modal open and submit → server `409` (re-check status server-side; don't trust the client gate).
- Invite never completed within 14 days → token invalid; stub stays `invited` with an "expired" indicator; resend re-issues. **Decision: expired stubs are not swept** — they hold the dedup slot and the "we invited them" trail, and the existing 12-month `data_purge_at` POPIA purge eventually removes them, so no new cron is added.
- Invite link opened (GET) must **not** consume the token; only a successful submit consumes it (the `chat-auth` fix above).
- Opt-out after the candidate already engaged/was scored → still `withdrawn` + purge; audit captures prior status in `from_status`.
- Spend ceiling `over` on the skip path → insert at `gating_passed` with **no** job (a cap-raise drains it), exactly like the public path.
- Org suspended/deleted → the admin surface is already behind the tenant seam, but assert `getOrgStatus` defensively before sending candidate-facing email.
- `consent_basis = "other"` with empty note → `400`.
- Two recruiters adding the same email near-simultaneously → v1 relies on the app-level `findCampaignCandidateByEmail` check (read-then-write, technically racy). The race-safe DB `unique(campaign_id, email)` constraint is **deferred** until a production duplicate-audit confirms no existing collisions (adding it blind would fail the migration); all writers lowercase email, so a plain unique suffices when added.

### Test Plan

Follow existing patterns: unit tests as `*.test.ts` (e.g. `email.test.ts`, `rbac` tests) and DB-touching tests as `*.itest.ts` (**these wipe ALL tables — run only against the throwaway `interview_insider_test` DB, per project memory**).

- **Unit (`src/lib/manual-candidate.test.ts`)**: gating decision matrix (override vs answered-pass vs answered-fail); CV-required guard; consent-basis validation incl. `other`→note-required; the six audit rows are written with correct `from/to_status` and metadata; `source` stamped `recruiter_manual`; `popia_consent_at` stays null on skip.
- **Unit (`chat-auth.test.ts`)**: TTL parameterisation (14-day expiry); non-consuming verify leaves `used_at` null; consume marks it; expired token rejected.
- **Integration (`*.itest.ts`)**: `POST .../candidates` invite path creates `invited` stub + issues token + sends invite (assert a `messages` row); skip path with CV enqueues `candidate-processing`; skip path under spend ceiling does **not** enqueue; dedup returns `409`; non-active campaign returns `409`; `viewer` role denied; invite-completion upgrades the stub (no second row) and sets real `popia_consent_at`; opt-out → `withdrawn` + purge scheduled + audit row.
- **RBAC**: `recruiter`/`brand_admin`/`operator` allowed; `viewer` denied on add, resend, and export.
- **Export**: audit CSV contains all six event types with resolved actor identity.

### Suggested Implementation Order

1. Schema + migration `0042` (new candidate columns; partial unique index on `(campaign_id, lower(email))`); status/action constants.
2. `chat-auth.ts` token fixes (parameterised TTL + non-consuming verify).
3. `src/lib/manual-candidate.ts` — insert, consent record, six audit writes, token issuance, email dispatch (unit-tested first, like `rejection.ts`).
4. Two new email templates + `EmailTemplateType`/subject keys (invite; "you've been added" notice with opt-out link).
5. `POST /api/admin/campaigns/[id]/candidates` route.
6. Invite-completion changes in the public `apply` route + `ApplicationForm` `?invite=` handling.
7. Skip-path `consent_confirmed` hook in chat verify; opt-out route; resend-invite route.
8. UI: add-candidate modal + campaign-page button + candidate-table `invited`/`recruiter_manual` affordances (**with the `frontend-design` skill**).
9. POPIA audit export endpoint.
10. Tests across the layers; verify against the throwaway test DB.

### Resolved Decisions (v1)

All four prior open questions are now settled and reflected in the body above:

1. **Attestation wording** → versioned code constant in `src/lib/consent.ts` (`CONSENT_ATTESTATIONS` + `CURRENT_ATTESTATION`); the `consent_attested` audit row stores version **and** verbatim wording, so copy edits never rewrite history. Server re-derives wording from the version; never trusts client-sent text. Adding `v2` is append-only.
2. **Expired invite stubs** → not swept; they hold the dedup slot and the audit trail, and the existing 12-month `data_purge_at` purge eventually removes them. Recruiter resends on demand.
3. **Audit export** → CSV only for v1 (satisfies POPIA subject-access); PDF deferred.
4. **`invite_expires_at`** → denormalised onto `candidates` for list rendering; `chat_tokens` remains the validity source of truth, kept in sync on issue/resend.

No remaining blockers — ready to implement in the order above.
