# CT1 · Theme data model + resolver + email refactor + snapshot-freeze

> **✅ DONE** — implemented 2026-06-19 (`3776e22`). Migration `0032`, `src/lib/theme.ts`, theme-bound `email.ts`, call-site wiring (apply / worker ×3 / request-access), activation freeze (campaigns POST + PATCH), and the seeded gallery theme are all in. Verified: 11 email templates render byte-identical under `DEFAULT_EMAIL_THEME` (committed snapshot), 15 resolver/freeze unit tests, 5 activation/render-preference integration tests; `npm run build` clean. All acceptance criteria met.

> **Campaign Themes — Phase 1 (V1 core, ships invisibly).** Extracted from the [Campaign Themes spec](../campaign-themes-spec.md) (§6, §7). Slice IDs CT1–CT4 are stable references for tracking.

- **Goal:** introduce the theme data model, a single resolution function, refactor the email kit to be theme-bound, and freeze the resolved look at activation — with **zero visible change** (the default theme reproduces today's TalentStream look).
- **Backend:** `0032` migration: new `themes` table + `clients.default_theme_id` + `campaigns.theme_id` + `campaigns.theme_snapshot` (`schema.ts`). New `src/lib/theme.ts` (`EmailTheme`, `DEFAULT_EMAIL_THEME`, `resolveCampaignTheme`, `freezeCampaignTheme`). Refactor `src/lib/email.ts` into a theme-bound `makeEmailKit(theme)`; add a leading `theme` param to the 9 candidate templates; keep `passwordResetEmail`/`invitationEmail` on `DEFAULT_EMAIL_THEME`. Wire the resolver into every candidate-email call site and write `theme_snapshot` on activation. Seed one gallery theme.
- **Frontend:** none.
- **Acceptance:** every existing email renders **byte-identical** under `DEFAULT_EMAIL_THEME` (snapshot regression); a campaign whose brand/campaign theme is set renders that palette + logo + footer flag; `theme_snapshot` is written when a campaign goes active and is preferred at render; drafts resolve live; a gallery default exists after seed.
- **Depends on:** none (foundation). · **Risks:** email-client regression (mitigated by the byte-identical snapshot guard); `email.ts` is a large refactor — keep the MSO/`@media`/inline-CSS shell intact (`email.ts:318-389`); don't theme the two non-campaign templates.

---

## Scope detail

### Database (`src/db/schema.ts`)
- **`themes`** table per the spec §6 (gallery vs custom via `scope` + nullable `org_id`/`client_id`; baked `palette` jsonb + `font_*` + `logo_*` + `show_powered_by`; optional `landing_html` for CT4; `preview_image_url`; `created_by`). Indexes on `org_id`, `client_id`.
- **`clients.default_theme_id`** and **`campaigns.theme_id`** — both `uuid … references(() => themes.id, { onDelete: "set null" })`, nullable (a deleted theme degrades to inheritance).
- **`campaigns.theme_snapshot`** — `jsonb`, nullable; `{ email: EmailTheme, landingHtml: string|null, theme_id: string|null, frozen_at: string }`.
- `npm run db:generate` → `drizzle/0032_*.sql` → `npm run db:migrate` (latest committed is `0031_lean_sharon_ventura.sql`).

### Resolver + freeze (`src/lib/theme.ts`, new)
- `EmailTheme` interface + `DEFAULT_EMAIL_THEME` reproducing today's `C` palette (`email.ts:196-208`), `FONT_*` (`:213-216`), TalentStream funnel wordmark, `showPoweredBy: true`.
- `resolveCampaignTheme(campaign)` → `{ email, landingHtml }` via `campaign.theme_id ?? brand.default_theme_id ?? GALLERY_DEFAULT`; a gallery theme with `logo_url=null` adopts the brand's `branding_logo_url`/`logo_background`/`logo_position` (`schema.ts:68-74`).
- `freezeCampaignTheme(campaign)` → the `theme_snapshot` object; unit-tested to equal the live resolver output.

### Email refactor (`src/lib/email.ts`)
- `makeEmailKit(theme)` returns `{ wrapTemplate, emailHeading, emailP, emailNote, emailBtn, emailInfoCard, emailFallbackLink, brandHeader }` closed over `theme` (replaces module-level `C`/`FONT_*` reads).
- `brandHeader(theme)` → `<img>` from `theme.logo` (sized/positioned like `prompt-builder.ts:132-141`) when present; TalentStream wordmark only for `DEFAULT_EMAIL_THEME`.
- `wrapTemplate(theme, body)` footer renders "Powered by TalentStream" only when `theme.showPoweredBy` (`:378-381`).
- Candidate templates gain a leading `theme: EmailTheme` param: `applicationReceivedEmail`, `gatingPassedEmail`, `gatingFailedEmail`, `rejectionEmail`, `chatInvitationEmail`, `chatAccessEmail`, `chatNudgeEmail`, `noResponseEmail`, `rejectionConfirmationEmail`.

### Call-site wiring (resolve once; pass `email` theme beside the existing `brandEmailIdentity`)
- `src/app/api/apply/[clientSlug]/[campaignSlug]/route.ts:191-199`
- `src/lib/queue/worker.ts` — `handleEmailJob` (`:104-174`), `handleChatInvitation` (`:224-235`), `handleChatNudge` (`:338-350`); extend the existing `candidate.campaign.client` select with `default_theme_id`/`branding_logo_url`/`logo_*` + `campaign.theme_id`/`theme_snapshot`.
- `src/app/api/chat/request-access/route.ts:82-87` — now themed (and may pass `brandEmailIdentity`).
- **Render preference:** `const theme = campaign.theme_snapshot?.email ?? (await resolveCampaignTheme(campaign)).email`.

### Activation hook (RD-1)
- In the campaign create/publish path (`POST /api/admin/campaigns` with `status:"active"`, and any draft→active transition in the campaigns PATCH route) call `freezeCampaignTheme` and persist `theme_snapshot`. Composes with the draft-only edit constraint, so the freeze happens exactly once.

### Seed (`src/db/seed.ts`)
- Insert one gallery theme (`scope:'gallery'`, `org_id`/`client_id` null, `show_powered_by:true`, palette = today's `C`) so tenants have a pickable default from day one.

## Tests
- **Unit:** resolver precedence (campaign > brand > gallery); gallery logo fallback + logo-less brand → wordmark; `freezeCampaignTheme` == live resolver; powered-by toggles footer; `brandHeader` `<img>` vs wordmark; **snapshot: each candidate template under `DEFAULT_EMAIL_THEME` == pre-refactor output**.
- **Integration:** activation writes `theme_snapshot`; render prefers snapshot for active, live for draft; a branded campaign email carries brand palette + logo (+/− powered-by).
- `npm run build` clean with new columns/exports.

---

# Implementation Spec: CT1 · Theme data model + resolver + email refactor + snapshot-freeze

**Generated**: 2026-06-19
**Codebase snapshot**: branch `member-brand-access` @ `362590c`
**Change type**: Backend-only (the slice declares **Frontend: none**; no UI/UX work, so no `frontend-design` involvement in CT1)

---

## Codebase Analysis

Everything this slice touches already exists in a shape that parameterises cleanly.

- **`src/lib/email.ts` (571 lines)** — the refactor target. Module-level constants `C` (palette, `:196-208`), `FONT_DISPLAY` (`:213-214`), `FONT_SANS` (`:215-216`). A helper kit that all read those constants: `emailHeading` (`:218`), `emailP` (`:226`), `emailNote` (`:230`), `emailBtn` (`:234`), `emailInfoCard` (`:243`), `escapeHtml` (`:266`, unchanged — pure), `emailFallbackLink` (`:275`), `brandHeader` (the TalentStream funnel-wordmark, `:286-316`), `wrapTemplate` (document shell + hard-coded footer, `:318-389`; footer text at `:378-381`). Nine candidate templates each call `wrapTemplate(...)`: `applicationReceivedEmail` (`:391`), `gatingPassedEmail` (`:405`), `gatingFailedEmail` (`:453`), `rejectionEmail` (`:466`), `chatInvitationEmail` (`:479`), `chatAccessEmail` (`:495`), `chatNudgeEmail` (`:514`), `noResponseEmail` (`:535`), `rejectionConfirmationEmail` (`:553`). Two non-campaign templates — `passwordResetEmail` (`:418`) and `invitationEmail` (`:433`) — **stay on the default theme, untouched output**.
- **The single metered send path** is `sendCandidateEmail(to, subject, html, candidateId, identity?)` (`:136-189`) — logs `messages` + records the `email_sent` usage event. Themes do **not** touch this; they only change the `html` argument. `brandEmailIdentity(brand)` (`:96-105`) is the existing precedent — a pure per-brand personalisation function plugged in beside the template call. Themes are its visual analogue.
- **`src/db/schema.ts`** — `clients` (`:42-84`) already stores `branding_logo_url` (`:68`), `brand_primary_color`/`brand_secondary_color`/`brand_accent_color`/`brand_text_color` (`:69-72`), `logo_background` (`:73`), `logo_position` (`:74`), `tier` (`:56`). `campaigns` (`:111-151`): `status` defaults `"draft"` (`:129`), no enum constraint. Relations: `clientsRelations` (`:525-532`), `campaignsRelations` (`:553-560`).
- **`src/lib/prompt-builder.ts:132-141`** — the canonical logo-embed reference: `<img>` from `logo.url`, positioned by `logo.position` (`.replace("-", " ")`), surface guidance by `logo.background` (`light`/`dark`/`transparent`), `max-height ~48–64px`. `brandHeader(theme)` mirrors this for the email `<img>`.
- **Migrations** — latest committed is `drizzle/0031_lean_sharon_ventura.sql`. Pure-additive migrations are drizzle-generated only (hand-augmentation in 0026/0031 was for triggers/functions, **not needed here**). `npm run db:generate` (`drizzle-kit generate`) → `npm run db:migrate` (`tsx src/db/migrate.ts`), `package.json:13-14`. Statements separated by `--> statement-breakpoint`.
- **Tests** — colocated. Unit: `src/lib/*.test.ts`, run via `npm test` (`vitest run`). Integration: `src/lib/*.itest.ts`, run via `npm run test:integration` (`vitest.integration.config.ts`, serial, `DATABASE_URL`-gated). There are **no existing email or snapshot tests** — these are new. ⚠️ `*.itest.ts` wipe **all** tables — run them against a throwaway `interview_insider_test` DB, never the dev DB.

### AGENTS.md mandate
This is a **modified Next.js 16**. CT1 only makes minimal edits to two existing route handlers (campaigns POST/PATCH) — no new `redirect`/cookie/`db.transaction` patterns — but per `AGENTS.md`, **read the relevant guide under `node_modules/next/dist/docs/` before editing route-handler code** and heed deprecation notices. Email HTML is its own discipline: the themed `wrapTemplate` must preserve the table layout, inline CSS, MSO conditional block, and `@media` rules (`email.ts:328-344`) byte-for-byte under the default theme.

## Related Issues

This is **CT1**, the foundation of the Campaign Themes group (CT1–CT4), extracted from [`docs/campaign-themes-spec.md`](../campaign-themes-spec.md). **Depends on: none.** Downstream:

- **CT2 — operator theme console** ([ct2](./ct2-operator-theme-console.md)): builds the operator routes that *create/assign* themes (`POST/PATCH /api/operator/themes`, `POST /api/operator/clients/[id]/default-theme`), the `OPERATOR_AUDIT_ACTIONS` additions, and the authoring UI. **Consumes CT1's columns + resolver.**
- **CT3 — tenant theme picker** ([ct3](./ct3-tenant-theme-picker.md)): `GET /api/admin/themes` availability query, the wizard picker, and extends `PATCH /api/admin/clients/[id]` + campaigns POST/PATCH to **accept `theme_id`/`default_theme_id`** and validate against the brand availability set + tier.
- **CT4 — landing integration** ([ct4](./ct4-landing-theme-integration.md)): consumes `theme.landing_html` + `theme_snapshot.landingHtml` in the public render and tier-flips `buildTemplatePrompt`.

### Assumptions from siblings (do NOT build these in CT1)
- **Tier-gating and availability enforcement live in the writers (CT2/CT3), not in CT1.** CT1's `resolveCampaignTheme` is a pure read-side resolver and must render *whatever theme it is handed* — it does **not** check `clients.tier`, nor the `gallery ∪ own-brand` availability set, nor cross-org integrity. Those `400`/`404` validations are added when CT2/CT3 introduce the routes that *set* `theme_id`/`default_theme_id`.
- **CT1 does not accept `theme_id` in any request body.** The campaigns POST/PATCH bodies gain `theme_id` in CT3. In CT1, `campaign.theme_id` and `clients.default_theme_id` are always `null` at runtime (only the columns + the seeded gallery row exist), so the resolver always falls through to the gallery/default rung → **today's look, invisibly**. This is what makes CT1 ship with zero visible change.
- **`landing_html` and `preview_image_url` columns are created in CT1** (part of the `themes` table) but only *consumed* in CT4 (landing render) and CT2/CT3 (preview cards). CT1's resolver returns `landingHtml` in its result and `freezeCampaignTheme` captures it into the snapshot, but no landing-page wiring is built here.
- **No theme-authoring or picker UI** — CT1 seeds exactly **one** gallery theme via `seed.ts`; all theme CRUD is CT2.

## Implementation Plan

### Database Changes

**Migration**: `npm run db:generate` after editing `schema.ts` → `drizzle/0032_<generated>.sql` → `npm run db:migrate`. Pure additive, no backfill (no live tenants). Do not hand-edit the generated SQL.

**1. New `themes` table** in `src/db/schema.ts`, inserted **after `clients` (after `:84`)** and before `memberships`, per spec §6:

```ts
export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  org_id: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),   // null = gallery
  client_id: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),   // null for gallery
  name: text("name").notNull(),
  scope: text("scope").notNull().default("gallery"),         // "gallery" | "custom"
  is_active: boolean("is_active").notNull().default(true),
  palette: jsonb("palette").notNull(),                        // EmailTheme.palette keys (see resolver)
  font_display: text("font_display").notNull(),
  font_sans: text("font_sans").notNull(),
  logo_url: text("logo_url"),                                // null → adopt rendering brand's branding_logo_url
  logo_background: text("logo_background").notNull().default("light"),
  logo_position: text("logo_position").notNull().default("top-left"),
  show_powered_by: boolean("show_powered_by").notNull().default(true),
  landing_html: text("landing_html"),                        // CT4 consumes
  preview_image_url: text("preview_image_url"),              // CT2/CT3 consume
  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("themes_org_id_idx").on(table.org_id),
  index("themes_client_id_idx").on(table.client_id),
]);
```
Note: `themes` references `clients` and `users`, both of which are declared after it if it is placed at `:84`. Drizzle resolves `() => table` references lazily, so forward references compile — placement is for readability only.

**2. Three FK/jsonb columns** (all nullable):
- `clients.default_theme_id`: `uuid("default_theme_id").references(() => themes.id, { onDelete: "set null" })` — add inside the `clients` column block (e.g. after `:74`). A deleted theme degrades to inheritance.
- `campaigns.theme_id`: `uuid("theme_id").references(() => themes.id, { onDelete: "set null" })` — add inside the `campaigns` column block.
- `campaigns.theme_snapshot`: `jsonb("theme_snapshot")` — `{ email: EmailTheme, landingHtml: string | null, theme_id: string | null, frozen_at: string }`. Null while draft.

**3. Relations** — add `themesRelations` (one→organization, one→client, one→creator) and extend `clientsRelations`/`campaignsRelations` with the new `one(themes, …)` edges so `db.query` eager-loads resolve. Keep `defaultTheme`/`theme` relation names distinct from the existing `client` edges.

### API / Backend Changes

#### `src/lib/theme.ts` (new) — the single resolution point

```ts
export interface EmailTheme {
  palette: { bg; card; primary; primaryDeep; primaryTint; accent;
             ink; inkSoft; inkMuted; inkFaint; border };   // all string hex
  fontDisplay: string;
  fontSans: string;
  logo: { url: string; background: string; position: string } | null;
  showPoweredBy: boolean;
}
```

**`DEFAULT_EMAIL_THEME: EmailTheme`** — reproduces today's look exactly. The palette keys rename the old `C` keys (`email.ts:196-208`); use this exact mapping so the refactor is mechanical and byte-identical:

| `EmailTheme.palette` | old `C` key | value |
|---|---|---|
| `bg` | `bg` | `#f0f3f7` |
| `card` | `card` | `#ffffff` |
| `primary` | `cobalt` | `#2c5bff` |
| `primaryDeep` | `cobaltDeep` | `#1a45d4` |
| `primaryTint` | `cobaltTint` | `#e8eeff` |
| `accent` | `vermillion` | `#05dbd6` |
| `ink` | `ink` | `#11123c` |
| `inkSoft` | `inkSoft` | `#2f3941` |
| `inkMuted` | `inkMuted` | `#5a6b7a` |
| `inkFaint` | `inkFaint` | `#9fb5c4` |
| `border` | `border` | `#d1dce6` |

`fontDisplay` = `FONT_DISPLAY` (`:213-214`) verbatim, `fontSans` = `FONT_SANS` (`:215-216`) verbatim, `logo: null` (→ funnel wordmark), `showPoweredBy: true`.

**`resolveCampaignTheme(campaign)`** — async, queries `themes`:
```ts
export async function resolveCampaignTheme(
  campaign: {
    theme_id: string | null;
    client: { default_theme_id: string | null; branding_logo_url: string | null;
              logo_background: string | null; logo_position: string | null };
  }
): Promise<{ email: EmailTheme; landingHtml: string | null }>;
```
Precedence: `themeId = campaign.theme_id ?? campaign.client.default_theme_id`.
- If `themeId` set → load the `themes` row. If the row is missing (deleted/`set null` race) → fall through to gallery default.
- Map row → `EmailTheme`: `palette` from `row.palette`, fonts from `row.font_display`/`font_sans`, `showPoweredBy` from `row.show_powered_by`.
- **Logo resolution** (decision 9, "gallery logo is dynamic by force"): if `row.logo_url` is set (bespoke) → `logo = { url: row.logo_url, background: row.logo_background, position: row.logo_position }`. If `row.logo_url` is null (gallery) → **adopt the rendering brand's logo**: `campaign.client.branding_logo_url ? { url: branding_logo_url, background: client.logo_background, position: client.logo_position } : null` (null → wordmark fallback).
- **Gallery/default fallback** (no `themeId`, or row not found): return an `EmailTheme` = `DEFAULT_EMAIL_THEME` palette/fonts/`showPoweredBy`, **but with the same brand-logo adoption** as above (so a Standard brand still gets its logo per the tier matrix). `landingHtml: null`.
- `landingHtml` in the result = the resolved row's `landing_html` (or null at the default rung). CT1 returns it; CT4 consumes it.

> **Decision (resolved):** the default rung is the **in-code `DEFAULT_EMAIL_THEME` constant + brand-logo adoption** — no DB hit on the common path, and a constant is trivially provable byte-identical (a seeded row could drift). The seeded gallery row exists only to be *pickable* in CT3; an explicit pick resolves by id to the same palette (`= C`), so the two paths render identically.

**`freezeCampaignTheme(campaign)`** — returns the snapshot `{ email, landingHtml, theme_id, frozen_at }`. `email` = the live resolver's `email`; **`landingHtml` = the *effective* landing = `campaign.html_template ?? (await resolveCampaignTheme(campaign)).landingHtml`** (so a tenant override is captured at activation and keeps winning for active campaigns — this resolves CT4's precedence question, decision 7); `theme_id = campaign.theme_id ?? null`; `frozen_at = new Date().toISOString()`. Its input therefore also carries `html_template`. Unit-tested: `freeze.email` equals the live resolver's `email`; `freeze.landingHtml` equals `html_template ?? resolver.landingHtml` (test both override-present and override-absent).

#### `src/lib/email.ts` — refactor to a theme-bound kit

Replace the module-level `C`/`FONT_*` reads with a factory:
```ts
function makeEmailKit(theme: EmailTheme) {
  // returns { wrapTemplate, emailHeading, emailP, emailNote, emailBtn,
  //           emailInfoCard, emailFallbackLink, brandHeader } closed over `theme`
}
```
- Every helper that reads `C.x`/`FONT_*` now reads `theme.palette.x`/`theme.fontDisplay`/`theme.fontSans`. `escapeHtml` is pure — leave it module-level.
- **`brandHeader(theme)`**: when `theme.logo` is set, render an `<img src={theme.logo.url}>` sized/positioned per `theme.logo.background`/`position` (mirror `prompt-builder.ts:132-141`: `max-height` ~40–48px for email, alt from brand name, no border/shadow). When `theme.logo` is null, render the existing funnel wordmark (`:287-315`) **unchanged** — that path is what `DEFAULT_EMAIL_THEME` hits and must stay byte-identical.
- **`wrapTemplate(theme, body)`**: footer (`:378-381`) renders the "Sent by TalentStream · … / Automated message …" block **only when `theme.showPoweredBy`**; otherwise a neutral automated-message line (white-label). Keep the static shell — `<title>`, the Instrument `@import` (`:334`), the MSO block (`:328-332`), `@media` rules (`:339-343`) — as-is; only the `${C.x}` interpolations become `${theme.palette.x}`. (The `@import` stays even for branded fonts; it is harmless when the theme's stacks differ.)
- **Each of the 9 candidate templates gains a leading `theme: EmailTheme` param**, e.g. `applicationReceivedEmail(theme, candidateName, roleTitle, clientName)`, and builds its kit via `const { wrapTemplate, emailHeading, … } = makeEmailKit(theme)`. **`passwordResetEmail`/`invitationEmail` do NOT gain a param** — they call `makeEmailKit(DEFAULT_EMAIL_THEME)` internally, so their output is unchanged.

#### Call-site wiring (resolve once, thread `email` theme beside the existing identity)

1. **`src/app/api/apply/[clientSlug]/[campaignSlug]/route.ts`** — the `campaign` is built by an explicit column `select` (`:33-48`). **Extend the select** with `clients.default_theme_id`, `clients.branding_logo_url`, `clients.logo_background`, `clients.logo_position`, and `campaigns.theme_id`, `campaigns.theme_snapshot`. Before the `applicationReceivedEmail` call (`:191-200`), resolve: `const email = campaign.theme_snapshot?.email ?? (await resolveCampaignTheme({ theme_id: campaign.theme_id, client: { default_theme_id: campaign.default_theme_id, branding_logo_url: campaign.branding_logo_url, logo_background: campaign.logo_background, logo_position: campaign.logo_position } })).email;` then pass `applicationReceivedEmail(email, candidateName, roleTitle, clientName)`.
2. **`src/lib/queue/worker.ts`** — `handleEmailJob` (`:82-175`), `handleChatInvitation` (`:177-263`), `handleChatNudge` (`:267-356`) all load `candidate` with `{ campaign: { with: { client: true } } }` (`:87, :182, :272`) — **full rows already include `campaign.theme_id`/`theme_snapshot` and `client.default_theme_id`/`branding_logo_url`/`logo_*` once the columns exist**, so no `with`/select changes are needed. In each handler resolve once: `const emailTheme = candidate.campaign.theme_snapshot?.email ?? (await resolveCampaignTheme(candidate.campaign)).email;` (the relation shape matches the resolver's expected `{ theme_id, client: {…} }`) and pass `emailTheme` as the leading arg to every template call (`applicationReceivedEmail`, `gatingPassedEmail`, `gatingFailedEmail`, `rejectionEmail`, `rejectionConfirmationEmail`, `noResponseEmail` in `handleEmailJob`; `chatInvitationEmail` at `:227`; `chatNudgeEmail` at `:341`).
3. **`src/app/api/chat/request-access/route.ts`** — `chatAccessEmail` (`:82-87`) currently omits identity and theme. The `candidate` object here is loaded earlier in the handler (above `:50`); **extend that query** to include the campaign's `theme_id`/`theme_snapshot` and the client's `default_theme_id`/`branding_logo_url`/`logo_*`, then resolve the theme and pass it as the leading arg to `chatAccessEmail(email, …)`. **Also pass `brandEmailIdentity(client)` as the 5th arg to `sendCandidateEmail`** (resolved): this is the only candidate email omitting identity today, we are already loading the client row for theming, and the change is deliverability-safe (only the From *display name* changes).

**Render preference rule (everywhere):** `const theme = campaign.theme_snapshot?.email ?? (await resolveCampaignTheme(campaign)).email;` — active campaigns are stable (snapshot), drafts resolve live.

#### Activation hook (RD-1, snapshot-freeze) — write `theme_snapshot`

Both campaign mutation routes are **inline logic, no shared service** (confirmed). Two hook points:

- **`src/app/api/admin/campaigns/route.ts` (POST, `:58-164`)** — `status` is accepted from the body, defaulting to `"draft"` (`:132`); `status: "active"` is allowed at create. The brand is already loaded via `resolveOwnedResource(clients, brandId, ctx)` (`:105-106`) so it carries `default_theme_id` + branding after the migration. **After the insert `.returning()` (`~:149`), before the success response (`~:159`)**, if the created row's `status === "active"`, compute `await freezeCampaignTheme({ theme_id: row.theme_id, html_template: row.html_template, client: brand })` and `db.update(campaigns).set({ theme_snapshot }).where(eq(campaigns.id, row.id))`.
- **`src/app/api/admin/campaigns/[id]/route.ts` (PATCH, `:57-154`)** — the draft→active transition is detected at `:138-141` (`body.status && body.status !== existing.status && body.status === "active"`). The existing campaign is loaded via `resolveOwnedResource(campaigns, id, ctx)` (`:69`) — **this does NOT eager-load the client**, so the freeze branch must **separately load the campaign's client** (`default_theme_id` + `branding_logo_url` + `logo_*`) to resolve. Inside that exact transition branch, set `updates.theme_snapshot = await freezeCampaignTheme({ theme_id: existing.theme_id, html_template: updates.html_template ?? existing.html_template, client })` so it is written in the same `.set(updates)` (`:143-147`). Use the **post-update** `html_template` (a publish PATCH may set it in the same request); once CT3 makes `theme_id` editable, use `updates.theme_id ?? existing.theme_id` too.

> ⚠️ **Drift risk to flag (verified, not in the spec's prose):** the spec §7 asserts the freeze "happens exactly once" because of a "draft-only edit constraint". **The API enforces no such constraint** — the PATCH route allows editing any field in any status (the draft-only rule is *UI-only*, in the wizard). Keying the freeze on the `body.status !== existing.status && === "active"` *transition* (not on any active edit) keeps it correct: editing an already-active campaign (`body.status === existing.status`) does **not** re-freeze, so the snapshot stays stable. A genuine active→draft→active cycle would re-freeze (capturing the then-current theme) — acceptable and arguably desired. Confirm this re-freeze-on-reactivation behaviour is intended (Open Questions).

### Seed (`src/db/seed.ts`)

Insert **one** gallery theme. The operator user is created at `:719-744` and brands at `:672-688`; insert the theme **after the operator user exists** so `created_by` can reference it (or pass `created_by: null` — it is nullable / `set null`). Idempotency: the seed is re-runnable (deterministic), so guard with a find-or-create by a stable name (e.g. `"TalentStream Classic"`) or clear-and-reinsert consistent with how the file handles other singletons. Values:
```ts
{ org_id: null, client_id: null, name: "TalentStream Classic", scope: "gallery",
  is_active: true, show_powered_by: true, logo_url: null,
  logo_background: "light", logo_position: "top-left",
  palette: { bg:"#f0f3f7", card:"#ffffff", primary:"#2c5bff", primaryDeep:"#1a45d4",
             primaryTint:"#e8eeff", accent:"#05dbd6", ink:"#11123c", inkSoft:"#2f3941",
             inkMuted:"#5a6b7a", inkFaint:"#9fb5c4", border:"#d1dce6" },
  font_display: FONT_DISPLAY, font_sans: FONT_SANS,
  landing_html: null, preview_image_url: null, created_by: operatorId ?? null }
```
(`palette` = today's `C`; fonts imported from `email.ts` or duplicated as literals.) CT1 does **not** point any brand's `default_theme_id` at it — that is CT3.

### Edge Cases and Boundary Conditions

- **Inheritance chain always resolves.** `campaign.theme_id ?? brand.default_theme_id ?? gallery-default` — a campaign is never themeless; a deleted theme (`set null`) silently degrades up the chain. Test all three rungs.
- **Gallery logo is dynamic, by force.** A gallery theme (`logo_url=null`) renders the rendering brand's `branding_logo_url`; a logo-less brand falls back to the funnel wordmark. Test a branded brand and a logo-less brand against the same gallery theme.
- **Byte-identical default.** Every existing email under `DEFAULT_EMAIL_THEME` (and the two non-campaign templates) must render identically to pre-refactor output — palette hexes, font stacks, wordmark, footer, MSO block, `@media`, `@import`, `<title>` all unchanged. This is the primary regression guard.
- **White-label footer.** `show_powered_by=false` (only reachable on bespoke themes, which CT1 doesn't create) drops the powered-by footer; default/gallery keep it. Unit-test the toggle directly on `wrapTemplate`.
- **Snapshot vs live (RD-1).** Editing a theme must not change an active campaign (reads `theme_snapshot`); a draft re-resolves live and re-freezes on (re)publish.
- **Non-campaign emails unchanged.** `passwordResetEmail`/`invitationEmail` always use `DEFAULT_EMAIL_THEME` — never accept a theme param.
- **Resolver tolerates a missing theme row.** `theme_id` set but row deleted between read and resolve → fall through to gallery default, never throw.
- **Snapshot shape stability.** `theme_snapshot.email` is consumed directly at render without re-validation — if `EmailTheme` later gains a field, old snapshots must still render (treat missing fields defensively or accept that pre-existing snapshots are CT1-shaped).

### Test Plan

> ⚠️ `*.itest.ts` truncate **all** tables — run only against a throwaway `interview_insider_test` DB (`npm run test:integration`), never the dev DB.

**Unit (`src/lib/theme.test.ts`, `src/lib/email.test.ts`):**
- `resolveCampaignTheme` precedence: campaign override > brand default > gallery default (mock the `themes` lookup).
- Gallery `logo_url=null` adopts brand `branding_logo_url` (+ brand `logo_background`/`position`); logo-less brand → `logo: null` → wordmark.
- `freezeCampaignTheme`: `email` equals the live `resolveCampaignTheme().email`; `landingHtml` equals `html_template ?? resolver.landingHtml` (assert both the override-present and override-absent cases); `frozen_at` is an ISO string; `theme_id` echoes the campaign's.
- Email kit: `makeEmailKit(theme).wrapTemplate` includes the powered-by footer iff `theme.showPoweredBy`; `brandHeader` emits `<img>` with a logo, wordmark without.
- **Byte-identical snapshot (the crux) — two-phase:**
  1. On the **current, un-refactored** code, add `src/lib/email.test.ts` calling all 11 templates with fixed representative args and `expect(html).toMatchSnapshot()`; run `npm test` to write `src/lib/__snapshots__/email.test.ts.snap`; **commit the `.snap`**.
  2. After the refactor, update the 9 candidate calls to pass `DEFAULT_EMAIL_THEME` as the leading arg (the 2 non-campaign calls unchanged). Re-run `npm test` — the committed `.snap` (output-only) must still match, proving byte-identical output. Then add a second describe block snapshotting one template under a **branded** theme (brand palette + logo + `showPoweredBy:false`) to lock the new path.

**Integration (`src/lib/*.itest.ts`):**
- Activation writes `theme_snapshot`: create a campaign with `status:"active"` (and separately a draft→active PATCH) → assert `theme_snapshot` is non-null and equals `freezeCampaignTheme`.
- Render preference: an active campaign with a stale `theme_snapshot` renders from the snapshot even after the underlying theme is edited; a draft (snapshot null) resolves live.
- Branded end-to-end: a campaign whose brand `default_theme_id` points at a (test-inserted) bespoke theme renders brand palette + logo (+/− powered-by) through `applicationReceivedEmail`.

**Build:** `npm run build` clean with the new columns, relations, and `src/lib/theme.ts` exports.

### Suggested Implementation Order

1. **Capture the safety net first.** On current code, add `src/lib/email.test.ts` snapshotting all 11 templates; `npm test`; commit the `.snap`.
2. **Schema + migration.** Add `themes` table, `clients.default_theme_id`, `campaigns.theme_id`/`theme_snapshot`, relations. `npm run db:generate` → `npm run db:migrate`.
3. **`src/lib/theme.ts`.** `EmailTheme`, `DEFAULT_EMAIL_THEME` (use the mapping table), `resolveCampaignTheme`, `freezeCampaignTheme` + unit tests.
4. **Refactor `src/lib/email.ts`** to `makeEmailKit(theme)`; add the leading `theme` param to the 9 candidate templates; route the 2 non-campaign templates through `DEFAULT_EMAIL_THEME`. Re-run the snapshot test until byte-identical.
5. **Wire call sites:** apply route, worker (×3 handlers), request-access — resolve once, prefer snapshot, thread the theme.
6. **Activation hook:** freeze on create-active (POST) and draft→active (PATCH, loading the client separately).
7. **Seed** one gallery theme.
8. **Integration tests** + `npm run build`.

### Resolved Decisions (enrichment)

1. **Default rung = in-code `DEFAULT_EMAIL_THEME` constant + brand-logo adoption.** No DB hit on the hot path; byte-identical is provable against a constant. The seeded gallery row is only for explicit selection in CT3 and resolves to the same palette.
2. **Re-freeze on every into-active transition.** "Frozen at activation" applies to each activation; an active→draft→active republish captures the then-current theme. The freeze is keyed on the `status` transition, so editing an already-active campaign never re-freezes.
3. **`freezeCampaignTheme` captures the *effective* landing** (`html_template ?? resolved.landingHtml`), so a tenant override stays authoritative for active campaigns (decision 7). This resolves CT4's precedence question.
4. **`request-access` adopts `brandEmailIdentity`** in CT1 — it is the lone candidate email omitting identity, the client row is already loaded for theming, and the change is deliverability-safe (display name only).
5. **`<title>`/`@import` stay static.** Required for the byte-identical default; the document `<title>` is not candidate-visible in email clients and the `@import` is harmless for branded font stacks (which rely on system fallbacks anyway). A theme-driven title/font-import is a deferred, out-of-scope enhancement — **not** a CT2/CT4 requirement.
