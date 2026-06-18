# S9 · 🎨 Operator org provisioning + org/brand settings

> **Phase 2 — Operate + onboard the tenant model**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** complete onboarding (decision 5): operators provision org + first Owner; Owners self-serve org/brand settings.
- **Backend:** POST `/api/operator/organizations` (`requireOperator`) → create org + issue an org-level Owner invite (S8 mechanism). PATCH `/api/admin/organization` (owner/org_admin) for name/contact (tier/billing operator-only). Extend `clients` PATCH for brand branding/slug/careers fields (brand_admin/owner). Rework `seed-admin.ts` → operator + org + first Owner + memberships (replace `SEED_ADMIN_CLIENT_SLUG` single-tenant assumption).
- **Frontend:** 🎨 operator "New organization" form (name, slug, tier, owner email) + resend-invite; `(admin)/settings/page.tsx` org + active-brand settings (tier read-only for owners); repurpose `(admin)/clients/*` as brand management.
- **Acceptance:** operator creates Org B with Owner who accepts/logs in to a fully isolated, empty, self-controlled org; owner/org_admin create/edit brands in their org only (slug global-unique); tier/billing operator-only; non-operators 403 on provisioning; seed-admin yields a clean operator + demo org + Owner.
- **Depends on:** S7, S8 · **Risks:** Owner invite is the only bootstrap (resend + expiry); provisioning is powerful (`requireOperator` + audited); keep org-slug vs brand-slug distinct.

---

# Implementation Spec: S9 · Operator org provisioning + org/brand settings

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `37592e0` ("Add operator console + audited impersonation (act-as) (S7)"). The branch name is stale; commits run through **S7 (landed)**. Latest migration in tree: `0027_robust_paladin.sql` (S7 `operator_audit`). **S8 is in flight — its code is NOT yet in the tree** (no `invitations` table, no invite/accept routes, no `activeBrandId`/`TenantProvider`/`BrandSwitcher`).
**Change type**: **UI/UX** (operator "New organization" form + resend-invite, org/active-brand settings page, repurposed brand-management pages) **and** backend (`POST /api/operator/organizations`, `GET`+`PATCH /api/admin/organization`, `clients` PATCH RBAC split + `clients` GET org-scoping, `seed-admin.ts` rework, `provision_org` audit). The `frontend-design` skill is **mandatory** for every screen below — see Frontend Changes.

> **Dependency status — S9 hard-depends on S8, which is being delivered now; the two share `schema.ts`, `email.ts`, and the invite mechanism.** `Depends on: S7, S8` is real, not nominal.
> - **S7 (landed, `37592e0`).** S9 builds directly on S7's operator surface: `requireApiOperator()` (`src/lib/api.ts:62`), the `operator_audit` table + `recordOperatorAudit`/`OPERATOR_AUDIT_ACTIONS` (`src/lib/operator-audit.ts`), the operator shell (`src/app/operator/layout.tsx`), the org **list** page (`src/app/operator/page.tsx`), the org **detail** page (`src/app/operator/orgs/[id]/page.tsx`), and `GET`+`PATCH /api/operator/organizations/[id]` (tier/billing, already audited). S9 *adds* the missing `POST` (provision) and the new-org form; everything operator-side is additive on top of landed S7 code.
> - **S8 (in flight — the critical dependency).** S9 cannot create the first Owner without S8's **invitation mechanism**. S9 specifically consumes: (a) the **`invitations` table** (S8 migration `0028`) with the `client_id`-nullable + `org_role` *org-level* invite path — **S8's spec (Resolved Decision 1 + the S9 note at its line 63) introduced that path expressly for S9**; (b) the **`users.client_id` NOT-NULL relaxation** (S8 Resolved Decision 1) so the seed + an org-level Owner can exist brand-less; (c) the **invite-accept route** `POST /api/auth/invite/accept` (public) the provisioned Owner uses to set a password + sign in; (d) the **`invitationEmail` template** in `email.ts`; (e) S8's **sidebar nav gating + Settings/Brands visibility** and **`TenantProvider`/`useTenant()`/`activeBrandId`/BrandSwitcher** that the Settings page and brand-management repurpose read.
> - **THE coordination point — a reusable invite helper.** S8's spec ships invite creation **inside the route handler** `POST /api/admin/members/invite`, gated by `authorizeApiOrg(ctx, "manage_member")`. **An operator has `orgRole: null` and would FAIL that gate**, and the operator's invite must stamp the *new* org's id (the operator has no `orgId`). So S9 must call the invite-creation core **without** going through that org-RBAC route. **Coordinate with S8 to extract the create logic into `src/lib/invitations.ts`** — e.g. `createInvitationRow({ orgId, email, clientId, orgRole, brandRole, invitedBy })` (insert + supersede + the global-email guard, returns `{ invitation, rawToken }`) plus `sendInviteEmail(email, orgName, inviterName, acceptUrl)` — so both `POST /api/admin/members/invite` (S8) and `POST /api/operator/organizations` (S9) share one verified code path. **If S8 lands the logic only inline, S9 performs the extraction** (refactor S8's route to call the shared helper); it is small and keeps both call sites DRY.
> - **Sequencing.** Build S9 on a branch **rebased onto S8**. The merge-conflict surfaces are `src/db/schema.ts` (S8 adds `invitations` + relaxes `users.client_id`; S9 adds org-contact columns) and `src/lib/email.ts` (S8 adds `invitationEmail`; S9 reuses it). Do not develop S9's schema/seam-adjacent changes against the pre-S8 tree. If S8 has not merged when S9's migration is generated it auto-numbers to `0028` and collides with S8 — renumber on rebase (see Database Changes).

