# S7 · 🎨 Operator console + audited impersonation (act-as)

> **Phase 2 — Operate + onboard the tenant model**
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** the tenant-less operator surface: list/search orgs, view any org, set tier/plan manually, and **impersonate** so the *same* scoping applies, fully audited.
- **Schema:** NEW `operator_audit` (operator_user_id, action, target_org_id, started_at, ended_at, ip). Impersonation via a **short-lived act-as cookie/claim** read by `requireTenant`, **not** baked into the long-lived JWT.
- **Backend:** `tenant.ts` — active act-as sets `effectiveOrgId = actingOrgId` so S4/S5 scoping transparently applies; without act-as the operator predicate denies tenant data. Operator routes (`requireOperator`): list/search orgs, org detail, PATCH tier/billing_email + audit, POST `impersonate`/`impersonate/exit` (+audit), per-org usage (S10). Validate `isOperator` server-side on every act-as; time-box impersonation; exclude operators from tenant user lists.
- **Frontend:** 🎨 NEW `src/app/(operator)/` console (org list, detail, set-tier, impersonate); global **"Acting as <Org> — Exit"** banner in the `(admin)` layout when `actingOrgId` is set. `(operator)/layout.tsx` calls `requireOperator()` (§5.2).
- **Acceptance:** non-acting operator sees the console and **cannot** load tenant data; after impersonating Org A sees exactly Org A through the normal shell with the banner; exit restores the console; tier/usage readable; every act-as/tier change in `operator_audit`; non-operators 403 on `/api/operator/*`.
- **Depends on:** S4, S5 · **Risks:** highest-risk surface — `requireOperator`-gated, time-boxed, audited, never silently destructive.

---

# Implementation Spec: S7 · Operator console + audited impersonation (act-as)

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s04-read-isolation`, HEAD `715b406` ("Enforce WRITE isolation + RBAC across all mutating routes (S5)"). The branch name is stale; commits run through S5.
**Change type**: **UI/UX** (new `(operator)` console screens + a global act-as banner) **and** backend (seam wiring, operator API routes, new `operator_audit` table). The `frontend-design` skill is **mandatory** for the console UI — see Frontend Changes.

> **Dependency status — S7's hard deps (S4, S5) are landed; S6 is parallel, not a prerequisite.** S4 (read isolation) and S5 (write isolation + RBAC) are committed (`docs/slices/s04-…-DONE.md`, `s05-…-DONE.md`; the `.notNull()`/RBAC code is in the tree). **S6 (integrations hardening) is in flight but S7 does _not_ depend on it.** Both S6 and S7 are siblings under S5 in the plan's Phase-1/2 fan-out (§7); their file sets are **disjoint** — S6 touches `azure-storage.ts`/`init-storage.ts`/blob read+upload routes; S7 touches the identity seam (`tenant.ts`/`auth.ts`/`api.ts`), new `src/app/operator/*` + `src/app/api/operator/*`, a new `operator_audit` table, and the act-as banner in `(admin)/layout.tsx`. **They can land in either order / in parallel with no merge conflict.** The only conceptual adjacency is "per-org usage" (S7 surfaces it, S10 owns the data) — independent of S6's blob work. Do **not** block S7 on S6.

> **AGENTS.md mandate.** This is a modified Next.js 16.2.2. S7 adds new route handlers, a new route-group layout, sets/clears cookies on `NextResponse`, and issues server-side `redirect()`s. **Before writing route/layout/cookie code, read the relevant route-handler, cookies, and `redirect`/`notFound` guides under `node_modules/next/dist/docs/`** — the response/cookie/navigation APIs may differ from training data. Heed deprecation notices.

---

## Codebase Analysis

S7 is overwhelmingly a **wiring** slice: the seam was deliberately built S2→S5 with the act-as branch pre-shaped and **dormant**, so S7 mostly populates one stubbed function and adds the operator-facing surfaces around it.

**The single dormant hook — `getActingOrgId()` (`src/lib/tenant.ts:29-31`):**
```ts
/** S7 wires the act-as cookie; returns null in S2. … */
async function getActingOrgId(): Promise<string | null> {
  return null;
}
```
It is consumed by `tenantFromSession()` (`tenant.ts:36-48`):
```ts
const actingOrgId = session.isOperator ? await getActingOrgId() : null;
return { …, actingOrgId, effectiveOrgId: session.orgId ?? actingOrgId };
```
Because **both** the RSC path (`requireTenant` → `tenant.ts:52-56`) **and** the API path (`getApiTenant` → `api.ts:37-45`) build context through `tenantFromSession`, populating `getActingOrgId` flips on impersonation **everywhere at once**. The downstream machinery is already written for it and explicitly marked "dormant until S7":
- `orgScope(table, ctx)` (`tenant.ts:157-161`) → `eq(org_id, effectiveOrgId)`; non-acting operator → `sql\`false\`` (deny-by-default, §5.5). An acting operator's `effectiveOrgId = actingOrgId`, so every S4 read and S5 write scopes to the acted org with no route change.
- `effectiveOrgRole(ctx)` (`api.ts:58-61`) → returns `"owner"` when `isOperator && actingOrgId` → so RBAC gates (`authorizeApiOrg`/`authorizeApiBrand`) pass owner-level for the acting operator.
- `decideBrandAccess` (`rbac.ts:84`) → `if (actor.isOperator && actor.actingOrgId) return "allow"`.
- `resolveOwnedResource` (`tenant.ts:184-198`) → already org-scopes by `effectiveOrgId`; a non-acting operator gets `null` (→404).

