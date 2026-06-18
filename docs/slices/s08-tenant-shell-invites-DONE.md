# S8 · 🎨 Role-aware tenant shell + brand switcher + member invites + brand-derived campaigns

> **Phase 2 — Operate + onboard the tenant model**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** the self-service tenant experience.
- **Schema:** NEW `invitations` (org_id, email, client_id [nullable for org-level], org_role/brand_role nullable, `token_hash`, expires_at, accepted_at, invited_by; `unique(token_hash)`, `unique(org_id, email)` while pending) — mirrors the hardened sha256 single-use TTL token pattern.
- **Backend:** expose `ctx` to the `(admin)` layout via `requireTenant` + `getBrandMemberships`; add a **server-validated** `activeBrandId` (narrows S4 reads to one brand; `org_id` stays the hard boundary). POST `/api/admin/members/invite` (org_admin/owner) → invitation + email. POST `/api/auth/invite/accept` (public) → validate token, create org-scoped user + memberships + org_role, set password, sign session. `campaigns` POST + wizard drop required body `client_id` → derive from `activeBrandId` + membership. Members CRUD (org-scoped + RBAC).
- **Frontend:** 🎨 `sidebar.tsx` rename **Clients → Brands**, add **Members**, gate Members/Brands/Settings by `org_role`, brand-scoped active state, integrate the act-as banner; `(admin)/layout.tsx` org name + **BrandSwitcher** (caller's brands + "All" for owner/admin); Members page (list + invite modal with brand+role); accept-invite page; wizard shows the active brand as fixed context.
- **↳ Review correction (major — slug squatting/oracle):** with self-service brand creation + globally-unique slug, gate brand-slug creation behind operator approval **or** make `check-slug` return a generic "unavailable" (no cross-org existence confirmation) + per-org rate-limit/auth. Treat the existence oracle as a real risk.
- **Acceptance:** sidebar matches role; brand switcher lists only caller's brands (+All for owner/admin) and re-scopes lists; server rejects an `activeBrandId` the user isn't a member of; invite→accept→login yields a recruiter limited to the chosen brand; invite can't join another org; expired/used tokens rejected; campaign create never requires/accepts `client_id`; public apply still resolves by slug.
- **Depends on:** S5, S7 · **Risks:** invite token must mirror hardened magic-link semantics + be org-scoped; `activeBrandId` validated server-side every request (UI gating cosmetic).

---

# Implementation Spec: S8 · Role-aware tenant shell + brand switcher + member invites + brand-derived campaigns

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `ec26496` ("Harden integrations: private CV blobs + ownership-checked SAS + org paths (S6)"). The branch name is stale; commits run through S6. **S7 is in flight (its spec is committed in `s07-operator-console.md`; its code is not yet in the tree).**
**Change type**: **UI/UX** (role-aware sidebar, header BrandSwitcher, Members page + invite modal, public accept-invite page, wizard active-brand context) **and** backend (new `invitations` table, invite/accept routes, `activeBrandId` seam wiring, brand-derived campaign create, org-scoped Members reads). The `frontend-design` skill is **mandatory** for every screen below — see Frontend Changes.

> **Dependency status — S8 hard-depends on S7, which is being delivered now; they share a file.** S8's `Depends on: S5, S7` is real, not nominal. S5 (write isolation + RBAC) and S6 (blob hardening) are landed (`docs/slices/s05-…-DONE.md`, `s06` commit `ec26496`). **S7 (operator console + act-as) is in flight and S8 builds directly on three things S7 introduces:** (a) the populated `ctx.actingOrgId` that the act-as banner reads; (b) the **act-as banner component** itself (S7 ships it as a self-contained server component in `(admin)/layout.tsx`, explicitly *"so S8 can relocate it beside the brand switcher without a rewrite"* — S7 spec §Frontend/Resolved Decision); (c) S7's edits to **`src/app/(admin)/layout.tsx`** (capturing `ctx` from `requireTenant()`, redirecting non-acting operators to `/operator`, rendering the banner) and to **`src/lib/tenant.ts`** (`getActingOrgId`, the `TenantContext` shape). **S8 also edits both files** (TenantProvider + BrandSwitcher + org name in the layout; `activeBrandId` on `TenantContext` + `tenantFromSession` in the seam). **These two files WILL merge-conflict with S7** — sequence S8 *after* S7 and rebase onto it; do not develop S8's layout/seam changes against the pre-S7 tree. Everything else in S8 (the `invitations` table, the invite/accept routes, the Members page, the brand-derived campaign create, the slug-oracle hardening) is disjoint from S7 and can be built in parallel. If S7 has **not** merged when S8's migration is generated, the auto-numbered file collides (see Database Changes) — coordinate the migration number on rebase.

> **AGENTS.md mandate.** This is a modified Next.js 16.2.2. S8 adds a **public** route handler that signs a session and sets the `admin_session` cookie (invite-accept = a second login surface), a public accept-invite page, a new `proxy.ts` public-path entry, and a server-validated `active_brand` cookie read in the seam. **Before writing route-handler / cookie / `redirect` / proxy code, read the relevant guides under `node_modules/next/dist/docs/`** — the response/cookie/navigation/proxy APIs may differ from training data. Heed deprecation notices. (Cookies are set on the returned `NextResponse` via `res.cookies.set(...)`, mirroring `login/route.ts`.)

---

## Codebase Analysis

S8 is the slice that makes the tenant shell *self-service*. Almost every backend primitive it needs already exists from S1–S7; S8 wires them into two new user journeys (invite→accept, brand-scoped browsing) and one schema addition (`invitations`).

**The seam already exposes everything the shell needs.** `requireTenant()` (`src/lib/tenant.ts:52-56`) returns a cached `TenantContext` (`tenant.ts:18-25`: `userId`, `isOperator`, `orgRole`, `orgId`, `actingOrgId`, `effectiveOrgId`); `getBrandMemberships(userId)` (`tenant.ts:70-78`) resolves `{clientId, brandRole}[]` on demand, memoised per request; `canAccessBrand(ctx, brandId, minRole)` (`tenant.ts:126-136`) is the boolean brand-access check **built for exactly this UI gating** (its docstring: *"so pages can hide/disable mutation controls a user may not perform"*). S8 adds **one field** to the context — `activeBrandId` — and threads `ctx` into client components via a new provider.

**The `(admin)` layout is the wiring point — and S7 is already editing it.** `src/app/(admin)/layout.tsx` calls `await requireTenant()` (`:18`) but **discards the result** today. It renders a sticky header (`top-[var(--dev-banner-h,0px)]`, `:23`) with two slots: `#admin-header-default` (`:28`, holds `<ActiveCampaignCount/>`) and an **empty `#admin-header-slot`** (`:31`) — the intended home for the **BrandSwitcher**. `ToastProvider` already wraps `children` (`:41`). S7 changes `await requireTenant()` → `const ctx = await requireTenant()` (to redirect operators + render the banner); **S8 reuses that captured `ctx`** to (a) wrap children in a new `TenantProvider`, (b) render the org name + BrandSwitcher, (c) place the act-as banner beside the switcher.

**The sidebar has no role awareness.** `src/components/admin/sidebar.tsx` is `"use client"` with a hardcoded `NAV_ITEMS` array (`:6-12`): Dashboard, Campaigns, **Clients** (`:9`), Users, Settings. Active state = `pathname.startsWith(item.href)` (`:72`). It takes **no props** and reads **no role context** — so role gating + the Clients→Brands rename + a Members item all require feeding it `orgRole` (via the new `TenantProvider`, the cleanest path; `requireTenant()` is server-only so the client sidebar can't call it).

**The token pattern to mirror is `passwordResetTokens` (hardened sha256, single-use, TTL).** `generateResetToken()`/`hashResetToken()` (`src/lib/auth.ts:89-97`) = `randomBytes(32).toString("hex")` + `createHash("sha256")`. Request side (`src/app/api/auth/password-reset/request/route.ts`) inserts `{user_id, token_hash, expires_at}` and sends mail **synchronously** via `sendTransactionalEmail()`. Confirm side (`…/password-reset/confirm/route.ts`) validates `eq(token_hash) AND isNull(used_at) AND gt(expires_at, now)`, then **marks used + cascade-revokes the user's other live tokens**, then updates the password. The invite flow copies this verbatim, swapping `used_at`→`accepted_at` and adding user+membership creation + session signing.

**Email is a synchronous transactional helper.** `sendTransactionalEmail(to, subject, htmlBody): Promise<string|null>` (`src/lib/email.ts`) — Resend or SMTP, never throws, returns `null` on failure. Templates are pure functions wrapped in `wrapTemplate(body)` with the cobalt/vermillion palette and helpers `emailHeading/emailP/emailBtn/emailNote/emailFallbackLink`; `passwordResetEmail(firstName, resetUrl)` is the exact analog for a new `invitationEmail(...)`. Admin/self-service mail (password reset) calls `sendTransactionalEmail` **directly** (not the job queue, not `sendCandidateEmail` which logs to `messages`) — the invite email does the same.

**Login signs the session and is `(org_id, email)`-aware but fails closed.** `login/route.ts` resolves the user by email, **fails closed if more than one row matches** (per-org email uniqueness makes email-only login ambiguous — the S2 V1 decision, plan §12.1: *"operators globally unique; tenant emails kept effectively resolvable, e.g. global-unique tenant email until Clerk"*), verifies bcrypt, `signToken({userId, orgId, orgRole, isOperator})` (`auth.ts:21-29`), and sets `admin_session` `{httpOnly, secure: prod, sameSite:"lax", path:"/", maxAge: 60*60*8}`. **The invite-accept route is a second place that mints this exact session/cookie** — reuse `signToken` + the same cookie options.

**Members CRUD largely exists from S5 — but its READ paths are an unclosed isolation gap.** `src/app/api/admin/users/route.ts` and `…/users/[id]/route.ts` already have **org-scoped, RBAC-gated** `POST`/`PATCH`/`DELETE` (`getApiTenant` + `authorizeApiOrg(ctx,"manage_member")` + `resolveOwnedResource`/`orgScope`, with last-owner and rank-escalation guards). **However both `GET` handlers still call `requireApiAuth()` (signature-only) and run UNSCOPED:** `GET /api/admin/users` (`route.ts:36-62`) selects **all users across all orgs**; `GET /api/admin/users/[id]` (`[id]/route.ts:58-93`) resolves **any user by raw UUID** with no `orgScope`. This is a live cross-tenant directory leak that S4 was meant to close ("users + users/[id] (scope to org members; exclude operators)") but did not. **S8 owns closing it** under "Members CRUD (org-scoped + RBAC)" — convert both GETs to `getApiTenant()` + `orgScope(users, ctx)` + `eq(users.is_operator, false)`. (Flag in the PR as an S4 carry-over, not net-new S8 scope.)

**Campaign create requires a body `client_id` everywhere.** `POST /api/admin/campaigns` (`route.ts:68`) hard-requires `body.client_id`, then `resolveOwnedResource(clients, body.client_id, ctx)` (`:100`) + `authorizeApiBrand(ctx, brand.id, "recruiter")` (`:106`), stamping `org_id: ctx.effectiveOrgId!` (`:119`). The same `client_id`-from-body pattern repeats in `from-job-spec/route.ts:40` (FormData), `campaigns/check-slug/route.ts` (query param), the wizard (`src/components/admin/campaign-wizard.tsx:560-581` client `<select>`, body at `:441`), and the from-job-spec page (`campaigns/new/from-job-spec/page.tsx:240-259`). S8 drops the body `client_id` and derives the brand from `ctx.activeBrandId` (validated server-side). Campaign `PATCH` already reads `existing.client_id` (never reassigns brand) — no change needed there.

**Brand slug is a global existence oracle.** `clients.slug` has a **global** `uniqueIndex` (`schema.ts:69`). `GET /api/admin/clients/check-slug` (verified) returns `{available: boolean}` from `eq(clients.slug, slug)` across **all** orgs, gated only by `requireApiAuth()` (signature-only) with **no rate-limit** — a logged-in user can enumerate every tenant's brand slugs. Brand creation (`clients` POST) is already self-service (`authorizeApiOrg(ctx,"manage_brand")` = org_admin+). Public apply resolves by the `(clients.slug, campaigns.slug)` pair (`api/apply/[clientSlug]/[campaignSlug]/route.ts`, `c/[clientSlug]/[campaignSlug]/page.tsx`) — global brand-slug uniqueness is **required** for the careers subdomain rewrite, so the fix is to remove the *oracle*, not the global namespace. **There is no rate-limiter anywhere in the codebase** — it is net-new.

**Reusable UI is ready.** `ConfirmModal` (`{open,title,description,confirmLabel?,variant?:"danger"|"confirm",loading?,onConfirm,onCancel}`), `EmptyState` (`{icon,title,description,actionLabel?,actionHref?}`), `useToast()`/`ToastProvider` (`toast(msg, "success"|"error"|"info"|"warning")`), `TierBadge`. The clients list status-dot (`clients/page.tsx:241-251`) and the tier button-group (`clients/[id]/edit/page.tsx:268-297`) are the structural analogs for the brand switcher and role pills. `dev-port-banner.tsx:46-62` is the precedent for a height-publishing fixed banner (publishes `--dev-banner-h` via `ResizeObserver`).

**Tech stack:** Next.js 16.2.2 (App Router), Drizzle 0.45.2 over postgres-js (lazy singleton `src/db/index.ts`), `jose` HS256 (`ADMIN_AUTH_SECRET`), bcrypt (work factor 12), vitest 4 with a `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial). No new env var is required.

## Related Issues

- **S1 (done)** — created `clients` (=brands), `memberships(user_id, client_id, brand_role)` with `unique(user_id, client_id)`, `users.org_id`/`org_role`/`is_operator`, and the `unique(org_id, email)` + partial operator-email uniqueness. S8's `invitations` table reuses these shapes; memberships is the join the invite flow writes into.
- **S2 (done)** — built the seam (`getSession`/`requireTenant`/`tenantFromSession`/`getApiTenant`) and **decided the login disambiguation rule** S8 must respect: tenant email is effectively globally unique until Clerk (login fails closed on duplicate). The accept route enforces this (see Edge Cases).
- **S3 (done)** — `rbac.ts` matrix (`manage_member`/`manage_brand` = org_admin+), `decideBrandAccess`, `orgScope`/`resolveOwnedResource`. S8 reuses all of these verbatim; `canAccessBrand` is the `activeBrandId` validator.
- **S4 (done) + S5 (done)** — read/write isolation + RBAC. S8 inherits org-scoping on every read/write, so brand narrowing is an *additional* predicate, never a new boundary. **Carry-over:** S4 left the two `users` GET handlers unscoped (see Codebase Analysis) — S8 closes them.
- **S6 (done, `ec26496`)** — private blobs / org-prefixed paths. Disjoint from S8.
- **S7 (in flight — a hard dependency, shared files)** — see the Dependency-status note. S8 sits on top of S7's layout/seam edits and relocates S7's act-as banner. **Build S8 on a branch rebased onto S7.**
- **S9 (depends on S7 + S8)** — `POST /api/operator/organizations` (provision org + **org-level Owner invite, reusing S8's invitation mechanism**) and the `seed-admin.ts` rework. **S8 must therefore make the invite create/accept reusable for an org-level (no-brand) Owner invite** — the `invitations.client_id`-nullable + `org_role` path is specifically for S9. S9 also repurposes `(admin)/clients/*` as brand management and adds `(admin)/settings`; S8 only gates their nav visibility, it does not build those pages.
- **S13 (depends on S5 + S8 + S10)** — drops `users.client_id` + `security_group` entirely. **S8 pulls the NOT-NULL relaxation forward** (Resolved Decision 1): it sets `users.client_id` nullable now so org-level invitees can be created brand-less. S13 still does the full `DROP COLUMN`; S8's change is constraint-only and aligned with S13's direction (note the early relaxation in S13's checklist so it isn't a surprise).
- **S14 (depends on S8)** — the *full* terminology pass ("Clients"→"Brands" everywhere, including the `/clients` route + pages + wizard copy). **S8 does the minimal rename** (the sidebar **label**, keeping the `/clients` href/pages in place) so the two slices don't fight over the same files; S14 finishes the route/page rename. State this in the PR so a reviewer doesn't expect a full rename.
- **S15 (Clerk, depends on S8)** — replaces login/logout/**invite-accept**/password-reset with Clerk equivalents. Keep the invite-accept logic thin and behind the seam (it signs via `signToken`) so S15 can swap it without touching the Members UI.

### Assumptions from siblings (do **not** build these in S8)

- **Operator console, act-as cookie, `operator_audit`, the act-as banner component (S7).** S8 *consumes* `ctx.actingOrgId` and *relocates* S7's banner; it does not create the act-as carrier or the banner. If S7 has not merged, the banner integration is inert (no `actingOrgId` ever set) but must not break the shell.
- **Operator org provisioning + `seed-admin` rework (S9).** S8 does not add org creation. S9 calls S8's invite mechanism for the first Owner.
- **Org/brand settings pages + brand-branding edit (S9).** S8 gates the **Settings** and **Brands** nav by role but builds neither page; the existing `clients/*` pages stand in for brand management until S9.
- **Per-org usage / metering (S10), lifecycle/suspend (S11), host split (S12).** Untouched by S8.
- **Full terminology rename + multi-org seed (S14).** S8 does the label-only Brands rename; S14 does the rest.

## Implementation Plan

### Database Changes

**One new table, no backfill.** Add `invitations` to `src/db/schema.ts` (next to `passwordResetTokens`, `:274-290`), then `npm run db:generate` → `drizzle/00NN_<name>.sql`, then `npm run db:migrate` (`src/db/migrate.ts`). Clean on a fresh DB and idempotent against the seeded DB.

> **Migration-number coordination (S7 in flight).** The latest committed migration is `0026_tenant_schema.sql`. S7 generates `0027_*` (`operator_audit`). If S7 has merged when you generate, S8 becomes `0028_*`. **If S7 has not merged, `db:generate` will also produce `0027_*` and collide with S7 on rebase** — regenerate/renumber after rebasing onto S7. Do not hand-pick the number; let `drizzle-kit` number it against the post-rebase journal.

```ts
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // stored lowercased/trimmed (match users + login)
    // Nullable for an ORG-LEVEL invite (Owner/Org-Admin spanning all brands).
    // A brand invite carries client_id + brand_role; an org invite carries org_role.
    client_id: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    org_role: text("org_role"), // owner | org_admin | null
    brand_role: text("brand_role"), // brand_admin | recruiter | viewer | null
    token_hash: text("token_hash").notNull(), // sha256(raw), mirrors password_reset_tokens
    expires_at: timestamp("expires_at").notNull(),
    accepted_at: timestamp("accepted_at"), // null = pending (the single-use flag)
    invited_by: uuid("invited_by").references(() => users.id, {
      onDelete: "set null", // keep the invite row legible after the inviter leaves
    }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_idx").on(table.token_hash),
    // unique(org_id, email) WHILE PENDING — one live invite per email per org.
    // Partial so a re-invite after accept/expiry-cleanup is allowed.
    uniqueIndex("invitations_org_email_pending_idx")
      .on(table.org_id, table.email)
      .where(sql`${table.accepted_at} IS NULL`),
    index("invitations_org_id_idx").on(table.org_id),
    index("invitations_expires_at_idx").on(table.expires_at),
  ]
);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, { fields: [invitations.org_id], references: [organizations.id] }),
  client: one(clients, { fields: [invitations.client_id], references: [clients.id] }),
  inviter: one(users, { fields: [invitations.invited_by], references: [users.id] }),
}));
```
- The **partial unique** `(org_id, email) WHERE accepted_at IS NULL` implements the slice's *"unique(org_id, email) while pending"* — Postgres NULLs in `accepted_at` collide, accepted rows drop out, so re-inviting later is allowed.
- `invited_by` uses `onDelete: "set null"` (nullable) so an invite audit-trail outlives the inviter. `client_id` is nullable (org-level invite); `org_role`/`brand_role` are free-text validated in code against the same `OrgRole`/`BrandRole` sets used elsewhere.
- **No backfill, no trigger.** This table has no `org_id`-stamping trigger dependency — it is written only by the invite route, which sets `org_id` explicitly from `ctx.effectiveOrgId`.

**Same migration also relaxes `users.client_id` to nullable (Resolved Decision 1).** Append `ALTER TABLE "users" ALTER COLUMN "client_id" DROP NOT NULL;` and drop `.notNull()` from `users.client_id` in `schema.ts:241-243`. This lets an org-level (no-brand) Owner/Org-Admin invitee be created with `client_id: null`, unblocking the S9 empty-org bootstrap. Verified safe against the S1 trigger (`set_org_id_from_client_user`, `0026:245-252`) — it only fills `org_id` when NULL and the accept route always sets `org_id` explicitly, so it never dereferences a null `client_id`. S13 still drops the column entirely later; this is only an early NOT-NULL relaxation. (`db:generate` won't emit this `ALTER` from a `.notNull()` removal reliably across versions — if it doesn't, hand-add the one-line statement to the generated file, mirroring the hand-written-SQL convention used by `0026`.)

### API / Backend Changes

> **Read the Next.js 16 route-handler + cookies + proxy docs first (AGENTS.md).** The accept route signs a session cookie on the response exactly like `login/route.ts`.

#### 1. Seam: `activeBrandId` on `TenantContext` (`src/lib/auth.ts` + `src/lib/tenant.ts`)

A **server-validated, re-validated-every-request** brand filter. Unlike S7's act-as cookie (which *is* a privilege grant, hence signed), `activeBrandId` grants nothing — it only **narrows** within the user's already-enforced access, so a plain (unsigned) cookie is fine; the security is the per-request membership re-check (plan §5.7: *"UI gating is cosmetic; `activeBrandId` re-validated server-side every request"*).

Keep the cookie read inside the seam (§5.1 CI grep forbids `cookies()` outside `auth.ts`/`tenant.ts`). In `auth.ts`:
```ts
const ACTIVE_BRAND_COOKIE = "active_brand";
export async function getActiveBrandCookie(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_BRAND_COOKIE)?.value ?? null;
}
export { ACTIVE_BRAND_COOKIE };
```
In `tenant.ts`, extend `TenantContext` with `activeBrandId: string | null` and resolve it in `tenantFromSession` **with validation** (note: this coordinates with S7's edits to the same function/type):
```ts
// after computing effectiveOrgId:
const raw = await getActiveBrandCookie();
// Re-validate every request: only honour a brand the caller can actually access.
// Owner/org_admin/acting-operator can target any in-org brand; a plain member
// only their membership brands. An invalid/foreign cookie → null (no narrowing),
// never an error on a read path.
const activeBrandId =
  raw && (await canAccessBrand(ctxWithoutBrand, raw)) ? raw : null;
```
(`canAccessBrand` already exists, `tenant.ts:126-136`, and handles owner/admin/acting-operator/member uniformly.) Expose `activeBrandId` on the returned context. A small **brand-scoping predicate helper** keeps routes uniform:
```ts
/** Optional brand narrowing for reads — org_id stays the hard boundary. */
export function brandScope(table: { client_id: AnyPgColumn }, ctx: TenantContext): SQL | undefined {
  return ctx.activeBrandId ? eq(table.client_id, ctx.activeBrandId) : undefined;
}
```
Used as `and(orgScope(campaigns, ctx), brandScope(campaigns, ctx))` (drop `undefined` with the existing `conditions[]` filter pattern).

#### 2. Set active brand (`POST /api/admin/active-brand`)

The BrandSwitcher posts the chosen brand here; the route **validates membership server-side** and sets the cookie (acceptance: *"server rejects an `activeBrandId` the user isn't a member of"*).
```
POST /api/admin/active-brand  body { brandId: string | null }
```
- `getApiTenant()`; `null`/`"all"` → clear the cookie (`maxAge:0`) and return success (the "All" selection, owner/admin only).
- otherwise `if (!(await canAccessBrand(ctx, brandId))) return error("Forbidden", 403)`; set `ACTIVE_BRAND_COOKIE` `{httpOnly, secure: prod, sameSite:"lax", path:"/"}` (no maxAge → session cookie, or an 8h maxAge to match the session). Return `success({brandId})`. Client then refreshes so RSC reads pick up the new context.

#### 3. Invite create (`POST /api/admin/members/invite`)

```
POST /api/admin/members/invite
  body { email, clientId?, brandRole?, orgRole? }
```
- `const { ctx, response } = await getApiTenant(); if (response) return response;`
- `const denied = authorizeApiOrg(ctx, "manage_member"); if (denied) return denied;` (org_admin/owner — same gate as `users` POST).
- Normalise `email` (`trim().toLowerCase()`, validate with the `EMAIL_RE` used in `users/route.ts:18`).
- **Brand vs org invite:**
  - if `clientId` present → `const brand = await resolveOwnedResource(clients, clientId, ctx); if (!brand) return error("Selected brand does not exist", 404);` require `brandRole ∈ {brand_admin,recruiter,viewer}`.
  - if no `clientId` → org-level invite: require `orgRole ∈ {owner,org_admin}` and `canAssignOrgRole(effectiveOrgRole(ctx), orgRole)` (reuse the helper in `users/route.ts:27-34` — an org_admin can't mint an owner). The accepted user gets `client_id: null` (Resolved Decision 1 — no brand needed).
- **Already-a-member guard:** reject (409) if a non-operator user with that `(org_id, email)` already exists (`db.query.users.findFirst`) — invites are for *new* users; existing members are edited via `users` PATCH.
- **Global-email guard (login resolvability):** reject (409) if **any** tenant user (`is_operator=false`) already has this email in another org — preserves the S2 login rule (see Edge Cases).
- **Pending-invite handling:** on the `(org_id,email)`-while-pending unique, either 409 ("an invite is already pending") **or** supersede: mark the old row accepted/expired and insert fresh (recommended — supports "resend"). Document the choice.
- `const { raw, hash } = generateResetToken();` (reuse the seam helper; optionally alias as `generateInviteToken`); insert `invitations {org_id: ctx.effectiveOrgId!, email, client_id: clientId ?? null, org_role, brand_role, token_hash: hash, expires_at: new Date(Date.now()+INVITE_TTL_MS), invited_by: ctx.userId}`. **`INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000` (7 days, fixed — Resolved Decision 2)**, one named constant (invites are colleague-actioned async, so the 1h password-reset TTL is far too short).
- Build `acceptUrl = ${baseUrl}/accept-invite?token=${raw}` and `await sendTransactionalEmail(email, "You've been invited to TalentStream", invitationEmail(orgName, inviterName, acceptUrl))` (new template in `email.ts`, modelled on `passwordResetEmail`). Don't leak send-failure as a hard error (mirror reset: log, still return success — the invite row exists and can be resent).
- Return `success({ id, email, expires_at }, 201)`.

#### 4. Invite accept (`POST /api/auth/invite/accept`) — PUBLIC

```
POST /api/auth/invite/accept  body { token, firstName, lastName, password }
```
- **No `getApiTenant`** — this is public (the invitee has no session yet). Validate the token exactly like `password-reset/confirm`:
  ```ts
  const hash = hashResetToken(token);
  const [inv] = await db.select().from(invitations).where(and(
    eq(invitations.token_hash, hash),
    isNull(invitations.accepted_at),
    gt(invitations.expires_at, new Date()),
  )).limit(1);
  if (!inv) return error("This invitation is invalid or has expired", 400);
  ```
- Validate `firstName`/`lastName` non-empty, `password.length >= 8` (match `users` POST).
- **Resolve the user's `client_id`** (now nullable — Resolved Decision 1): brand invite → `inv.client_id`; org-level invite → `null`. No first-brand fallback and no "org must have a brand" precondition (an org-level Owner can accept into an empty org).
- **Create the user + membership in one logical unit** (sequential awaits as elsewhere; the codebase does not wrap these in an explicit tx — match the password-reset precedent, but a `db.transaction` here is a reasonable hardening since two writes + a token burn must not half-apply):
  ```ts
  const [user] = await db.insert(users).values({
    org_id: inv.org_id,
    client_id: inv.client_id ?? null, // brand invite → brand; org invite → null (Decision 1)
    org_role: inv.org_role ?? null,
    is_operator: false,
    first_name, last_name, email: inv.email,
    password_hash: await hashPassword(password),
    security_group: "user", // LEGACY_SECURITY_GROUP, dropped S13
  }).returning({ id: users.id });
  if (inv.client_id && inv.brand_role) {
    await db.insert(memberships)
      .values({ user_id: user.id, client_id: inv.client_id, brand_role: inv.brand_role })
      .onConflictDoUpdate({ target: [memberships.user_id, memberships.client_id],
                            set: { brand_role: inv.brand_role, updated_at: new Date() } });
  }
  await db.update(invitations).set({ accepted_at: new Date(), updated_at: new Date() })
    .where(eq(invitations.id, inv.id));
  ```
- **Sign the session + set the cookie** (the invitee is now logged in — slice: *"set password, sign session"*). Reuse `signToken({ userId: user.id, orgId: inv.org_id, orgRole: inv.org_role ?? null, isOperator: false })` and set `admin_session` with the **identical** options as `login/route.ts` (`httpOnly, secure: prod, sameSite:"lax", path:"/", maxAge: 60*60*8`). Return `success({ ok: true })`; the client redirects to `/dashboard`.

#### 5. Members reads → org-scoped (close the S4 carry-over)

In `src/app/api/admin/users/route.ts` and `…/[id]/route.ts`, replace the `GET` handlers' `requireApiAuth()` with `getApiTenant()` and scope: `and(orgScope(users, ctx), eq(users.is_operator, false))` for the list, and resolve the detail via `resolveOwnedResource(users, id, ctx)` + `eq(is_operator,false)` (404 on cross-org / operator). The list should also join `memberships` so the Members page can show each member's brand + brand_role (the existing `client_id`/`client_name` join is legacy; prefer the membership view). Keep RBAC at `view`/`manage_member` as appropriate.

#### 6. Brand-derived campaign create (drop body `client_id`)

- **`POST /api/admin/campaigns`** (`route.ts`): remove the `if (!body.client_id)` requirement (`:68`); set `const brandId = ctx.activeBrandId;` and `if (!brandId) return error("Select a brand before creating a campaign", 400);` then keep `resolveOwnedResource(clients, brandId, ctx)` + `authorizeApiBrand(ctx, brandId, "recruiter")` unchanged. `org_id` still `ctx.effectiveOrgId!`. **Ignore any body `client_id` entirely** (acceptance: *"never requires/accepts `client_id`"*).
- **`POST /api/admin/campaigns/from-job-spec`** (`route.ts:40`): same — derive `clientId` from `ctx.activeBrandId`, not `formData.get("client_id")`.
- **`GET /api/admin/campaigns/check-slug`**: derive the brand from `ctx.activeBrandId` instead of the `client_id` query param (campaign slugs are per-brand, `findAvailableCampaignSlug(clientId, base)` in `src/lib/slug.ts`).
- The **"All"** active-brand state (owner/admin) has no concrete brand → the wizard must require picking a brand first (Frontend); the API's `400` is the backstop.

#### 7. Brand-slug oracle hardening (Review correction — major)

Two parts, both recommended together (the slice offers "operator approval **or** generic unavailable + rate-limit/auth"; with S9 not yet providing operator approval, harden the existing self-service path):
- **De-oracle `check-slug`** (`src/app/api/admin/clients/check-slug/route.ts`): (a) swap `requireApiAuth()` → `getApiTenant()` + `authorizeApiOrg(ctx,"manage_brand")` (only an org_admin who could create a brand may probe); (b) **stop confirming cross-org existence** — return `{available:false}` indistinguishably for *taken-by-anyone*, *reserved*, and *invalid* (a generic `available` boolean is still an oracle if it says "true" only when globally free; keep it, but pair it with the rate-limit below so it can't be enumerated, and ensure the response carries no org/owner detail — it already carries none). (c) The authoritative collision check stays at `clients` POST/PATCH, which returns a generic *"This name isn't available"* (tighten the current `"This slug is already taken"` message so it doesn't assert cross-org existence).
- **Per-org rate-limit (net-new).** No limiter exists. Add a minimal one (in-memory token bucket keyed by `org_id` is sufficient for V1 — a shared module e.g. `src/lib/rate-limit.ts`) on `check-slug` and `clients` POST. Cap e.g. 10 slug checks / minute / org; 429 past the cap. Keep it cheap on the hot path. (A durable limiter is out of scope; note the in-memory caveat for multi-instance deploys.)
- **Defence-in-depth:** wrap the `clients` insert in try/catch for the DB unique-violation as a backstop behind the pre-check (the global unique index is the real guarantee).

#### 8. Public route allow-listing (`src/proxy.ts`)

The accept-invite **page** is public (the invitee has no session). Add it next to the password-reset block (`proxy.ts:54-57`):
```ts
if (pathname === "/accept-invite" || pathname.startsWith("/accept-invite/")) {
  return NextResponse.next();
}
```
The accept **API** (`/api/auth/invite/accept`) is already exempt — `proxy.ts:19-25` early-returns all `/api/*`. The invite *create* route lives under `/api/admin/*` and is guarded by `getApiTenant` in-handler.

### Frontend Changes

> **The `frontend-design` skill is MANDATORY for every screen below** (project standard, plan §11). Build against the `globals.css` Tailwind v4 tokens (`cobalt`/`cobalt-tint`, `ink`, `surface`/`paper`, `border`, `vermillion`, `green`/`warning`/`red`, `font-serif`/`font-sans`/`font-mono`) and reuse `ConfirmModal`, `EmptyState`, `useToast`, `TierBadge`. §11 intent for S8: a role-aware shell, a *polished* brand switcher (the org's brands + "All"), and an empty-state-rich Members page; the invite/accept screens stay **minimal** ("Clerk replaces them in S15 — don't over-build", §11).

**0. New `TenantProvider` (the linchpin).** Create `src/components/admin/tenant-provider.tsx` (`"use client"`) exposing a `useTenant()` hook over a small, serialisable subset of `ctx` (`{ userId, orgRole, isOperator, actingOrgId, activeBrandId }`) **plus** the caller's accessible brands (`{id,name}[]`) and org name — all resolved server-side in the layout. In `(admin)/layout.tsx` (the file S7 also edits — coordinate), after the S7-captured `const ctx = await requireTenant()`, fetch brands (`getBrandMemberships` for members; all in-org `clients` for owner/admin/acting-operator) + the org name, and wrap: `<TenantProvider value={...}><ToastProvider>{children}</ToastProvider></TenantProvider>`. This is how the client sidebar/switcher learn the role without re-calling the server-only `requireTenant()`.

**1. Sidebar role gating + two label renames (`src/components/admin/sidebar.tsx`).** Consume `useTenant()`. In `NAV_ITEMS` do **two label-only renames**, each keeping its href (S14 moves the routes): `"Clients"`→`"Brands"` (keep `href:"/clients"`) and `"Users"`→`"Members"` (keep `href:"/users"`) — there is already a Users item, so this is a rename, not an add (Resolved Decision 3). Gate **Brands / Members / Settings** to `orgRole === "owner" || orgRole === "org_admin"` (or `isOperator && actingOrgId`); **Dashboard / Campaigns** stay visible to all. Keep the `pathname.startsWith` active state; ensure brand-scoped pages still highlight correctly.

**2. Header: org name + BrandSwitcher (`(admin)/layout.tsx` → `#admin-header-slot`, `:31`).** New `src/components/admin/brand-switcher.tsx` (`"use client"`, reads `useTenant()`): a dropdown listing the caller's brands, plus an **"All brands"** entry **only for owner/admin/acting-operator**. Selecting an item `POST /api/admin/active-brand {brandId|null}` then `router.refresh()` so RSC reads re-scope. Show the current org name beside it (control-plane affordance). A plain single-brand member needs no switcher (or a static label). Reuse the tier/segment-button styling from `clients/[id]/edit/page.tsx:268-297` for the trigger.

**3. Act-as banner integration.** S7 renders the banner in the layout; S8 **relocates** it beside the org-name/BrandSwitcher cluster (S7 built it as a single component reading `ctx.actingOrgId` precisely so this is a move, not a rewrite). Preserve S7's status-aware treatment (suspended/deleted styling). If both the dev-port banner and act-as banner can show, combine sticky offsets (`top-[calc(var(--dev-banner-h,0px)+var(--act-as-banner-h,0px))]`) using the `dev-port-banner.tsx:46-62` height-publishing pattern.

**4. Members page — repurpose the existing `src/app/(admin)/users/page.tsx` (Resolved Decision 3; keep the `/users` route, S14 renames it).** Client component, gated server-side by the org-scoped reads (UI gating cosmetic). Fetch `GET /api/admin/users` (now org-scoped, with brand + brand_role). Table: name, email, org_role pill, brand + brand_role, status dot (reuse `clients/page.tsx:241-251`). Primary action **"Invite member"** opens an invite modal (email + brand `<select>` from `useTenant()` brands + role select: org-level owner/admin **or** brand role) → `POST /api/admin/members/invite` → `useToast` success/error; a pending-invites section is a nice-to-have. `EmptyState` when no members. **Retire the old direct-create-user form** (S5 mandate: *"new-user form → invite flow"*) — edit/deactivate still go through `users` PATCH/DELETE. Do **not** add a parallel `/members` route. Note in the PR that the route still reads `/users` (label is "Members") and S14 completes the rename.

**5. Accept-invite page (`src/app/accept-invite/page.tsx`, new, PUBLIC).** Outside `(admin)` (no shell, no `requireTenant`). Reads `?token=`, renders a minimal set-password form (first name, last name, password + confirm), `POST /api/auth/invite/accept`, on success `router.push("/dashboard")` (the session cookie is already set). Mirror the visual language of the existing reset-password page. Invalid/expired token → a friendly dead-end with a "request a new invite" hint. **Do not over-build** (§11).

**6. Wizard active-brand context (`src/components/admin/campaign-wizard.tsx`, `campaigns/new/from-job-spec/page.tsx`).** Remove the client `<select>` (`campaign-wizard.tsx:560-581`; from-job-spec `:240-259`); instead show the **active brand as fixed, read-only context** (name + the existing `ClientBrandingSummary`), sourced from `useTenant().activeBrandId`/brands. Drop `client_id` from the POST body (`:441`) and the from-job-spec FormData. **If the active brand is "All"** (owner/admin), block step 1 with an inline prompt ("Choose a brand from the switcher to create a campaign in") rather than POSTing — the API's `400` is the backstop. Update the wizard's slug-availability fetch to stop sending `client_id` (the server derives it).

### Edge Cases and Boundary Conditions

- **`activeBrandId` is a filter, never a boundary.** A tampered/foreign `active_brand` cookie is rejected by the per-request `canAccessBrand` re-check → falls back to `null` (no narrowing) on reads, and is **explicitly 403'd** by `POST /api/admin/active-brand`. `org_id` (via `orgScope`) remains the hard boundary regardless.
- **Campaign create with "All" / no active brand.** API returns `400`; wizard blocks before POST. Owner/admin must pick a concrete brand.
- **Invite cannot cross orgs.** `invitations.org_id` is `ctx.effectiveOrgId`; accept creates the user with `org_id: inv.org_id`. There is no path for an invitee to land in another org (acceptance: *"invite can't join another org"*).
- **Expired / used tokens rejected.** `accepted_at IS NOT NULL` or `expires_at <= now` → `400` at accept (acceptance). Single-use is the `accepted_at` stamp.
- **Login resolvability under per-org email uniqueness (S2 rule).** `users` is `unique(org_id, email)`, so the same email *could* exist in two orgs — but `login/route.ts` **fails closed when >1 row matches**. So both invite-create and accept must enforce **global tenant-email uniqueness** (reject if any `is_operator=false` user already has the email) — otherwise the new user (and the colliding one) silently cannot log in. This matches the V1 decision (plan §12.1) and should be a test.
- **Org-level (no-brand) invite into an empty org.** `users.client_id` is now nullable (Resolved Decision 1), so an org-level Owner/Org-Admin accepts with `client_id: null` and **no membership row** — `org_role` grants cross-brand reach. This is the S9 bootstrap (Owner accepts into an org with zero brands, then creates the first brand). Test that such a user logs in, has org-wide access, and that the Members list renders a null brand gracefully (shows "org-level" / all brands).
- **Re-invite / resend.** The partial unique `(org_id,email) WHERE accepted_at IS NULL` permits exactly one live invite; resending must supersede (mark old accepted/expired) or 409 — pick one and test it.
- **Pending invite for an email that then self-registers elsewhere** is blocked by the global-email guard at accept time (re-check, not just create time).
- **Members reads exclude operators** (`is_operator=false`) and other orgs — verify a tenant admin's Members list never shows the seeded operator or another org's users (this is the S4 carry-over being closed).
- **Brand switcher for acting operators (S7).** An acting operator is owner-equivalent in the acted org → sees all that org's brands + "All". Confirm `canAccessBrand` returns allow for `isOperator && actingOrgId` (it does, `rbac.ts:84`).
- **Slug oracle.** A logged-in org_admin cannot enumerate other orgs' brand slugs faster than the rate-limit; `check-slug` confirms no cross-org owner/identity; public apply by `(brandSlug, campaignSlug)` still resolves (acceptance) because the global namespace is intact.

### Test Plan

Extend the `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial), reusing the two-org fixture + `login()` session mock + the `@/lib/email`/`@/lib/queue` stubs from `src/lib/isolation.itest.ts` (orgs A/B, owner/org_admin/brand_admin/recruiter/viewer, operator with `org_id NULL`). Add an `invitations.itest.ts` (and unit tests where DB-free).

- **DB-free unit tests (`npm test`):**
  - `brandScope`: `activeBrandId` set → `eq(client_id, …)`; null → `undefined`.
  - `activeBrandId` validation: a brand the caller can access → honoured; foreign/non-member brand → coerced to null (mock `canAccessBrand`).
  - Invite role validation: brand invite requires a valid `brand_role`; org invite requires `org_role` within the actor's authority (`canAssignOrgRole`).
  - `invitationEmail` template renders the accept URL.
- **DB-backed integration tests (gated):**
  1. **Invite RBAC:** recruiter/viewer/brand_admin → `POST /members/invite` **403**; org_admin/owner → **201** with an `invitations` row (`token_hash`, `expires_at`, pending).
  2. **Accept happy path:** valid token + password → creates an org-scoped user + membership (brand_role as invited), stamps `accepted_at`, sets `admin_session`, and the new user can subsequently be resolved only within Org A. A **recruiter** invite yields a user limited to the chosen brand (acceptance).
  3. **Token hardening:** expired token → 400; already-accepted token → 400; unknown token → 400.
  4. **Cross-org containment:** an Org A invite accepted creates a user with `org_id = A` only; no path to Org B (acceptance: "can't join another org").
  5. **Global-email guard:** inviting/accepting an email already used by a tenant user in Org B → rejected (preserves login).
  6. **`activeBrandId`:** `POST /api/admin/active-brand {brandId: brandA}` as an Org A member → success; as a non-member of that brand → **403**. With the cookie active (mock `getActiveBrandCookie`), a campaigns GET returns only brand-A campaigns; cleared → all accessible.
  7. **Brand-derived campaign create:** `POST /api/admin/campaigns` with **no** `client_id` and an active brand A → **201** under brand A; with a body `client_id: brandB` present, it is **ignored** (campaign still under A); with **no** active brand → **400**.
  8. **Members reads scoped:** Org A admin `GET /api/admin/users` returns only Org A non-operators (not Org B users, not the operator); `GET /api/admin/users/[orgB-user]` → **404**. (Regression test for the S4 carry-over.)
  9. **Slug oracle:** `check-slug` requires org_admin (recruiter → 403); over-limit calls → 429; a slug taken by another org returns a generic unavailable with no cross-org detail; public apply by slug still resolves.
- **Build/typecheck:** `npm run build` — the `TenantContext.activeBrandId` addition + `tenantFromSession` change must compile across the seam (and must merge cleanly with S7's edits to the same symbols).

### Suggested Implementation Order

> Branch from / rebase onto S7 first (shared `layout.tsx` + `tenant.ts`).

1. **Schema + migration:** add `invitations` + relations to `schema.ts`; drop `.notNull()` from `users.client_id` + hand-add `ALTER TABLE "users" ALTER COLUMN "client_id" DROP NOT NULL;` (Resolved Decision 1); `npm run db:generate` (renumber after rebasing onto S7); `npm run db:migrate`.
2. **Seam:** `activeBrandId` on `TenantContext` + `tenantFromSession` (coordinate with S7), `getActiveBrandCookie` in `auth.ts`, `brandScope` helper. Unit-test validation.
3. **Members reads org-scoping** (close the S4 carry-over) — small, isolated, independently shippable.
4. **Invite routes:** `POST /api/admin/members/invite` + `POST /api/auth/invite/accept` (+ `invitationEmail` template + `proxy.ts` public path). Unit/integration-test the token + cross-org + global-email logic first.
5. **Brand-derived campaign create:** campaigns POST + from-job-spec + check-slug derive from `activeBrandId`.
6. **Slug-oracle hardening:** de-oracle `check-slug` + add `src/lib/rate-limit.ts` + tighten `clients` POST messaging.
7. **`active-brand` set route.**
8. **Frontend (frontend-design skill), after the routes exist:** `TenantProvider`, role-aware sidebar + the two label renames (Clients→Brands, Users→Members), BrandSwitcher + org name in the header (+ relocate S7's banner), repurpose `/users` into the Members page + invite modal, public accept-invite page, wizard active-brand context.
9. **Tests:** the gated integration matrix above; `npm run build`.

### Resolved Decisions

1. **Org-level invite + the `users.client_id` NOT-NULL wrinkle → relax `users.client_id` to nullable now (a scoped S13 pull-forward); org invites set `client_id = null`, brand invites set `client_id = inv.client_id`.** The blocker is real: S9's acceptance has the first Owner accept into an *empty* org (*"a fully isolated, empty, self-controlled org… owner/org_admin create/edit brands"*), so there may be **no brand to point at** at accept time — "resolve to the first brand" would make the entire onboarding bootstrap un-acceptable. Relaxing the column is **safe and verified against the live trigger**: `set_org_id_from_client_user` (`drizzle/0026_tenant_schema.sql:245-252`) fills `org_id` *only* `IF NEW.org_id IS NULL`, and the accept route always sets `org_id` explicitly (`inv.org_id`), so the trigger never reads `client_id` on this path — a null `client_id` is inert. Nothing in the S2–S7 seam reads `users.client_id` for authz (it's `org_role` + `memberships`); the FK tolerates NULL (a NULL FK column is unconstrained); the only reader is the cosmetic `leftJoin` in `users` GET (null → null brand name, which the Members page overrides with the membership view anyway). So:
   - **Migration** (in S8's file, beside `invitations`): `ALTER TABLE "users" ALTER COLUMN "client_id" DROP NOT NULL;` (idempotent/re-runnable). **Schema:** drop `.notNull()` from `users.client_id` in `schema.ts:241-243` so the model matches and `insert({… client_id: null …})` type-checks.
   - **Accept route:** brand invite → `client_id: inv.client_id`; org-level invite → `client_id: null`. No first-brand fallback, no "org must have a brand" precondition.
   - S13 still does the full `DROP COLUMN client_id` later; this only relaxes the constraint early, fully aligned with S13's direction. **Rejected:** "assign the org's first brand" (blocks empty-org onboarding, the exact S9 bootstrap); "push a constraint onto S9 to always create a brand first" (contradicts S9's *empty-org* acceptance and couples S8's correctness to unbuilt S9 behaviour). This makes S8's invite mechanism self-sufficient for S9 to consume.
2. **Invite TTL = 7 days, fixed, one named constant (`INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`).** Unlike the 1-hour password-reset token (immediate self-service), an invite is actioned asynchronously by a colleague, so 1h is far too short; 7 days matches the GitHub/Slack/Linear norm and is short enough to bound the exposure of a credential-granting token. Expiry is not silently extended — **resend re-mints** a fresh token (the create route already supersedes the pending row). Per-tier-configurable TTL is a future hook (cf. S16 limits), not V1. **Rejected:** 1h (too short to action), 30 days (an unaccepted credential-granting token shouldn't live a month).
3. **Repurpose the existing `/users` page into the Members experience; keep the route at `/users` for S8 (S14 renames it to `/members`).** This corrects the earlier draft's "add a Members item + new `/members` route": there is already a **Users** nav item at `/users`, so S8 does **two label renames** (sidebar `Clients`→`Brands`, `Users`→`Members`), each keeping its href, and repurposes the `/users` page (list with brand + brand_role + the invite modal; **retire** the direct create-user form per the S5 mandate). One member surface, no redirect, no parallel route for S14 to reconcile — consistent with the label-only Brands rename. **Rejected:** a new `/members` route + `/users` redirect (two surfaces, more churn, S14 reconciliation); moving the route now (collides with S14's terminology pass).