> **AGENTS.md mandate.** This is a modified Next.js 16.2.2. S9 adds operator-only route handlers that **create tenants and mint a credential-granting invite**, and a public-facing onboarding path completed by S8's accept route. **Before writing route-handler / cookie / `redirect` / `db.transaction` code, read the relevant guides under `node_modules/next/dist/docs/`** — the response/cookie/navigation APIs may differ from training data. Heed deprecation notices. (Audited operator mutations follow the landed `PATCH /api/operator/organizations/[id]` precedent: `requireApiOperator` → mutate → `recordOperatorAudit({…, endedAt: now})`.)

---

## Codebase Analysis

S9 is the slice that **closes the onboarding loop**: an operator provisions an empty, isolated org + its first Owner; the Owner accepts (via S8), logs in, and self-serves org/brand settings. Almost every primitive already exists from S1–S7 (landed) and S8 (in flight); S9 is mostly **wiring + two small additive surfaces** (org `POST`/provision, org-settings `PATCH`).

**The operator org route has a `GET` but no `POST`.** `src/app/api/operator/organizations/route.ts` exposes only `GET` (list/search across all orgs, deliberately unscoped behind `requireApiOperator`, `:12-61`). **S9 adds the `POST`** to the same file. `src/app/api/operator/organizations/[id]/route.ts` already has the operator `GET` (org + derived counts, `:17-60`) and **`PATCH` (tier/billing, audited `set_tier`/`set_billing_email`, `:67-150`)** — so the *operator-only* tier/billing edit the slice calls for **already exists** (S7). S9 *extends* the `[id]` `GET` to surface onboarding status (pending Owner invite vs accepted Owner) for the resend UI, and adds a resend endpoint.

**The operator audit is ready for `provision_org` with no migration.** `operator_audit.action` is open free-text validated against the in-code `OPERATOR_AUDIT_ACTIONS` allow-list (`src/lib/operator-audit.ts:11-16`) — the schema comment (`schema.ts:601`, `610-611`) explicitly says *"S9 adds provision_org … without a migration"*. S9 appends `"provision_org"` to that array and calls the existing `recordOperatorAudit({ operatorUserId, action, targetOrgId, metadata, ip, endedAt })` helper (`operator-audit.ts:33-49`), mirroring the point-in-time `set_tier` audit (`[id]/route.ts:117-126`).

**Org provisioning is `requireApiOperator`-gated and the operator IS a user.** `requireApiOperator()` (`api.ts:62-70`) returns `{ ctx, response }`, 403 for any non-operator. The operator carries `org_id NULL` / `org_role NULL` / `is_operator true` (seed `seed-admin.ts:136-160`), so the invite it issues must stamp the **new org's** id explicitly (not `ctx.effectiveOrgId`, which is null for a non-acting operator — `orgScope` would be `FALSE`). `invitations.invited_by` references `users.id` (`onDelete: set null`) — the operator's `userId` qualifies as the inviter.

**`organizations` has `name`/`slug`/`tier`/`billing_email`/`status` but NO tenant-editable contact field.** `schema.ts:18-33`: `slug` is globally `.unique()` (distinct namespace from `clients.slug`); `tier` + `billing_email` are operator-owned (the authoritative copy, edited via the landed `[id]` PATCH); `status` is S11's. The slice's `PATCH /api/admin/organization` *"for name/contact"* therefore needs a tenant-editable **contact** target the org doesn't yet have — S9's one schema addition (see Database Changes).

**The org-settings RBAC action already exists.** `rbac.ts:44,54` defines `manage_org_settings` = `org_admin`+ (with the comment *"org profile (org_admin+; tier stays operator-only)"*) — exactly S9's gate. `authorizeApiOrg(ctx, "manage_org_settings")` (`api.ts:91-96`) is the ready-made guard for the new `/api/admin/organization` route. `effectiveOrgRole` (`api.ts:83-86`) makes an **acting operator owner-equivalent**, so an impersonating operator can use the tenant org-settings route too.

**Brand create/edit already exist and are mostly what S9 wants — but the GET reads leak across orgs.** `POST`+`PATCH /api/admin/clients` (`route.ts`, `[id]/route.ts`) already handle slug/name/contact/billing/branding/colours/logo, gated `authorizeApiOrg(ctx, "manage_brand")` (= org_admin+) with `tier` excluded as operator-only (`route.ts:38-41`, `[id]/route.ts:23-25`). **However both `GET` handlers still call `requireApiAuth()` (signature-only) and run UNSCOPED:** `GET /api/admin/clients` (`route.ts:15-29`) selects **all brands across all orgs**; `GET /api/admin/clients/[id]` (`[id]/route.ts:27-49`) resolves **any brand by raw id**. This is the same class of read-isolation carry-over S8 closes for `users` GET — and because **S9 repurposes the `clients` pages as the org-scoped brand-management surface**, S9 owns closing it for `clients` (convert both GETs to `getApiTenant()` + `orgScope`/`resolveOwnedResource`). The brand-management list would otherwise show every tenant's brands.