**The operator RSC guard already exists** — `requireOperator()` (`tenant.ts:62-66`) calls `requireTenant()` then `notFound()` if `!isOperator` (404, hide existence, §5.6). **There is no API analog yet** — S7 adds `requireApiOperator()` (403 for non-operators, per the acceptance "non-operators 403 on `/api/operator/*`").

**Identity & session (`src/lib/auth.ts`):** `SessionPayload = {userId, orgId|null, orgRole|null, isOperator}` (`:14-19`); `signToken` (`:21-29`) HS256 via `getAuthSecret()`; `getSession` (`:35-64`) reads the `admin_session` cookie (`COOKIE_NAME`, `:8`) and verifies via `verifyJwt` (`src/lib/token.ts:17-24`, the single edge-safe verifier). The login route (`src/app/api/auth/login/route.ts:40-54`) signs the payload and sets the cookie `{ httpOnly:true, secure: NODE_ENV==="production", sameSite:"lax", path:"/", maxAge: 60*60*8 }`; logout (`src/app/api/auth/logout/route.ts`) clears it with `maxAge:0`. **This is the exact template for the new short-lived act-as cookie.**

**The (admin) shell** (`src/app/(admin)/layout.tsx`): a server component that calls `await requireTenant()` (`:18`) and renders a sticky header with two slots — `#admin-header-default` (`:28`, holds `<ActiveCampaignCount/>`) and an **empty `#admin-header-slot`** (`:31`). The header is sticky at `top-[var(--dev-banner-h,0px)]`. Its comment (`:13-17`) literally states the S7 plan: *"A non-acting operator resolves with effectiveOrgId === null and is let through in S2 … S7's operator console redirects operators here instead."* — i.e. S7 adds (a) a redirect of non-acting operators to the console, and (b) the act-as banner. The sidebar (`src/components/admin/sidebar.tsx`) is a `"use client"` component with hardcoded nav and **no role gating** (S8 adds that).

**Schema (`src/db/schema.ts`):** `organizations` (`:18-33`) holds `tier` (`:24`), `billing_email` (`:25`), `status` (`:26`, active|suspended|deleted) — these are what the operator reads/sets. `users` (`:237-270`) has `is_operator` (`:248`), nullable `org_id`/`org_role` (operators). `clients.tier` (`:51`) still exists as a **legacy copy** (dropped in S13); the operator sets **`organizations.tier`**, the authoritative one. There is **no `operator_audit` table yet** — S7 creates it. The migration convention is hand-written SQL under `drizzle/` with the latest being `0026_tenant_schema.sql`; a no-backfill table can instead be emitted by `npm run db:generate` (drizzle-kit) → `drizzle/0027_*.sql`, applied via `npm run db:migrate` (`src/db/migrate.ts`).

**Route conventions (e.g. `src/app/api/admin/clients/[id]/route.ts`):** dynamic params typed `{ params: Promise<{ id: string }> }` and `await`ed; `const { ctx, response } = await getApiTenant(); if (response) return response;`; RBAC via `authorizeApiOrg(ctx, action)`; resource resolution via `resolveOwnedResource(table, id, ctx)`; **imperative validation (no zod)**; responses via `success(data, status?)`/`error(message, status?)` (`src/lib/api.ts:16-22`). List/filter patterns build a `conditions[]` then `and(...conditions)`, with `db.select({...}).from(...).where(...).orderBy(desc(...)).limit().offset()` and a parallel `count(*)::int` (`src/app/api/admin/campaigns/[id]/candidates/route.ts`). **No client-IP helper exists** — S7 introduces `request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null` for the `operator_audit.ip` column.

