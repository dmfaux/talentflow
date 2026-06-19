# Campaign Themes — tier-gated visual identity across emails + landing pages

**Status:** Draft for review · **Date:** 2026-06-19 · **Scope:** A new product initiative (not part of the [Multi-Tenant Migration Plan](./multi-tenant-migration-plan.md) — it is the first feature to *use* the tenant `tier` as a real entitlement). Internal slice IDs **CT1–CT4** are stable references for tracking.

> **How this spec was produced:** a codebase exploration mapped the campaign, email, branding, tier, and tenancy subsystems; eleven product decisions were confirmed one-by-one with the product owner (see §2); a second exploration pass pulled exact file/line citations for every touch-point. No code has been written.

---

## 1. The idea in one line

A **theme** is an operator-curated, **tier-gated visual identity** applied consistently across a campaign's lifecycle emails *and* its landing page. It is the first feature that turns the dormant `organizations.tier` / `clients.tier` columns into a real entitlement.

Today every transactional email is hard-baked to the TalentStream palette (`src/lib/email.ts:196-208`) and ignores the brand colours/logo the tenant already stores (`src/db/schema.ts:68-74`). Landing pages already pick up brand colours via the copy-into-ChatGPT prompt (`src/lib/prompt-builder.ts:54-60`) but for *every* tier. Themes close that gap and make the brand-vs-TalentStream split a paid upgrade.

---

## 2. Product decisions (confirmed with the owner)

These are settled; build on them. Each is reversible if product later disagrees, but they are the intended build.

1. **Surface:** one cohesive theme across **both** candidate emails **and** the landing page.
2. **Anatomy:** a theme is a **bundled, fully-baked design** — the tenant picks a complete look, not a layout + separate skin. *(Implementation note in §5 reconciles "fully-baked" with the fact that ~9 emails share chrome but differ in copy: for emails a theme is a baked **skin/token set** wrapping the existing per-email copy; for the landing page a theme can carry a baked **HTML artifact**.)*
3. **Authoring:** **your team (operators) hand-build** every theme — the shared gallery and the bespoke ones. A managed/services model, not self-serve generation or an in-app editor.
4. **Allowances / "buy more":** **out of scope.** No credits, no counting, no checkout. Operators assign themes; extra bespoke requests are handled case-by-case off-platform.
5. **Brand gate (no live clients, so no regression risk):** **Standard = fully TalentStream-themed on both surfaces; Premium = fully brand-themed on both.** *(Refined by decision 9 below — Standard still shows the brand logo.)*
6. **Granularity:** **one theme themes the whole campaign** — all lifecycle emails + the landing page share one visual shell; each email keeps its own copy.
7. **Attach level:** **brand default + per-campaign override.** A default theme is set on the brand; campaigns inherit it and can switch to any other *available* theme.
8. **Brand source for bespoke themes:** **baked-in snapshot** — operators bake the brand's exact hexes/logo into the custom theme at build time; a rebrand means a rebuild. *(Only per-email/per-candidate **content** stays dynamic via the existing slot system.)*
9. **Standard identity:** **brand logo + TalentStream colours**, co-branded with a "Powered by TalentStream" mark.
10. **Premium identity:** brand colours **and** logo, bespoke design, with the **"Powered by TalentStream" mark removed** (the white-label lever).
11. **Enterprise:** **Premium + operator latitude** — mechanically Premium, operators assign whatever was negotiated. Nothing new to build.

### Locked defaults (this turn)

- **D-1 · Tier source of truth = `clients.tier`** (brand level). Themes attach to a brand; `clients.tier` is already operator-set and denormalised from the org (`src/db/schema.ts:56`).
- **D-2 · Standard chooses from the gallery** (multiple themes), it is not handed a single forced default.
- **D-3 · Premium sees gallery ∪ its own bespoke themes** (gallery is always available as variety/fallback).
- **D-4 · "Powered by TalentStream" removal is the Premium white-label lever** — present on gallery themes, absent on bespoke (Premium+) themes.