**The slice asks for `brand_admin` to edit branding; S5 set the gate to `org_admin`+.** `clients` PATCH is `manage_brand` (org_admin+) today, but S9's backend line says brand branding/careers fields should be editable by *"brand_admin/owner"*. Resolving this means a per-field RBAC split (branding/careers/contact → brand-level `brand_admin`; `slug` → org-level `org_admin`, because the slug is the global careers namespace) — see API Changes #5.

**`seed-admin.ts` still encodes the single-tenant assumption.** It hard-requires `SEED_ADMIN_CLIENT_SLUG` (`:40`) and always creates a brand (`:74-85`) + a `brand_admin` membership (`:116-125`), pointing the Owner's `client_id` at it (`:98`). It already creates the operator (tenant-less, `:132-160`), the org (`:60-71`), and the Owner with `org_role: "owner"` (`:93-110`) — so the *structure* is right; S9's rework is to **drop the mandatory brand** so the seed yields the S9 acceptance shape (*"clean operator + demo org + Owner"* — an **empty** org the Owner self-serves), which requires S8's nullable `users.client_id`.

**The `(admin)/settings` page is currently POPIA/retention/info-officer only.** `src/app/(admin)/settings/page.tsx` is a `"use client"` page with three cards (POPIA data requests, data retention, information officer) — no org or brand settings. S9 prepends an **Organization** card (editable name/contact; read-only tier/billing) and an **Active brand** card (deep-link to brand management), keeping the POPIA sections. Gating: S8 makes **Settings** visible only to owner/org_admin in the sidebar, and the new org PATCH is RBAC-gated server-side; POPIA purge is already `run_popia_purge` = org_admin+.

**Email is a synchronous transactional helper with a template kit.** `sendTransactionalEmail(to, subject, htmlBody)` (`email.ts:65`, never throws, returns `null` on failure) + `wrapTemplate`/`emailHeading`/`emailBtn`/`emailP`/`emailNote` (`:151-251`). `passwordResetEmail(firstName, resetUrl)` (`:351-362`) is the structural analog for S8's new `invitationEmail`. **S9 reuses S8's `invitationEmail(orgName, inviterName, acceptUrl)` as-is** — for the operator path, `orgName` = the new org, `inviterName` = the operator's name (or "TalentStream"). No new template required.