**Design system (`src/app/globals.css`):** Tailwind v4 `@theme` tokens — `cobalt`/`cobalt-deep`/`cobalt-tint`, `accent`, `ink`/`ink-soft`/`ink-muted`, `surface`/`paper`/`cream`/`canvas`/`canvas-2`, `border`/`border-strong`/`rule`, status `green`/`red`/`warning`/`vermillion` (+ `-light`/`-soft` tints), fonts `font-serif` (Instrument Serif), `font-sans` (Instrument Sans), `font-mono` (JetBrains Mono). Reusable components: `TierBadge` (`src/components/admin/tier-badge.tsx`; `tier: "standard"|"premium"|"enterprise"`, `size?: "sm"|"md"`), `ConfirmModal` (`src/components/ui/confirm-modal.tsx`; `{open,title,description,confirmLabel?,variant?:"danger"|"confirm",loading?,onConfirm,onCancel}`), `EmptyState` (`src/components/ui/empty-state.tsx`), `useToast()`/`ToastProvider` (`src/components/ui/toast-provider.tsx`; `toast(message, "success"|"error"|"info"|"warning")`). The clients list (`src/app/(admin)/clients/page.tsx`) and detail/edit (`clients/[id]/page.tsx`, `clients/[id]/edit/page.tsx`) are the closest structural analogs for the org directory + detail/set-tier screens. The dev-port banner (`src/components/dev-port-banner.tsx`) is the precedent for a fixed, height-publishing global banner.

**Tech stack:** Next.js 16.2.2 (App Router), Drizzle 0.45.2 over postgres-js (lazy singleton `src/db/index.ts`), `jose` HS256 (`ADMIN_AUTH_SECRET`), vitest 4 with a `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial). No new env var is required — the act-as cookie reuses `ADMIN_AUTH_SECRET`.

## Related Issues

- **S2 (`fef838f`, done)** — built the seam and **pre-shaped** the act-as branch (`getActingOrgId` stub, `actingOrgId`/`effectiveOrgId` on `TenantContext`, the `(admin)` layout chokepoint comment). S7 is the slice S2 was scaffolded for.
- **S3 (`b8a55c7`, done)** — `orgScope`/`assertOwnership`/`resolveOwnedResource` + the RBAC matrix, all already routing through `effectiveOrgId`/`effectiveOrgRole`. S7 reuses these **verbatim**; it adds **no new scoping/RBAC primitives** (only the operator API gate).
- **S4 (`f1989db`, done) + S5 (`715b406`, done)** — every read/write is now `effectiveOrgId`-scoped + RBAC-gated. This is precisely why impersonation needs **zero per-route work**: setting `actingOrgId` makes the operator transparently "become" an Org-A owner across all existing handlers. S5 also already excludes operators from tenant user lists (org-scoped `users` GET; operators have `org_id NULL`).
- **S6 (in flight, parallel — NOT a dependency)** — see the Dependency-status note above. Disjoint files; no ordering constraint.
- **S8 (depends on S5 + S7)** — *"integrate the act-as banner"* into the role-aware shell, rename Clients→Brands, add the BrandSwitcher. **S7 ships the banner first** (a self-contained high-contrast bar in `(admin)/layout.tsx`); S8 refines its placement alongside the brand switcher. Build the S7 banner so S8 can relocate it without a rewrite (a single server component reading `ctx.actingOrgId`).
- **S9 (depends on S7 + S8)** — adds `POST /api/operator/organizations` (provision org + Owner invite) and reworks `seed-admin.ts`. S7 must leave the `api/operator/` namespace and `requireApiOperator()` ready for S9 to extend, and the `operator_audit.action` set open for a `provision_org` value.
- **S10 (depends on S5)** — owns the `usage_events` table and per-org token metering. S7's "per-org usage" is a **forward reference**: see Assumptions.
- **S11 (depends on S6 + S7 + S10)** — adds operator lifecycle actions (`suspend|restore|soft-delete|purge`), which will write **further `operator_audit.action` values** and enforce `org.status` in the seam. S7's `operator_audit` schema and `requireApiOperator` are the foundation; design the `action` column as open free-text (validated against an allow-list in code) so S11/S9 extend it without a migration. **Constraint S7 places on S11 (Resolved Decision 5):** S11's `org.status` gate applies to **tenant** sessions (suspended→403, deleted→401); it must **explicitly exempt operator act-as**, or operators lose the ability to support the very tenants (suspended/deleted) that most need it.

### Assumptions from siblings (do **not** build these in S7)

- **All read/write org-scoping (S4/S5).** S7 does **not** add scoping to `(admin)` routes/pages. Impersonation works because `effectiveOrgId` already drives every query. S7's only seam change is wiring `getActingOrgId` + adding `requireApiOperator`.
- **The `usage_events` table and AI/token metering (S10).** S10 is not yet built. S7's org-detail "usage" therefore shows **only counts derivable from existing tables today** — brands (`clients`), campaigns, candidates `WHERE org_id = :id` — plus a clearly-labelled placeholder panel ("AI/token usage — available after S10"). Do **not** create `usage_events` in S7 (Resolved Decision 4).
- **Role-aware sidebar + brand switcher + Clients→Brands rename (S8).** S7 leaves `sidebar.tsx` untouched; the operator console has its **own** distinct navigation.
- **Org provisioning + `seed-admin` rework (S9).** S7 does not add org-creation. The seeded operator (`is_operator=true`, `org_id=null`, from `SEED_OPERATOR_*` in `src/db/seed-admin.ts`) is the test identity.
- **Lifecycle / `org.status` enforcement (S11).** S7 does **not** block suspended-org login or add suspend/purge. S7's impersonation may target any existing org regardless of status (operators support suspended tenants); status-aware refinements are S11 (see Resolved Decision 5).

## Implementation Plan

### Database Changes

**One new table, no backfill.** Add `operator_audit` to `src/db/schema.ts` (near `passwordResetTokens`/`jobs`), then `npm run db:generate` → `drizzle/0027_<name>.sql`, then `npm run db:migrate`. Clean on a fresh DB and idempotent against the seeded DB (no data migration).

```ts
export const operatorAudit = pgTable(
  "operator_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operator_user_id: uuid("operator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }), // audit outlives the actor
    action: text("action").notNull(), // impersonate | impersonate_exit | set_tier | set_billing_email
                                       // (S9 adds provision_org; S11 adds suspend|restore|soft_delete|purge)
    target_org_id: uuid("target_org_id").references(() => organizations.id, {
      onDelete: "set null", // keep the audit row after an org is purged (S11)
    }),
    metadata: jsonb("metadata"), // {from,to} for tier/billing; org slug/name snapshot for durability
    ip: text("ip"),
    started_at: timestamp("started_at").defaultNow().notNull(),
    ended_at: timestamp("ended_at"), // set on impersonate exit; null for point-in-time actions
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("operator_audit_operator_idx").on(table.operator_user_id),
    index("operator_audit_target_org_idx").on(table.target_org_id),
    index("operator_audit_action_idx").on(table.action),
  ]
);