### Tier matrix

| | **Standard** | **Premium** | **Enterprise** |
|---|---|---|---|
| Theme source | Shared **gallery** | **Bespoke** (operator-built) ∪ gallery | Negotiated; operators assign anything |
| Colours / type | TalentStream (baked into gallery theme) | Brand (baked at build) | Brand / negotiated |
| Logo | Brand logo (injected dynamically) | Brand logo (baked snapshot) | Brand logo |
| "Powered by TalentStream" | **Shown** | **Removed** | Removed |
| Landing page | Themed default + tenant override | Themed default + tenant override | same |
| How it's made | Self-serve pick | Managed / commissioned | Managed / negotiated |

---

## 3. AGENTS.md mandate

This is a **modified Next.js 16** (see `AGENTS.md`). CT2/CT3 add operator + tenant route handlers and forms; CT4 touches the public careers render. **Before writing route-handler / `redirect` / `db.transaction` / cookie code, read the relevant guides under `node_modules/next/dist/docs/`** — the response/navigation APIs may differ from training data; heed deprecation notices. Operator mutations follow the landed `PATCH /api/operator/organizations/[id]` precedent (`requireApiOperator` → mutate → `recordOperatorAudit({…, endedAt: now})`, `src/app/api/operator/organizations/[id]/route.ts:207-216`). The `frontend-design` skill is **mandatory** for every screen in CT2/CT3 (project standard, consistent with the S9 frontend mandate).

Email HTML is its own discipline (Outlook/Gmail rendering). The current kit is table-based with inline CSS and MSO conditionals (`src/lib/email.ts:318-389`) — the theme refactor must preserve that robustness, not regress it.

---

## 4. Codebase analysis (what exists today)

**Emails are 100% TalentStream-baked, with a clean helper kit ripe for parameterisation.** `src/lib/email.ts` holds a module-level palette `C` (`:196-208`), two font stacks (`FONT_DISPLAY`/`FONT_SANS`, `:213-216`), and a helper kit that *all* read those constants: `emailHeading` (`:218`), `emailP` (`:226`), `emailNote` (`:230`), `emailBtn` (`:234`), `emailInfoCard` (`:243`), `emailFallbackLink` (`:275`), `brandHeader` (the TalentStream funnel wordmark, `:286`), and `wrapTemplate` (the document shell + the hard-coded "Sent by TalentStream" footer, `:318-389`, footer at `:378-381`). The nine candidate-facing templates (`applicationReceivedEmail` `:391`, `gatingPassedEmail` `:405`, `gatingFailedEmail` `:453`, `rejectionEmail` `:466`, `chatInvitationEmail` `:479`, `chatAccessEmail` `:495`, `chatNudgeEmail` `:514`, `noResponseEmail` `:535`, `rejectionConfirmationEmail` `:553`) each call `wrapTemplate(...)`. Two non-campaign templates (`passwordResetEmail` `:418`, `invitationEmail` `:433`) must stay on the default TalentStream theme.

**Per-brand sending identity already exists (S10) — themes are the visual analog.** `brandEmailIdentity(brand)` (`:96-105`) personalises the From display name + Reply-To from `clients.from_name`/`reply_to_email` (`schema.ts:66-67`) while keeping the verified envelope-from. `sendCandidateEmail(to, subject, html, candidateId, identity?)` (`:136-189`) is the single metered send path (logs `messages`, records `email_sent` usage). Themes plug in beside identity at the same call sites — no new send plumbing.

**The brand already stores everything a theme needs.** `clients` (`schema.ts:42-84`): `branding_logo_url` (`:68`), `brand_primary_color` (`:69`), `brand_secondary_color` (`:70`), `brand_accent_color` (`:71`), `brand_text_color` (`:72`), `logo_background` (`:73`), `logo_position` (`:74`), plus `tier` (`:56`). Operators bake these into a bespoke theme; gallery themes fall back to `branding_logo_url` at render (decision 9).