**Tech stack:** Next.js 16.2.2 (App Router), Drizzle 0.45.2 over postgres-js (lazy singleton `src/db/index.ts`), `jose` HS256 (`ADMIN_AUTH_SECRET`), bcrypt (work factor 12), vitest 4 with a `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial). The operator-side fixtures live in `src/lib/operator-isolation.itest.ts`. No new env var is required (S9's seed makes `SEED_ADMIN_CLIENT_SLUG` *optional*).

## Related Issues

- **S1 (done)** — `organizations`, `clients` (= brands), `memberships`, `users.org_id`/`org_role`/`is_operator`, the `(org_id, email)` + partial operator-email uniqueness, and the `set_org_id_from_client_user` trigger (fills `org_id` only when NULL). S9's provisioning writes `organizations` + (via S8) `invitations`.
- **S2 (done)** — the seam (`getSession`/`requireTenant`/`tenantFromSession`/`getApiTenant`) and the **login disambiguation rule** (tenant email effectively globally unique until Clerk; login fails closed on duplicate). S9's global-email guard at provision time preserves it (see Edge Cases).
- **S3 (done)** — `rbac.ts` matrix: **`manage_org_settings`** + `manage_brand` already defined (org_admin+); `decideBrandAccess`/`authorizeApiBrand` are the brand-level gate S9 uses for the `clients` PATCH split.
- **S4 (done) + S5 (done)** — read/write isolation + RBAC. **Carry-over:** S4 left the `clients` GET handlers unscoped (see Codebase Analysis); **S9 closes them** as part of the brand-management repurpose (parallel to S8 closing the `users` GET).
- **S6 (done, `ec26496`)** — private blobs / org-prefixed paths. Disjoint from S9.
- **S7 (done, `37592e0` — a hard dependency, landed).** Operator console + `requireApiOperator` + `operator_audit` + the operator org list/detail pages + `[id]` tier/billing PATCH. S9 adds the org `POST`/provision + new-org form on top.
- **S8 (in flight — the critical dependency, shared files).** `invitations` table (org-level path built **for S9**), `users.client_id` nullable, invite create/accept, `invitationEmail`, sidebar/Settings gating, `activeBrandId`/`TenantProvider`/BrandSwitcher. **Build S9 on a branch rebased onto S8.** See the Dependency-status note for the `createInvitationRow` extraction S9 needs.
- **S10 (depends on S7/S8)** — per-org usage/metering. The operator org-detail "Usage" card is an S10 placeholder (`orgs/[id]/page.tsx:204-217`); S9 leaves it.
- **S11 (depends on S9)** — org lifecycle (suspend/restore/soft_delete/purge). S9 sets `status: "active"` on creation and leaves the lifecycle transitions + their `operator_audit` actions to S11.
- **S12 (depends on S9)** — host/subdomain routing. **org-slug vs brand-slug distinctness matters here:** `organizations.slug` is the tenant/app subdomain; `clients.slug` is the careers subdomain (`proxy.ts:31-41` rewrites to `/c/[subdomain]`). The new-org form's slug is the **org** slug — keep the two namespaces conceptually separate (slice risk).
- **S13 (depends on S5, S8, S10)** — drops `users.client_id` + `security_group`. S8 already relaxes `client_id` to nullable; S9's seed sets it `null` for an org-level Owner, fully aligned with S13's direction (S13 still does the full `DROP COLUMN`).
- **S14 (depends on S8, S9, S10)** — the **full** terminology pass (Clients→Brands route/pages/wizard) **and** the multi-org **`seed.ts`** rewrite (2 orgs, assorted roles). **S9 reworks a *different* file — `seed-admin.ts` (the minimal operator+org+Owner bootstrap)** — and does only the *functional* brand-management changes (org-scoping, tier-read-only, RBAC-aware controls), leaving the route/copy rename + rich demo seed to S14. State this split in the PR.
- **S15 (Clerk, depends on S8)** — replaces login/invite-accept/password-reset with Clerk. Keep S9's provisioning thin and behind the invite helper so S15 swaps the accept side without touching provisioning.

### Assumptions from siblings (do **not** build these in S9)

- **The `invitations` table, invite token helpers, the public accept route, and the `invitationEmail` template (S8).** S9 *consumes* them via the shared `createInvitationRow`/`sendInviteEmail` helper; it does not define the table or the accept flow. The org-level (`client_id` null + `org_role`) invite path is **already S8 scope** (built for S9).
- **`users.client_id` nullable relaxation (S8 Resolved Decision 1).** S9's seed + org-level Owner rely on it but do not perform the relaxation.
- **Sidebar nav gating + Settings/Brands visibility + `TenantProvider`/`useTenant()`/`activeBrandId`/BrandSwitcher (S8).** S9 reads `useTenant()` on the Settings page and the brand-management context; it does not build the provider or the sidebar gating.
- **Per-org usage metering (S10), lifecycle/suspend (S11), host routing (S12).** Untouched by S9 (the Usage card stays an S10 placeholder; `status` stays `"active"`).
- **Full Clients→Brands route/page/wizard rename + multi-org `seed.ts` (S14).** S9 does the functional brand-management behaviour + minimal label tweaks only.

## Implementation Plan

### Database Changes

**One small additive migration — tenant-editable org contact (Resolved Decision 1).** The slice's `PATCH /api/admin/organization` *"for name/contact"* needs a contact field distinct from `billing_email` (operator-only). Add two nullable columns to `organizations` in `schema.ts:18-33`:
```ts
contact_name: text("contact_name"),   // tenant-editable org contact (distinct from operator billing_email)
contact_email: text("contact_email"),
```
Then `npm run db:generate` → `drizzle/00NN_<name>.sql`, then `npm run db:migrate`. No backfill, no trigger (organizations has none); nullable, so clean on a seeded DB.

> **Migration-number coordination (S8 in flight).** The latest committed migration is `0027_robust_paladin.sql` (S7). S8 generates `0028_*` (`invitations` + the `users.client_id` `DROP NOT NULL`). After rebasing onto S8, S9 becomes `0029_*`. **If S8 has not merged when you `db:generate`, S9 will also auto-number `0028_*` and collide on rebase** — regenerate/renumber against the post-rebase journal; do not hand-pick the number.

S9 **does not** add the `invitations` table or relax `users.client_id` — both are S8.

### API / Backend Changes

> **Read the Next.js 16 route-handler + `db.transaction` docs first (AGENTS.md).** Provisioning writes two rows (org + invite) that must not half-apply.

#### 1. Provision org + first Owner — `POST /api/operator/organizations` (NET-NEW, add to the existing `route.ts`)

```
POST /api/operator/organizations
  body { name: string, slug: string, tier: "standard"|"premium"|"enterprise", ownerEmail: string }