export const operatorAuditRelations = relations(operatorAudit, ({ one }) => ({
  operator: one(users, { fields: [operatorAudit.operator_user_id], references: [users.id] }),
  targetOrg: one(organizations, { fields: [operatorAudit.target_org_id], references: [organizations.id] }),
}));
```
- **`onDelete: "set null"` on both FKs** (Resolved Decision 3): an audit log must survive deletion of its subject. The denormalised `metadata` snapshot (org slug/name) preserves readability when `target_org_id` is later nulled by an S11 purge. **Note:** with `operator_user_id` set-null, drop `.notNull()` from that column to keep them consistent — or keep `notNull` and accept operators are never hard-deleted in V1. Recommended: **keep `.notNull()`** (operators are permanent in V1) and use `onDelete: "set null"` purely as defence; if a future slice hard-deletes operators, relax to nullable then.
- **Note:** `metadata`/`ip`/`ended_at` are enrichments beyond the bare slice columns (`operator_user_id, action, target_org_id, started_at, ended_at, ip`). `metadata` is justified: auditing a tier change is far more useful with `{from,to}`; the slug snapshot keeps the row legible after purge. Flag it in the PR.

### API / Backend Changes

> **Read the Next.js 16 route-handler + cookies docs first (AGENTS.md).** Cookies are set on the returned `NextResponse` (`res.cookies.set(...)`), mirroring `login/route.ts:48-54`.

#### 1. Seam: wire the act-as cookie (`src/lib/auth.ts` + `src/lib/tenant.ts`)

Keep all cookie/jose reads **inside the seam** (§5.1: CI grep forbids `cookies()`/`jose` outside `auth.ts`/`tenant.ts`). Put the cookie read in `auth.ts` (which already imports `cookies` + `verifyJwt`):

```ts
// auth.ts
const ACT_AS_COOKIE = "operator_act_as";
const ACT_AS_EXPIRY = "60m"; // time-box (Resolved Decision 6)
export const ACT_AS_MAX_AGE = 60 * 60;