**Email call sites — every place that needs the resolved theme:**
- `src/app/api/apply/[clientSlug]/[campaignSlug]/route.ts:191-199` — `applicationReceivedEmail()`; already builds `brandEmailIdentity()` from denormalised brand fields (`:196-199`).
- `src/lib/queue/worker.ts` — the bulk of emails. `handleEmailJob()` (`:104-174`) sends application_received / gating_passed / gating_failed / rejected / rejection_confirmation / no_response; `handleChatInvitation()` (`:224-235`); `handleChatNudge()` (`:338-350`). **All already load `candidate.campaign.client` and call `brandEmailIdentity(candidate.campaign.client)`** — so the same join provides the theme.
- `src/app/api/chat/request-access/route.ts:82-87` — `chatAccessEmail()`; **omits identity today** (global FROM). Themed for consistency in CT1.

**Landing pages: AI-prompt → paste → slot-render.** The campaign wizard step 3 (`src/components/admin/campaign-wizard.tsx:1048-1148`) lets the tenant write a `design_brief` (`:1058-1069`), copy an AI prompt built by `buildTemplatePrompt()` (`src/lib/prompt-builder.ts:35-149`), paste the returned HTML into `html_template` (`:1095-1135`), and preview it (`:1138-1146`). The prompt **already** injects "exact brand colours" when present else "choose a palette" (`prompt-builder.ts:54-60`) and **already** emits a "Powered by TalentStream" footer (`:125`) — both are the hooks CT4 flips by tier. The public render: `src/app/c/[clientSlug]/[campaignSlug]/page.tsx` calls `replaceSlots(campaign.html_template, slotData)` (`:125`) and mounts `<HtmlTemplateRenderer>` (`:128-143`), which sets `innerHTML` and mounts `<ApplicationForm>` into `<div id="application-form">` (`src/components/candidate/HtmlTemplateRenderer.tsx:65-87`). The slot allow-list + validator live in `src/lib/slots.ts:10-21,55-96`; `replaceSlots` at `:173-186`.

**Operator console is ready to host theme authoring.** Org detail page renders the tier button-group `Plan & billing` card (`src/app/operator/orgs/[id]/page.tsx:275-332`, `TIER_OPTIONS` at `:52-56`) and a Usage card (`:334-385`). `OPERATOR_AUDIT_ACTIONS` (`src/lib/operator-audit.ts:11-23`) is an in-code allow-list; `recordOperatorAudit(entry)` (`:40-56`) is the audit helper; `isOperatorAuditAction` at `:27-34`. Operator routes gate via `requireApiOperator()` (`src/lib/api.ts:72-80`).

**RBAC + guards for the tenant side.** `src/lib/rbac.ts:37-56` defines the `Action` union + `ACTION_MIN_ROLE` (incl. `manage_brand: "org_admin"` `:52`, `manage_org_settings: "org_admin"` `:54`); `decideBrandAccess` at `:78-89`. Guards in `src/lib/api.ts`: `getApiTenant()` (`:48-65`), `authorizeApiOrg(ctx, action)` (`:101-106`), `authorizeApiBrand(ctx, brandId, minRole)` (`:112-126`, 404 hides non-member brands), `effectiveOrgRole(ctx)` (`:93-96`). `resolveOwnedResource(table, id, ctx)` (`src/lib/tenant.ts:256-270`) is the org-scoped row fetch.

**Tier is metadata only — confirmed never gated.** Every `.tier` read is display/operator-set: `operator/page.tsx:13,36,193`; `operator/orgs/[id]/page.tsx:40,88,97,188`; `api/operator/organizations/[id]/route.ts:154,175-179,207,212` (the `TIERS`/`isTier` set + `set_tier` audit at `:29-32`,`:207-216`); `(admin)/clients/*` display; `tier-badge.tsx:24`. **Campaign Themes introduces the first behavioural tier gate** — establish the pattern cleanly (a single `resolveCampaignTheme` + an availability query), don't scatter `if (tier === …)` checks.