```
- `const { ctx, response } = await requireApiOperator(); if (response) return response;` (non-operators 403 — acceptance).
- Validate: `name` non-empty; `slug` via `validateSlug` (`src/lib/slug.ts:19` — same lowercase-alnum/reserved rules, rejecting reserved subdomains like `api`/`app`/`admin`); `tier` via the `isTier` set (mirror `[id]/route.ts:8-11`); `ownerEmail` normalised (`trim().toLowerCase()`) + `EMAIL_RE` (reuse `users/route.ts`'s regex).
- **Org-slug collision → generic.** `organizations.slug` is globally unique; pre-check `db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })` and return a generic `error("That name or slug is unavailable")` (don't confirm cross-org existence — align with S8's slug-oracle posture). Keep the unique index as the backstop (catch the violation).
- **Global-email guard (login resolvability — S2 rule).** Reject (409) if any tenant user (`is_operator = false`) already has `ownerEmail` in *any* org — otherwise the new Owner can't be resolved at login. This is the same guard S8's invite-create enforces; the shared helper should own it (see Edge Cases).
- **Transactional create.** `await db.transaction(async (tx) => { … })`: insert `organizations { name, slug, tier, status: "active" }`; then `createInvitationRow({ orgId: org.id, email: ownerEmail, clientId: null, orgRole: "owner", brandRole: null, invitedBy: ctx.userId }, tx)` (the S8 helper — org-level invite, returns `{ invitation, rawToken }`). Org + invite commit atomically; an invite-row failure rolls back the org (no orphan tenant).
- **Send the invite email (best-effort, after commit).** `acceptUrl = ${baseUrl}/accept-invite?token=${rawToken}`; `await sendInviteEmail(ownerEmail, org.name, operatorName, acceptUrl)` (wraps `invitationEmail` from S8). Mirror password-reset: a send failure logs but does **not** fail the request — the invite row exists and is resendable (#2).
- **Audit.** `recordOperatorAudit({ operatorUserId: ctx.userId, action: "provision_org", targetOrgId: org.id, metadata: { slug, name, tier, owner_email: ownerEmail }, ip: clientIp(request), endedAt: new Date() })` (point-in-time, like `set_tier`). Requires adding `"provision_org"` to `OPERATOR_AUDIT_ACTIONS` (#7).
- Return `success({ organization: org, invite: { email: ownerEmail, expires_at: invitation.expires_at } }, 201)`.

#### 2. Resend the Owner invite — `POST /api/operator/organizations/[id]/resend-invite` (NET-NEW)

```
POST /api/operator/organizations/[id]/resend-invite   (no body, or { email } to override)
```
- `requireApiOperator()`; resolve the org by `id` (404 if missing).
- **Guard already-onboarded:** if a user with `org_id = id AND org_role = "owner"` already exists → `error("The owner has already accepted this invitation", 409)`.
- Re-mint via the S8 helper's supersede path: mark the existing pending org-level invite (`org_id = id, accepted_at IS NULL, org_role = "owner"`) expired/accepted and insert a fresh token (reuse the partial-unique `(org_id,email) WHERE accepted_at IS NULL` semantics S8 builds). Send the email as in #1.
- Audit: reuse `provision_org` with `metadata: { resend: true, owner_email }` (Decision B — keeps the `OPERATOR_AUDIT_ACTIONS` allow-list lean and avoids drift from the schema comment's S9 action note; "provisions vs resends" is a `metadata.resend` predicate).
- Return `success({ invite: { email, expires_at } })`.

#### 3. Extend `GET /api/operator/organizations/[id]` — onboarding status (for the resend UI)

In `[id]/route.ts:48-55`, add to the response so the detail page can render "invite pending / resend" vs "owner active":
```ts
owner: <{ id, email, first_name, last_name } | null>,   // first user in this org with org_role = "owner"
pendingInvite: <{ email, expires_at } | null>,           // invitations row: org_id=id, org_role="owner", accepted_at IS NULL, expires_at > now
```
Read `users` (`eq(org_id, id)` + `eq(org_role, "owner")`) and `invitations` (org-level, pending) scoped to the org. Leave the existing `counts` block as-is.

#### 4. Tenant org settings — `GET` + `PATCH /api/admin/organization` (NET-NEW route `src/app/api/admin/organization/route.ts`)

The org boundary is `ctx.effectiveOrgId` — there is **no path param**; an owner/org_admin edits *their own* org (an acting operator edits the acted org via `effectiveOrgId`).
```
GET   /api/admin/organization                      → the caller's org (name, slug, tier, billing_email, contact_name, contact_email, status)
PATCH /api/admin/organization  body { name?, contact_name?, contact_email? }
```
- `const { ctx, response } = await getApiTenant(); if (response) return response;`
- `const denied = authorizeApiOrg(ctx, "manage_org_settings"); if (denied) return denied;` (org_admin+ — `rbac.ts:54`).
- `if (!ctx.effectiveOrgId) return error("No organization in context", 400);` resolve `organizations` by `eq(id, ctx.effectiveOrgId)` (the effective-org id *is* the boundary; no cross-org id is reachable).
- **PATCH writable allow-list = `{ name, contact_name, contact_email }` only.** `name` must be non-empty if supplied. **Explicitly ignore** any body `tier` / `billing_email` / `slug` / `status` (operator-only / not editable here — prevents tenant self-escalation, the same posture as the brand-tier exclusion). Stamp `updated_at`. Return the updated row.
- GET feeds the Settings page; `tier`/`billing_email` are returned **read-only** for display (the page renders a `TierBadge` + a muted billing note).

#### 5. `clients` PATCH RBAC split + careers fields (`src/app/api/admin/clients/[id]/route.ts`)

Make brand branding/careers/contact editable by `brand_admin`+ (slice: *"brand_admin/owner"*) while keeping the **slug** (global careers namespace) at `org_admin`+:
- `getApiTenant()`; resolve the brand **org-scoped**: `const existing = await resolveOwnedResource(clients, id, ctx); if (!existing) return error("Brand not found", 404);` (a cross-org id → 404). *Replaces the current `requireApiAuth` GET-era pattern; the PATCH already uses `resolveOwnedResource` — keep it.*
- **Per-field gate:** if `body.slug !== undefined && body.slug !== existing.slug` → require `authorizeApiOrg(ctx, "manage_brand")` (org_admin+ — slug is sensitive/global). For all other fields (name, contact_*, billing_email, branding_logo_url, brand colours, logo_background/position, notes, is_active) → require `authorizeApiBrand(ctx, existing.id, "brand_admin")` (member brand_admin, or owner/org_admin via `effectiveOrgRole`). This lets a `brand_admin` manage **their** brand's presentation but not a sibling brand (non-member → 404/403) and not the slug.
- Keep `tier` excluded (operator-only, unchanged). Keep colour/logo validation (`[id]/route.ts:90-113`).
- **"Careers fields"** = the existing brand-presentation columns already on `clients` (`branding_logo_url`, `brand_*_color`, `logo_background`, `logo_position`, `notes`) that render the public careers/apply page (`c/[clientSlug]/…`). **No new columns** (Decision C — dedicated careers-copy fields are out of S9 scope).
- Tighten the slug-taken message to a generic *"That slug isn't available"* (`[id]/route.ts:128`, and `route.ts:65`) — don't assert cross-org existence (align with S8's oracle hardening).

#### 6. `clients` GET org-scoping (close the S4 carry-over — required by the brand-management repurpose)

- `GET /api/admin/clients` (`route.ts:15-29`): `requireApiAuth()` → `getApiTenant()` + `.where(orgScope(clients, ctx))` (only the caller's org's brands; an acting operator sees the acted org's brands). Keep the campaign-count shape the list page reads.
- `GET /api/admin/clients/[id]` (`[id]/route.ts:27-49`): `requireApiAuth()` → `getApiTenant()` + resolve via `resolveOwnedResource(clients, id, ctx)` (404 cross-org), preserving the `with: { campaigns: true }` join.
- Flag in the PR as an **S4 read-isolation carry-over closed by S9** (net-new isolation, not net-new S9 feature scope) — symmetric with S8 closing the `users` GET.

#### 7. Audit action — add `provision_org`

In `src/lib/operator-audit.ts:11-16`, append `"provision_org"` to `OPERATOR_AUDIT_ACTIONS`. No migration (the schema comment anticipates this). `isOperatorAuditAction` and the `OperatorAuditAction` union update automatically.

#### 8. `seed-admin.ts` rework — drop the single-tenant assumption (Resolved Decision 2)

Replace the mandatory `SEED_ADMIN_CLIENT_SLUG` brand with the S9 empty-org shape (*"clean operator + demo org + Owner"*):
- Keep the operator (tenant-less) + org (find-or-create by `orgSlug`) + Owner (`org_role: "owner"`).
- **Make the brand optional.** Read `SEED_ADMIN_CLIENT_SLUG` with `process.env[...]` (no longer `requireEnv`). **Default (unset): the Owner is org-level** — insert with `client_id: null` (now nullable via S8) and **no membership row** — an empty org the Owner self-serves (matching S9 acceptance + S8's empty-org bootstrap). **If set (back-compat / richer demo):** additionally find-or-create the brand, set the Owner's `client_id` to it, and insert the `brand_admin` membership (today's behaviour).
- Now that `users.client_id` is nullable (S8), the operator insert may also drop the vestigial brand placeholder (`seed-admin.ts:141` `client_id: brand.id` → `client_id: null`) — optional tidy that removes the comment's "until S13" caveat; keep the `is_operator: true` + `org_id NULL` trigger-guard assertion (`:152-156`).
- Stays idempotent (find-or-create throughout). Note: S14 rewrites the *rich multi-org* `seed.ts` — a different file; do not conflate.

### Frontend Changes

> **The `frontend-design` skill is MANDATORY for every screen below** (project standard). Operator screens use the **control-plane** palette (`ink`/`paper`/`canvas`/`cobalt`/`vermillion`, mono identifiers — see `operator/layout.tsx`, `operator/orgs/[id]/page.tsx`); tenant screens use the admin palette (`charcoal`/`cream`/`accent`/`surface`/`border`, `TierBadge`, `useToast`, `EmptyState`). Reuse the tier button-group from `operator/orgs/[id]/page.tsx:151-171` and the status-dot from `operator/page.tsx:185-189`.

**1. Operator "New organization" form (`src/app/operator/orgs/new/page.tsx`, new).** Operator-shell page (it renders inside `operator/layout.tsx`). Fields: **name**, **slug** (auto-`slugify(name)` on type, editable, live-validated against `validateSlug`), **tier** (3-option button-group), **owner email**. Submit → `POST /api/operator/organizations` → on success `toast("Organization provisioned — invite sent", "success")` + `router.push('/operator/orgs/' + data.organization.id)`; on slug/email collision show the generic server message inline. Add a **"New organization"** button to the operator org-list header (`operator/page.tsx`, the empty `<div>` at `:82-92`) linking here. Mirror the dark control-plane chrome + the save-button spinner from `orgs/[id]/page.tsx:188-200`.

**2. Operator org-detail — onboarding status + resend (`operator/orgs/[id]/page.tsx`).** Add an **"Onboarding"** card beside Plan & billing reading the extended `GET` (#3): if `pendingInvite`, show the invited email + expiry + a **"Resend invite"** button (`POST .../resend-invite` → toast); if `owner` is set, show the active Owner (name/email, a green status dot). Reuse the card styling at `:143-202`.

**3. Settings page — Organization + Active-brand cards (`src/app/(admin)/settings/page.tsx`).** Prepend two cards above the existing POPIA/retention/info-officer sections (which stay):
- **Organization** (org_admin+): editable **name** + **contact name/email** (`GET`/`PATCH /api/admin/organization`, `useToast`); **read-only** plan (a `TierBadge` from `GET`'s `tier`) + **billing email** (muted, with a "managed by TalentStream" note) — *tier read-only for owners* per acceptance. Reuse the page's existing `inputClass` + card shell (`settings/page.tsx:91-102`).
- **Active brand** (reads S8's `useTenant().activeBrandId` + brands): show the current active brand name with a **"Manage brand →"** link to `/clients/[activeBrandId]/edit`; if "All"/none selected, a hint to pick a brand from the switcher. (Depends on S8's `TenantProvider`.)

**4. Repurpose `(admin)/clients/*` as brand management (functional only; S14 does the route/copy rename).**
- `clients/page.tsx`: now backed by the **org-scoped** GET (#6) — the list shows only the org's brands. Minimal label tweaks ("Clients"→"Brands", "New Client"→"New brand"); gate the "New brand" button to org_admin+ (cosmetic — server enforces `manage_brand`). Replace the bare "No clients yet" block with `EmptyState` for consistency.
- `clients/new/page.tsx`: brand create (org_admin+); org binding is server-side (`ctx.effectiveOrgId`) — no org field.
- `clients/[id]/edit/page.tsx`: **make tier read-only** — it currently renders a tier picker (`TIER_OPTIONS`, `:11-43`) but `clients` PATCH ignores `tier` (operator-only), so the control is dead-write; replace it with a read-only `TierBadge` + "set by TalentStream" note. For a **brand_admin** caller, **disable the slug field** (org_admin-only per #5) while leaving branding/careers/contact editable; an org_admin/owner keeps the full form. Use `useTenant()` (S8) for the caller's role to drive the disabled state (cosmetic; #5 is the server enforcement).
- State in the PR: S9 = functional brand management (org-scoping, tier-read-only, RBAC-aware controls); **S8** already did the sidebar label; **S14** finishes the `/clients`→`/brands` route + wizard copy.

### Edge Cases and Boundary Conditions

- **Provisioning is operator-only + audited.** Non-operators (incl. a tenant owner) → 403 on `POST /api/operator/organizations` (acceptance). Every provision writes a `provision_org` audit row.
- **Org + invite are atomic; email is best-effort.** A failed invite-row insert rolls back the org (no orphan tenant). A failed email send does **not** fail provisioning — the operator resends (#2). (Mirrors password-reset's "row first, mail best-effort".)
- **Empty-org bootstrap (the headline acceptance).** The provisioned Owner accepts (S8 route) into an org with **zero brands**, created with `client_id: null` + `org_role: "owner"` + **no membership** — `org_role` grants org-wide reach, so the Owner logs into a fully isolated, empty, self-controlled org and creates the first brand. Requires S8's nullable `users.client_id` + accept route. Test the full chain (provision → accept → login → create brand) and that the Members/brand lists render a null-brand Owner gracefully.
- **Login resolvability (S2 rule).** Reject provisioning if `ownerEmail` already belongs to a tenant user in another org (global-email guard) — else both that Owner and the colliding user become un-loginnable (`login` fails closed on >1 match). Test.
- **Org slug vs brand slug are distinct namespaces.** `organizations.slug` (provision form) and `clients.slug` (brand create) are separate unique indexes; the *same string* may legitimately exist as an org slug and a brand slug. Don't validate one against the other. (S12 routing relies on the distinction.)
- **Resend after onboarding.** Resend when an Owner with `org_role = "owner"` already exists → 409. Resend before acceptance supersedes the pending token (only one live invite per `(org_id, email)`).
- **Tenant org PATCH can't self-escalate.** `name`/`contact_*` only; a body `tier`/`billing_email`/`slug`/`status` is ignored. Operators set tier/billing via the operator `[id]` PATCH. Test that a tenant body `tier` is a no-op.
- **Brand-management isolation (carry-over).** A tenant's brand list shows only their org's brands; `GET /api/admin/clients/[orgB-brand]` → 404. An acting operator sees the acted org's brands. Test (regression for the S4 carry-over).
- **`brand_admin` brand edits are membership-bound.** A `brand_admin` edits **their** brand's branding/careers/contact (200) but not a sibling brand they don't belong to (404/403) and not the slug (403). org_admin/owner edit everything incl. slug. Test the matrix.
- **Slug oracle.** Org-slug and brand-slug collisions return generic "unavailable" (no cross-org/owner detail). Align with S8's `check-slug` hardening; public apply by `(brandSlug, campaignSlug)` still resolves.

### Test Plan

Extend the `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial), reusing the operator + two-org fixtures from `src/lib/operator-isolation.itest.ts` and the `@/lib/email` stub. Add `provisioning.itest.ts` (+ unit tests where DB-free).

- **DB-free unit tests (`npm test`):**
  - Provision input validation: bad slug (reserved/format) rejected; bad tier rejected; malformed email rejected.
  - `isOperatorAuditAction("provision_org")` → true after the allow-list edit.
  - Org-settings PATCH allow-list: `name`/`contact_*` accepted; `tier`/`billing_email`/`slug`/`status` stripped.
  - `clients` PATCH gate selection: a `slug`-changing body routes to the org_admin gate; a branding-only body routes to the brand_admin gate (pure helper / mocked `authorize*`).
- **DB-backed integration tests (gated):**
  1. **Provision RBAC + audit:** operator `POST /api/operator/organizations` → 201 with an `organizations` row (`status: active`, tier) + a pending **org-level** `invitations` row (`client_id` null, `org_role: "owner"`, `token_hash`, `expires_at`) + a `provision_org` `operator_audit` row; owner/org_admin/recruiter → **403**.
  2. **Empty-org onboarding (with S8 accept):** accept the provisioned token → creates the Owner (`org_id` = new org, `org_role: "owner"`, `client_id: null`, no membership); the Owner logs in, sees an empty isolated org, and `POST /api/admin/clients` succeeds (first brand). Org A Owner sees no Org B data.
  3. **Org-slug collision:** provisioning a taken org slug → generic error, no second org created.
  4. **Global-email guard:** provisioning with an `ownerEmail` already used by a tenant user in Org B → rejected; the colliding user is untouched.
  5. **Resend:** resend before accept supersedes the pending invite (old expired/accepted, fresh token); resend after the Owner accepts → 409.
  6. **Org settings:** owner/org_admin `PATCH /api/admin/organization {name, contact_email}` → 200 (own org only); recruiter/viewer → 403; a body `{tier, billing_email, slug}` is ignored (row unchanged on those fields).
  7. **`clients` GET scoping (carry-over regression):** Org A admin `GET /api/admin/clients` → only Org A brands (not Org B, not other orgs); `GET /api/admin/clients/[orgB-brand]` → 404.
  8. **`clients` PATCH RBAC matrix:** brand_admin edits their brand branding → 200; brand_admin edits a sibling brand (non-member) → 404/403; brand_admin changes slug → 403; org_admin changes slug → 200; tier in body ignored.
  9. **Seed:** fresh DB + `seed-admin` (no `SEED_ADMIN_CLIENT_SLUG`) → operator (`org_id` null) + demo org + Owner (`org_role: "owner"`, `client_id: null`, no membership); re-run is idempotent. With `SEED_ADMIN_CLIENT_SLUG` set → brand + `brand_admin` membership also created (back-compat).
- **Build/typecheck:** `npm run build` — must merge cleanly with S8's `schema.ts`/`email.ts`/seam edits and compile the new org-contact columns + `/api/admin/organization` route.

### Suggested Implementation Order

> Branch from / **rebase onto S8 first** (shared `schema.ts` + `email.ts` + the invite helper). Confirm S8 has extracted `createInvitationRow`/`sendInviteEmail` into `src/lib/invitations.ts`; if not, extract it as step 0.

1. **Schema + migration:** add `organizations.contact_name`/`contact_email` to `schema.ts`; `npm run db:generate` (renumber to `0029_*` after rebasing onto S8's `0028`); `npm run db:migrate`.
2. **Audit:** add `"provision_org"` to `OPERATOR_AUDIT_ACTIONS`.
3. **Provision routes:** `POST /api/operator/organizations` (+ transactional org+invite + audit + best-effort email), `POST .../[id]/resend-invite`, extend the `[id]` GET with onboarding status. Integration-test provision RBAC + cross-org + global-email first.
4. **Tenant org settings:** `GET`+`PATCH /api/admin/organization` (org_admin+; name/contact only).
5. **Brand management backend:** close `clients` GET scoping (#6); `clients` PATCH RBAC split + generic slug message (#5).
6. **Seed:** `seed-admin.ts` rework (optional brand; org-level Owner default).
7. **Frontend (frontend-design skill), after the routes exist:** operator new-org form + list button; org-detail onboarding/resend card; Settings Organization + Active-brand cards; brand-management repurpose (tier read-only, RBAC-aware slug field, org-scoped list).
8. **Tests + `npm run build`.**

### Resolved Decisions (open questions answered)

> Resolved with best judgement on 2026-06-17 — implementation should proceed on these; none is a blocker. Each is reversible if product later disagrees, but they are the intended build. Decisions A and the seed default are also stated inline as Resolved Decision 1/2 above.

**A. Org contact → add `organizations.contact_name` + `contact_email` (both nullable `text`).** The slice scopes *"name/contact"* as tenant-editable and *"billing"* as operator-only, so a tenant contact must exist that is **distinct from the operator-owned `billing_email`**. Two nullable, backfill-free columns let the Settings "Organization" card mirror the brand-settings contact shape. `contact_phone` is omitted (low value at org level, trivially addable later). This is the Database-Changes migration — proceed with it; the name-only fallback is rejected (it leaves *"contact"* with nowhere to write).

**B. Resend audit → reuse `provision_org` with `metadata: { resend: true, owner_email }`.** A dedicated `resend_invite` action would grow the `OPERATOR_AUDIT_ACTIONS` allow-list and drift from the schema comment that names only `provision_org` for S9 (`schema.ts:611`). The metadata flag keeps full auditability (operator, time, org, email, *and* that it was a resend) behind one action constant; filtering provisions from resends is a `metadata.resend` predicate.

**C. "Careers fields" → the existing `clients` brand-presentation columns; no new columns.** `branding_logo_url`, `brand_*_color`, `logo_background`, `logo_position`, `notes` already drive the public careers/apply surface (`c/[clientSlug]/…`) and are covered by the brand_admin path of the `clients` PATCH split (#5). Dedicated careers-page **copy** (headline/about/custom domain) is **out of S9 scope** — it implies new columns + public-page rendering unrelated to provisioning, so it belongs to a future slice if the product wants it.

**D. Provisioning creates NO brand — the org is empty by design.** S9's acceptance is literally *"a fully isolated, **empty**, self-controlled org… owner/org_admin create/edit brands"*. Auto-seeding a starter brand would contradict that acceptance, force a brand slug to be chosen by the operator (who must not own brand naming), and duplicate the Owner's first self-serve action. The Owner accepts into an empty org and creates the first brand; `seed-admin`'s default (Resolved Decision 2) matches (org-level Owner, no brand).

**E. S8 must expose `createInvitationRow(opts, tx?)` returning `{ invitation, rawToken }` + a separate `sendInviteEmail(...)` — a hard requirement, not an option.** Provisioning needs the org+invite insert to be **transactional** (no orphan org) and the email **best-effort/post-commit** (mirrors password-reset), which is only possible if row-creation and email-send are separable and the insert accepts a `tx`. The global-email guard + pending-supersede live inside `createInvitationRow` so both call sites share one verified path. **If S8 lands the logic inline in `POST /api/admin/members/invite`, the S9 PR performs the extraction** (refactoring S8's route to call the helper) as step 0 — small, and it keeps the two invite surfaces DRY. Flag this to whoever delivers S8 before S9 starts.