export async function signActAsToken(operatorUserId: string, actingOrgId: string): Promise<string> {
  return new SignJWT({ operatorUserId, actingOrgId, kind: "act_as" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt()
    .setExpirationTime(ACT_AS_EXPIRY).sign(getAuthSecret());
}

export async function getActAsClaim(): Promise<{ operatorUserId: string; actingOrgId: string } | null> {
  const token = (await cookies()).get(ACT_AS_COOKIE)?.value;
  if (!token) return null;
  const p = await verifyJwt(token); // signature + expiry; null if expired → auto-exit when TTL lapses
  if (!p || p.kind !== "act_as") return null;
  if (typeof p.operatorUserId !== "string" || typeof p.actingOrgId !== "string") return null;
  return { operatorUserId: p.operatorUserId, actingOrgId: p.actingOrgId };
}
export { ACT_AS_COOKIE };
```
```ts
// tenant.ts — replace the stub; bind the cookie to THIS operator's session
import { getActAsClaim } from "@/lib/auth";
async function getActingOrgId(session: SessionPayload): Promise<string | null> {
  if (!session.isOperator) return null;                 // server-side isOperator gate (slice)
  const claim = await getActAsClaim();
  if (!claim) return null;
  if (claim.operatorUserId !== session.userId) return null; // reject a cookie minted for another operator
  return claim.actingOrgId;
}
// tenantFromSession: const actingOrgId = await getActingOrgId(session);
```
Why a **signed-JWT cookie** (Resolved Decision 1): it's tamper-proof (same `ADMIN_AUTH_SECRET`, no new secret), self-expiring (the TTL **is** the time-box — when it lapses `verifyJwt` returns null and the operator silently drops back to deny-by-default), and operator-bound (the `operatorUserId` cross-check defeats a stolen/replayed cookie). It is **separate from** the long-lived `admin_session` JWT, exactly as the slice requires ("not baked into the long-lived JWT"). No DB read on the hot path.

#### 2. API operator gate (`src/lib/api.ts`)

```ts
export async function requireApiOperator(): Promise<
  | { ctx: TenantContext; response: null }
  | { ctx: null; response: NextResponse }
> {
  const { ctx, response } = await getApiTenant();
  if (response) return { ctx: null, response };
  if (!ctx.isOperator) return { ctx: null, response: error("Forbidden", 403) }; // acceptance: 403
  return { ctx, response: null };
}
```
(API = **403** per acceptance; the RSC `requireOperator` stays **404** to hide the console's existence — consistent with the existing 404-RSC/403-API split.)

#### 3. Operator API routes (new `src/app/api/operator/*`)

All begin with `const { ctx, response } = await requireApiOperator(); if (response) return response;`. Capture IP via the `x-forwarded-for` helper above.

- **`GET /api/operator/organizations`** — list/search. Query `?q=&status=&tier=&limit=&offset=`; build `conditions[]` with `ilike(organizations.name, \`%\${q}%\`)` OR `ilike(organizations.slug, …)`, `eq(status,…)`, `eq(tier,…)`; `orderBy(desc(created_at))`, `limit`/`offset` (clamp limit ≤200), parallel `count(*)::int`. **No `orgScope`** here — the operator legitimately sees all orgs (this is the one surface that does, and it's `requireApiOperator`-gated).
- **`GET /api/operator/organizations/[id]`** — org detail: the `organizations` row + derived counts (`count(*)` over `clients`/`campaigns`/`candidates WHERE org_id = id`). Usage placeholder until S10.
- **`PATCH /api/operator/organizations/[id]`** — set tier / billing_email. Validate `tier ∈ {standard,premium,enterprise}` (imperative). `db.update(organizations).set({tier|billing_email, updated_at:new Date()})`. Write an `operator_audit` row (`action:"set_tier"|"set_billing_email"`, `target_org_id:id`, `metadata:{from,to}`, `ip`, `started_at`+`ended_at` both now — point-in-time). Return `success(row)`.
- **`POST /api/operator/impersonate`** — body `{ orgId }`. Look up the org (404 if missing). **Any org status is allowed** — `active`, `suspended`, or soft-`deleted` (a hard-purged org's row is gone → natural 404); operators must be able to support suspended/deleted tenants (Resolved Decision 5). `signActAsToken(ctx.userId, orgId)`; on the response, `res.cookies.set(ACT_AS_COOKIE, token, { httpOnly:true, secure:NODE_ENV==="production", sameSite:"lax", path:"/", maxAge: ACT_AS_MAX_AGE })`. Insert `operator_audit` (`action:"impersonate"`, `target_org_id:orgId`, `started_at:now`, `ended_at:null`, `ip`, `metadata:{slug,name,status}`). If a prior act-as is active, close its open audit row first (re-impersonation switches target). Return `success`; the client redirects to `/dashboard`.
- **`POST /api/operator/impersonate/exit`** — clear the cookie (`maxAge:0`). `UPDATE operator_audit SET ended_at=now() WHERE operator_user_id=ctx.userId AND ended_at IS NULL` (close the open session row). Return `success`; client redirects to `/operator`.

#### 4. `(admin)` shell wiring (`src/app/(admin)/layout.tsx`)

The layout already resolves `ctx` once via `requireTenant()`. Change it to capture the return and:
1. **Redirect non-acting operators to the console** (the documented `:13-17` plan): `if (ctx.isOperator && !ctx.actingOrgId) redirect("/operator");` — so an operator never sees an empty admin shell.
2. **Render the act-as banner** when `ctx.actingOrgId` is set (fetch the org name by `actingOrgId`). High-contrast, first-class (§11) — see Frontend.

No `src/proxy.ts` change: `/operator/*` is not in `PUBLIC_ADMIN_PATHS` (`proxy.ts:5`) nor `/c/*`, so the optimistic cookie check already protects it; `requireOperator()` in the console layout is the canonical guard. (The app-host vs careers-subdomain split is S12.)

### Frontend Changes

> **The `frontend-design` skill is MANDATORY for every screen below** (project standard, plan §11). Build against the `globals.css` Tailwind v4 tokens (`cobalt`, `ink`, `surface`, `cream`, `border`, `vermillion`, `font-serif`/`font-sans`/`font-mono`) and reuse `TierBadge`, `ConfirmModal`, `EmptyState`, `useToast`. §11 intent: the console must *feel* like an internal **control plane** — dense, data-forward, unmistakably "operator" — so impersonation is never ambiguous; the act-as banner is a **first-class, high-contrast** component.

**Route structure (Resolved Decision 2 — use a real `/operator` segment, not a bare `(operator)` group):** a bare `(operator)` route group whose root `page.tsx` resolves to `/` would **collide** with the landing page (`src/app/page.tsx`) and the `(admin)` group. Create a real segment with its own layout instead:

- **`src/app/operator/layout.tsx`** — server component; `await requireOperator()` (404 for non-operators). A **distinct** control-plane shell (do **not** reuse `AdminSidebar`): dense internal styling (e.g. `bg-ink`/`text-paper` chrome, `font-mono` for IDs), minimal nav ("Organizations"; S9 adds "New organization"), a "Signed in as <operator> — Log out" affordance. Wrap children in `ToastProvider`.
- **`src/app/operator/page.tsx`** — **org directory** (analog of `clients/page.tsx`). Client component fetching `/api/operator/organizations`; search box + status/tier filters; table with `name`, `slug` (`font-mono`), `<TierBadge tier={org.tier}/>`, a status dot (`bg-green` active / `bg-warning` suspended / `bg-red` deleted — reuse the `clients/page.tsx:241-251` dot pattern), `created_at`; row links to `/operator/orgs/[id]`. `EmptyState` when no orgs / no results.
- **`src/app/operator/orgs/[id]/page.tsx`** — **org detail**: header with org name + `<TierBadge size="md"/>` + status badge; **set-tier** control (button-group selector standard/premium/enterprise, mirroring `clients/[id]/edit/page.tsx:268-298`) + billing_email field → `PATCH /api/operator/organizations/[id]` with a `useToast` success/error; derived **counts** (brands/campaigns/candidates); a labelled **usage placeholder** ("AI/token usage — available after S10"); and the **"Act as this organization"** button.
- **`src/components/operator/impersonate-button.tsx`** (`"use client"`) — `POST /api/operator/impersonate {orgId}` → on success `router.push("/dashboard")` (lands in the `(admin)` shell, now scoped to the org, banner showing). Optionally a `ConfirmModal` ("You'll act as <Org> with owner-level access; all actions are audited").
- **The act-as banner** — render in `src/app/(admin)/layout.tsx` (a small server component, e.g. `src/components/operator/acting-as-banner.tsx`, given the org name **and status**). High-contrast full-width bar (`bg-cobalt` or `bg-ink`, `text-paper`, `font-medium`): **"Acting as {Org} — Exit"**. **When the target org is not `active`**, use a distinct treatment (e.g. `bg-warning` for suspended, `bg-red` for deleted) and append the status — **"Acting as {Org} (suspended) — Exit"** — so the operator is never unaware they are inside a non-active tenant (Resolved Decision 5). The Exit control is a `"use client"` child → `POST /api/operator/impersonate/exit` → `router.push("/operator")`. Place it above the sticky `<header>` (or in the empty `#admin-header-slot` at `:31`); if rendering above the header, account for the `--dev-banner-h` sticky offset (the `dev-port-banner.tsx` height-publishing pattern is the precedent). Build it as a single component reading `ctx.actingOrgId` so **S8 can relocate it** beside the brand switcher without a rewrite.

### Edge Cases and Boundary Conditions

- **Non-acting operator cannot load tenant data.** `effectiveOrgId === null` → `orgScope` emits `sql\`false\`` → all `(admin)` reads return empty / `resolveOwnedResource` → 404. The layout additionally redirects them to `/operator`. Assert both.
- **Operator API gate.** Every `/api/operator/*` returns **403** for a non-operator (tenant owner included) and **401** when unauthenticated. (RSC `/operator/*` returns **404** for non-operators — existence hidden.)
- **Act-as cookie binding.** A cookie whose `operatorUserId` ≠ the session user is ignored (`getActingOrgId` returns null) — defeats cookie theft/replay across operators.
- **Time-box expiry.** When the 60-min act-as JWT expires (Resolved Decision 6), `verifyJwt` → null → `getActingOrgId` returns null. The operator's **next `(admin)` request** resolves `actingOrgId=null`, and the `(admin)` layout redirect (§4.1) bounces them to `/operator` — no empty-data limbo. To continue, the operator **re-impersonates** (re-mints the cookie + writes a fresh audited row); there is no silent sliding renewal. **`ended_at` reconciliation:** `ended_at` is written only on explicit `exit` / re-impersonate (both close open rows). A row with `ended_at IS NULL` **and** `started_at < now() − TTL` therefore means "expired without explicit exit"; treat its effective end as `started_at + TTL` **when reporting** (a read-side rule — no background writer needed).
- **Re-impersonation / target switch.** Impersonating Org B while acting as Org A overwrites the cookie; close A's open audit row before opening B's so sessions don't overlap.
- **Operators excluded from impersonated org's user list.** Inherited from S4/S5 (org-scoped `users` GET; operators have `org_id NULL`, never match `effectiveOrgId`). Verify under act-as.
- **Acting operator is owner-equivalent — and audited.** Under act-as the operator can perform owner-level mutations in the org. Every entry was reached via an audited `impersonate`; tier/billing changes are independently audited. **Never silently destructive** (slice risk) — destructive lifecycle ops are S11 (confirmation-gated).
- **Tier lives on the org, not the brand.** The operator sets `organizations.tier`; `clients.tier` is a legacy copy (S13 drops it). Don't write `clients.tier` here.
- **Cross-org id under act-as.** Acting as Org A, an Org-B candidate/campaign id still 404s (resolve scopes to `actingOrgId`). Assert.

### Test Plan

Extend the `DATABASE_URL`-gated integration project (`vitest.integration.config.ts`, `*.itest.ts`, serial) and reuse the two-org fixture + `login()` session-mock pattern from `src/lib/isolation.itest.ts` (orgs A/B, roles, and an `operator` with `org_id NULL`, `is_operator=true`).

- **DB-free unit tests (`npm test`):**
  - `getActingOrgId`/`getActAsClaim`: valid act-as claim for the session operator → returns `actingOrgId`; claim bound to a **different** operator → null; non-operator session → null; malformed/expired token → null (mock `verifyJwt`).
  - `requireApiOperator`: operator → `{ctx}`; tenant user → 403; unauthenticated → 401.
  - `operator_audit` action allow-list validation (impersonate/exit/set_tier/set_billing_email).
- **DB-backed integration tests (gated):**
  1. **Console authz:** tenant owner → `GET /api/operator/organizations` → **403**; `POST /api/operator/impersonate` → **403**. Operator → list returns all orgs.
  2. **Deny-by-default:** operator with no act-as → an `(admin)` GET handler returns empty / 404; `resolveOwnedResource` → null.
  3. **Impersonate flow:** operator `POST /impersonate {orgId: A}` → response sets `operator_act_as` cookie + writes an `impersonate` audit row (`started_at` set, `ended_at` null). With the act-as claim active (mock `getActAsClaim` to return `{operatorUserId, actingOrgId:A}`), an `(admin)` read returns **exactly Org A**; an Org-B id → **404**.
  4. **Exit:** `POST /impersonate/exit` clears the cookie and sets the open audit row's `ended_at`; subsequent reads are deny-by-default again.
  5. **Set tier:** `PATCH /api/operator/organizations/[A]` `{tier:"premium"}` updates `organizations.tier` and writes a `set_tier` audit row with `metadata.{from,to}`.
  6. **Audit completeness:** every impersonate + tier change produced an `operator_audit` row with `operator_user_id`, `target_org_id`, `ip`.
  7. **Suspended-org act-as (Resolved Decision 5):** impersonating an org with `status="suspended"` **succeeds** (no status block on the operator path); the audit row's `metadata.status` records it. (S11 will add the assertion that its tenant-session status gate does not affect this path.)
- **Build/typecheck:** `npm run build` — the `getActingOrgId(session)` signature change and the new `requireApiOperator` must compile across the seam.

### Suggested Implementation Order

1. **Schema + migration:** add `operator_audit` + relations to `schema.ts`; `npm run db:generate` → `0027_*`; `npm run db:migrate`.
2. **Seam wiring:** `auth.ts` (act-as cookie sign/read helpers) + `tenant.ts` (`getActingOrgId(session)`) + `api.ts` (`requireApiOperator`). Unit-test the binding/expiry logic first.
3. **Operator API routes:** list/detail/patch-tier + impersonate/exit, each writing `operator_audit`.
4. **`(admin)` shell:** redirect non-acting operators to `/operator`; add the act-as banner component.
5. **Operator console UI** (frontend-design skill): `operator/layout.tsx` + directory + detail/set-tier + impersonate button. Build **after** the routes exist so it renders against real data.
6. **Tests:** unit (seam/gate) + the gated integration matrix; `npm run build`.

### Resolved Decisions

1. **Act-as carrier — a separate short-lived signed-JWT cookie (`operator_act_as`), validated in the seam.** Reuses `ADMIN_AUTH_SECRET` (no new secret), is tamper-proof, self-expiring (the JWT TTL *is* the time-box), and operator-bound (cross-check `operatorUserId` vs the session). Read only inside `auth.ts`/`tenant.ts` (§5.1). **Rejected:** baking `actingOrgId` into the long-lived `admin_session` JWT (the slice forbids it — would survive re-login and lose the short TTL); a DB-only "active impersonation" row as the source of truth (adds a hot-path read for no V1 benefit; the audit row is the *record*, not the *gate*).
2. **Console lives at a real `/operator` segment (`src/app/operator/`), not a bare `(operator)` route group.** A bare group's root `page.tsx` collides with `src/app/page.tsx` at `/`. A real segment with its own `layout.tsx` calling `requireOperator()` gives a clean `/operator/*` namespace and a distinct shell. (The plan's `(operator)` label maps to this segment.)
3. **`operator_audit` outlives its subjects.** Both FKs use `onDelete: "set null"` and the row snapshots org slug/name into `metadata`, so an S11 org purge / future operator removal never erases the audit trail. Enrichment columns `metadata`/`ip`/`ended_at` are kept (justified above); `action` is open free-text validated in code so S9 (`provision_org`) and S11 (`suspend|restore|soft_delete|purge`) extend it migration-free.
4. **"Usage" in S7 = counts derivable today; AI/token usage is deferred to S10.** S7 shows brand/campaign/candidate counts (`count(*) WHERE org_id = :id`) plus a labelled placeholder. S7 does **not** create `usage_events` (S10 owns it). Satisfies the acceptance's "tier/usage readable" without pulling S10 forward.
5. **Impersonation is allowed against an org of *any* status; the banner surfaces it.** Operators exist to support tenants — most acutely *suspended* ones (billing disputes, abuse investigation, pre-purge forensics) — so act-as is permitted on `active`, `suspended`, and soft-`deleted` orgs (a hard-purged org's row is gone → natural 404). Deny-by-default governs **tenant** sessions, not operator act-as. The act-as banner displays the target's status with a distinct treatment when it is not `active` (Frontend), and `operator_audit.metadata.status` records the status at impersonation time. **This places a constraint on S11:** its `org.status` enforcement (tenant login: suspended→403, deleted→401) must **explicitly exempt operator act-as**, else operators are locked out of exactly the tenants needing support. **Rejected:** blocking act-as on suspended/deleted (defeats the operator's support purpose); silently allowing it with no visual cue (an operator unknowingly acting inside a dead tenant is a footgun).
6. **Act-as time-box = 60 minutes, fixed, no sliding renewal.** Long enough for a real support session, short enough to bound blast radius; one named constant (`ACT_AS_EXPIRY`/`ACT_AS_MAX_AGE`) keeps it tunable. **No sliding/auto-renew in V1** — that would force the seam to re-issue tokens per request and erode the time-box. Extending a session = **re-impersonate** (re-mints the cookie + writes a fresh audited row) — the intended, audited path to continue. On expiry the next `(admin)` request resolves `actingOrgId=null` and the layout redirect (§4.1) bounces the operator to `/operator`, so there is no empty-data limbo. **Rejected:** 30 min (too short for substantive support work; the silent mid-task drop is a poor UX); sliding renewal (undermines the time-box and complicates the read-only seam). Per-tier-configurable TTL is a future hook (cf. the S16 limits), not V1.
7. **Tenant-side audit (plan §12.5) is deferred to its own org-scoped table — never `operator_audit`.** Whether Owner actions (password reset, role grants) are audited is a broader product decision outside S7's operator-only scope. When it lands it must use a **new org-scoped `audit_log`** (`org_id`, `actor_user_id`, `action`, target refs, `metadata`), readable by org admins — **not** `operator_audit`, which is intentionally tenant-less (no `org_id`), operator-keyed, and `requireOperator`-gated. Conflating them would break the isolation model (operator rows have no org boundary; tenant rows must be org-scoped and tenant-readable). Natural home: alongside S11 lifecycle or a dedicated slice. §12.5 is thus **resolved as "deferred with design note,"** not built in S7.

### Open Questions

**None — all three prior open questions are resolved above (Resolved Decisions 5–7):** suspended/deleted-org impersonation (allowed, banner-flagged, with an S11 constraint), the act-as time-box (60 min fixed), and tenant-side audit (deferred to a separate org-scoped `audit_log`).