**Migrations:** latest committed is `drizzle/0031_lean_sharon_ventura.sql`. New work auto-numbers **`0032_*`** via `npm run db:generate` (`drizzle-kit generate`), applied with `npm run db:migrate` (`tsx src/db/migrate.ts`). Both from `package.json:13-14`.

---

## 5. Design overview

```
                         clients.default_theme_id ──┐ (brand default, operator/owner)
campaign.theme_id ──┐                               │
                    ▼  resolveCampaignTheme(campaign)▼
        ┌───────────────────────────────────────────────────┐
        │  theme = campaign.theme_id                          │
        │       ?? brand.default_theme_id                     │
        │       ?? GALLERY_DEFAULT                            │
        │  → { email: EmailTheme, landingHtml: string|null }  │
        └───────────────────────────────────────────────────┘
              │                              │
              ▼ (CT1)                        ▼ (CT4)
   email kit bound to theme        landing default (theme.landing_html)
   (palette, fonts, logo,          else tenant html_template override
    showPoweredBy) wraps           → replaceSlots → HtmlTemplateRenderer
    each email's existing copy
```

**Reconciling "fully-baked" (decision 2) with email mechanics:** the gallery presents *complete-looking* designs (what a rendered email/page looks like), but under the hood a theme stores **baked branding tokens** (palette, fonts, logo, footer flag) plus an optional **baked landing HTML artifact**. The ~9 emails keep their copy in `email.ts`; the theme supplies their shared chrome. This is exactly decision 6 ("one theme themes everything; each email keeps its own copy").

**Where the tier gate lives:** at **assignment/selection time**, not render time.
- *Availability* for a brand = `themes` where `scope = 'gallery'` **OR** `client_id = brand.id`.
- A **bespoke** theme (`scope='custom'`, `client_id` set) may only be **built/assigned** for a brand whose `clients.tier ∈ {premium, enterprise}` (D-1). Operators are blocked from assigning a custom default to a Standard brand.
- *White-label* (`show_powered_by=false`) is a property baked into bespoke themes, so it is structurally gated to Premium+ (D-4) with no per-render tier check.

---

## 6. Data model changes (CT1)

One additive migration (`0032_*`). No backfill (no live tenants).

**New `themes` table** (in `src/db/schema.ts`, after `clients`):
```ts
export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null = global GALLERY theme (every tenant). Set = bespoke, owned by one org.
  org_id: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  // null for gallery; set when the bespoke theme is built for ONE brand (Premium+).
  client_id: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scope: text("scope").notNull().default("gallery"),     // "gallery" | "custom"
  is_active: boolean("is_active").notNull().default(true),
  // ── Email skin (baked snapshot) ──
  palette: jsonb("palette").notNull(),                   // { bg, card, primary, primaryDeep, primaryTint, accent, ink, inkSoft, inkMuted, inkFaint, border }
  font_display: text("font_display").notNull(),
  font_sans: text("font_sans").notNull(),
  logo_url: text("logo_url"),                            // null → fall back to rendering brand's branding_logo_url (forced for gallery)
  logo_background: text("logo_background").notNull().default("light"),
  logo_position: text("logo_position").notNull().default("top-left"),
  show_powered_by: boolean("show_powered_by").notNull().default(true), // white-label gate (D-4)
  // ── Landing page (baked artifact, optional — CT4) ──
  landing_html: text("landing_html"),                   // operator-built default landing template (slot-marked); null → tenant supplies via wizard
  preview_image_url: text("preview_image_url"),
  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("themes_org_id_idx").on(table.org_id),
  index("themes_client_id_idx").on(table.client_id),
]);
```

**Two FK columns** (both nullable, `onDelete: "set null"` so a deleted theme degrades to inheritance, never orphans a campaign):
```ts
// on clients (brand default — decision 7)
default_theme_id: uuid("default_theme_id").references(() => themes.id, { onDelete: "set null" }),
// on campaigns (per-campaign override — decision 7)
theme_id: uuid("theme_id").references(() => themes.id, { onDelete: "set null" }),
// frozen resolved look, written at activation (RD-1, snapshot-freeze). Null while draft.
// { email: EmailTheme, landingHtml: string | null, theme_id: string | null, frozen_at: string }
theme_snapshot: jsonb("theme_snapshot"),
```

> **Cross-tenant integrity (S4/S5 posture).** A bespoke theme's `org_id`/`client_id` and the brand/campaign that reference it must share an org. Enforce in the writers (CT2/CT3), and assert in seed + an `*.itest.ts` cross-org test (a brand cannot set `default_theme_id` to another org's theme; a campaign cannot set `theme_id` outside `gallery ∪ own-brand`).

Then `npm run db:generate` → `drizzle/0032_*.sql` → `npm run db:migrate`. Seed a starter **gallery** (`scope='gallery'`, `org_id`/`client_id` null, `show_powered_by=true`, TalentStream palette = today's `C`) in `src/db/seed.ts` so every tenant has options on day one (decision 3 + D-2).

---

## 7. CT1 · Theme resolver + email refactor *(V1 core)*

**`src/lib/theme.ts` (new) — the single resolution point.**
```ts
export interface EmailTheme {
  palette: { bg; card; primary; primaryDeep; primaryTint; accent; ink; inkSoft; inkMuted; inkFaint; border };
  fontDisplay: string;
  fontSans: string;
  logo: { url: string; background: string; position: string } | null;
  showPoweredBy: boolean;
}

/** Reproduces today's TalentStream look (palette C + funnel wordmark + powered-by).
 *  Used for non-campaign emails (password reset, invitations) and as GALLERY_DEFAULT. */
export const DEFAULT_EMAIL_THEME: EmailTheme;

/** campaign.theme_id ?? brand.default_theme_id ?? GALLERY_DEFAULT.
 *  Gallery themes with logo_url=null inherit the brand's branding_logo_url here. */
export async function resolveCampaignTheme(
  campaign: { theme_id: string | null; client: { default_theme_id: string | null; branding_logo_url: string | null; logo_background: string | null; logo_position: string | null } }
): Promise<{ email: EmailTheme; landingHtml: string | null }>;
```

**Refactor `src/lib/email.ts` to a theme-bound kit.** Convert the module-level `C`/`FONT_*` and every helper (`emailHeading`/`emailP`/`emailNote`/`emailBtn`/`emailInfoCard`/`emailFallbackLink`/`brandHeader`/`wrapTemplate`) into a factory:
```ts
function makeEmailKit(theme: EmailTheme) { /* returns { wrapTemplate, emailHeading, ... } closed over theme */ }
```
- `brandHeader(theme)` renders `theme.logo` as an `<img>` (sized/positioned per `logo_background`/`logo_position`, mirroring `prompt-builder.ts:132-141`) when present; falls back to the TalentStream funnel wordmark only for `DEFAULT_EMAIL_THEME`.
- `wrapTemplate(theme, body)`'s footer renders "Powered by TalentStream" **only when `theme.showPoweredBy`** (D-4); otherwise a neutral automated-message line.
- Each candidate template gains a leading `theme: EmailTheme` param: `applicationReceivedEmail(theme, candidateName, roleTitle, clientName)`, etc. `passwordResetEmail`/`invitationEmail` pass `DEFAULT_EMAIL_THEME` (unchanged output → snapshot-stable).

**Wire the call sites** (each already has the brand/campaign in hand — see §4): resolve once, thread the `email` theme into the template fn alongside the existing `brandEmailIdentity` call.
- `src/app/api/apply/[clientSlug]/[campaignSlug]/route.ts:191-199`
- `src/lib/queue/worker.ts` `handleEmailJob` (`:104-174`), `handleChatInvitation` (`:224-235`), `handleChatNudge` (`:338-350`) — extend the existing `candidate.campaign.client` selection with `client.default_theme_id`/`branding_logo_url`/`logo_*` + `campaign.theme_id`.
- `src/app/api/chat/request-access/route.ts:82-87` — now resolves + themes (and can finally pass `brandEmailIdentity` too).

> **Snapshot-freeze (RD-1, RESOLVED — in scope for CT1).** Resolution reads the theme live, which is correct for **drafts/previews**. But to guarantee in-flight candidates see a consistent look even if a theme is later edited, the campaign's resolved look is **frozen at activation**:
> - On the create/publish path (`POST /api/admin/campaigns` with `status: "active"`, and any draft→active transition in the campaigns PATCH route), call `resolveCampaignTheme(campaign)` and persist the result to `campaigns.theme_snapshot` = `{ email, landingHtml, theme_id, frozen_at }`.
> - At render, **prefer the snapshot**: `const theme = campaign.theme_snapshot?.email ?? (await resolveCampaignTheme(campaign)).email`. Drafts (snapshot null) resolve live; active campaigns are stable.
> - This composes with the existing **draft-only edit** constraint (the wizard edit page only opens for `status: "draft"`), so `theme_id` is chosen while draft and frozen exactly once at publish — no mid-flight theme changes are even reachable through the UI. The snapshot is the backstop for direct theme edits by operators.
> - A `theme_snapshot` builder belongs in `src/lib/theme.ts` (`freezeCampaignTheme(campaign)`), unit-tested against the live resolver.

---

## 8. CT2 · Operator theme authoring console

Operators (`requireApiOperator`, `src/lib/api.ts:72-80`) build + assign themes.

**Routes (new, under `src/app/api/operator/themes/`):**
- `POST /api/operator/themes` — create a theme. Body: `{ name, scope, org_id?, client_id?, palette, font_display, font_sans, logo_url?, logo_background, logo_position, show_powered_by, landing_html?, preview_image_url? }`. Validation: `scope ∈ {gallery, custom}`; **gallery** ⇒ `org_id`/`client_id` null + `show_powered_by` forced `true` (D-4); **custom** ⇒ both set, same org, and **`clients.tier ∈ {premium, enterprise}`** (D-1) else `400`. Colours validated as hex (reuse the brand `normaliseHexColor` from `api/admin/clients`). Audit `theme_create`.
- `PATCH /api/operator/themes/[id]` — edit. Re-assert the gallery/custom invariants. Audit `theme_update`.
- `POST /api/operator/clients/[id]/default-theme` — set a brand's `default_theme_id`. Guard: target theme must be in that brand's availability set (`gallery ∪ client_id=brand`) **and**, if custom, the brand must be Premium+. Audit `set_brand_default_theme` with `{ from, to }`.
- `GET /api/operator/themes?org_id=&client_id=` — list gallery + a brand's bespoke themes for the console.

**Audit:** append `"theme_create"`, `"theme_update"`, `"set_brand_default_theme"` to `OPERATOR_AUDIT_ACTIONS` (`src/lib/operator-audit.ts:11-23`); no migration (in-code allow-list). Use `recordOperatorAudit({ … endedAt: now })` per the `set_tier` precedent.

**UI (frontend-design skill, control-plane palette):** a `src/app/operator/themes/` index (gallery grid + per-org bespoke), a theme builder form (palette pickers, font selectors, logo URL + background/position, powered-by toggle disabled-on for gallery, optional landing HTML w/ `validateHtmlTemplate` from `slots.ts:55-96`, live preview reusing the email kit + `TemplatePreview`), and on `operator/orgs/[id]/page.tsx` a new **Themes** card beside Plan & billing (`:275-332`) to assign the brand default and link to bespoke builds (gated visibly to Premium+, enforced server-side).

---

## 9. CT3 · Tenant theme picker + brand default

Tenants pick among *available* themes; they never author (decision 3).

**Routes:**
- `GET /api/admin/themes` — `getApiTenant()`; returns availability for the active brand = `themes` where `scope='gallery' OR client_id = activeBrandId`, `is_active` (D-2/D-3). Used by the wizard picker + brand settings.
- `PATCH /api/admin/clients/[id]` (extend existing) — allow owner/org_admin (`manage_brand`, `rbac.ts:52`) to set `default_theme_id`, validated against availability (and Premium+ for custom). Keep all other brand-field RBAC as-is.
- `POST/PATCH /api/admin/campaigns[...]` (extend existing) — accept `theme_id`; validate it is in the campaign's brand availability set (else `400`), or `null` to inherit.

**UI (frontend-design skill, admin palette):** add a **Theme** control to the wizard's Landing Page step (`campaign-wizard.tsx:1048-1148`) — a gallery picker (cards w/ `preview_image_url`, "Brand default" badged) defaulting to the brand's `default_theme_id`, plus a **test-send** button (sends a sample `applicationReceivedEmail` themed to `ctx` user's email) and a live email preview. Add a brand-default selector to brand settings (`(admin)/clients/[id]/edit`).

---

## 10. CT4 · Landing-page theme integration (decision 7: default + override)

Two mechanisms, theme default wins unless the campaign overrides:
1. **Theme-provided landing** — `theme.landing_html` (operator-built, brand-baked for Premium) becomes the campaign's landing default. The public render (`c/[clientSlug]/[campaignSlug]/page.tsx:113-143`) resolves `landingHtml = campaign.theme_snapshot?.landingHtml ?? campaign.html_template ?? resolved.landingHtml` (snapshot first per RD-1) → `replaceSlots` → `HtmlTemplateRenderer` (unchanged downstream). CT1's `freezeCampaignTheme` therefore captures `landingHtml` into the snapshot at activation too.
2. **Tenant override** — the existing wizard paste flow (`html_template`) still works; when set it takes precedence (per decision 7).

**Tier-flip the AI prompt** (`buildTemplatePrompt`, `prompt-builder.ts:35-149`) so self-serve overrides match the theme by tier:
- **Standard:** pass the **TalentStream palette** (not brand colours) into `brandSection` (`:54-60`) and keep the "Powered by TalentStream" footer (`:125`).
- **Premium+:** pass brand colours (as today) and **drop** the "Powered by TalentStream" footer instruction.

This finally makes "one theme → both surfaces" true for every tier.

---

## 11. Edge cases & boundary conditions

- **Inheritance chain always resolves.** `campaign.theme_id ?? brand.default_theme_id ?? GALLERY_DEFAULT` — a campaign is never themeless; a deleted theme (`set null`) silently degrades up the chain. Test all three rungs.
- **Gallery logo is dynamic, by force.** A shared gallery theme (`logo_url=null`) renders the *rendering brand's* `branding_logo_url`; a brand with no logo falls back to the TalentStream wordmark (or `{{client.name}}` text on the landing). Test a branded + a logo-less brand on the same gallery theme.
- **White-label is structural.** `show_powered_by=false` only exists on bespoke (Premium+) themes; a Standard brand cannot reach one (availability query). Test: Standard campaign email + landing both show "Powered by TalentStream".
- **No cross-tenant theme references.** A brand cannot set `default_theme_id`, nor a campaign `theme_id`, to another org's bespoke theme → `400`/`404` (S4/S5 isolation). Cross-org `*.itest.ts`.
- **Tier downgrade.** Premium→Standard while a bespoke theme is the brand default or a campaign override: already-active campaigns keep their frozen snapshot (RD-1) and render unchanged; new selections are gallery-only and the operator console flags the now-ineligible assignment. Test.
- **Snapshot vs live edit (RD-1).** Editing a theme does not change already-active campaigns (they read `theme_snapshot`); draft campaigns re-resolve live and re-freeze on (re)publish. Test both, plus a draft published before vs after a theme edit.
- **Email-client robustness.** Themed `wrapTemplate` must keep the table layout, inline CSS, MSO block, and `@media` rules (`email.ts:328-344`). Snapshot the rendered HTML of each template under `DEFAULT_EMAIL_THEME` and assert byte-identical output to pre-refactor (regression guard), then add a branded-theme snapshot.
- **Non-campaign emails unchanged.** `passwordResetEmail`/`invitationEmail` always use `DEFAULT_EMAIL_THEME`.

---

## 12. Test plan

Mirror the project split: DB-free unit (`npm test`) + `DATABASE_URL`-gated integration (`*.itest.ts`, serial). Stub `@/lib/email` transport.

- **Unit:**
  - `resolveCampaignTheme`: campaign override > brand default > gallery default; gallery `logo_url=null` adopts brand logo; missing brand logo → wordmark fallback.
  - Email kit: `show_powered_by` toggles the footer; `brandHeader` emits `<img>` vs wordmark; hex validation rejects bad palettes.
  - Theme write validation: gallery forces `show_powered_by=true` + null org/client; custom requires org+client+Premium tier.
  - `buildTemplatePrompt` tier-flip: Standard → TS palette + powered-by; Premium → brand colours, no powered-by.
  - Snapshot: each candidate template under `DEFAULT_EMAIL_THEME` == pre-refactor output.
- **Integration:**
  1. Operator creates gallery + (Premium brand) bespoke theme; assigns brand default; audit rows written (`theme_create`/`set_brand_default_theme`).
  2. Operator cannot assign a custom theme to a Standard brand → `400`.
  3. Tenant `GET /api/admin/themes` returns gallery ∪ own-brand customs only (not another org's, not another brand's).
  4. Campaign `theme_id` outside availability → `400`; valid → persists; null inherits brand default.
  5. End-to-end render: a Premium campaign's `applicationReceivedEmail` carries brand palette + brand logo + **no** powered-by; a Standard campaign carries TS palette + brand logo + powered-by. (Resolve → render → assert HTML.)
  6. Cross-org isolation: brand A cannot default to org B's theme; campaign A cannot reference org B's theme.
  7. Landing: theme `landing_html` renders when `html_template` null; `html_template` overrides when set; Standard landing prompt uses TS colours.
- **Build:** `npm run build` clean with the new columns + routes.

---

## 13. Suggested slice order

1. **CT1** — `0032` migration (`themes` + `clients.default_theme_id` + `campaigns.theme_id` + `campaigns.theme_snapshot`), `src/lib/theme.ts` resolver + `freezeCampaignTheme` + the activation hook (RD-1), `email.ts` kit refactor + call-site wiring, seed a gallery, snapshot tests. *Ships invisibly: default theme = today's look.*
2. **CT2** — operator theme routes + audit actions + authoring/assignment console.
3. **CT3** — tenant `GET /api/admin/themes`, wizard theme picker + test-send, brand-default selector.
4. **CT4** — landing `landing_html` default + override resolution + `buildTemplatePrompt` tier-flip.

CT1 is the safe foundation (no behaviour change); CT2→CT3 light up the managed workflow; CT4 unifies the second surface.

---

## 14. Resolved decisions & open questions

- **RD-1 · Snapshot-freeze the theme at campaign activation — RESOLVED (2026-06-19): yes.** Freeze the resolved look into `campaigns.theme_snapshot` at activation; render prefers the snapshot, drafts resolve live. Guarantees consistent emails/landing for in-flight candidates and composes with the draft-only edit constraint. Built in CT1 (`freezeCampaignTheme` + the activation hook). See §6/§7/§10.
- **RD-2 · Gallery breadth + who designs the first set.** D-2 says Standard *chooses*; needs ≥2–3 launch gallery themes built by your team. Out of code scope; a content task.
- **RD-3 · Preview images.** `preview_image_url` assumes operators upload/generate card thumbnails (reuse the S6 private-blob path). If not, render a live mini-preview instead — slightly more client work.
- **RD-4 · `theme_create`/`theme_update` audit granularity** — point-in-time like `set_tier` (no metadata diff) vs storing a field diff. Recommend point-in-time + `{ name, scope }` metadata.

## 15. Out of scope (future)

Self-serve "buy more" / billing (decision 4); in-app theme editor (decision 3); per-message templates (decision 6 chose one-theme); custom sending domains / DKIM (Enterprise sending extras, decision 11); SMS/WhatsApp theming.
