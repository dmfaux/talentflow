# CT2 · Operator theme authoring console

> **Campaign Themes — Phase 2 (managed authoring).** Extracted from the [Campaign Themes spec](../campaign-themes-spec.md) (§8). Slice IDs CT1–CT4 are stable references for tracking.

- **Goal:** operators (TalentStream staff) hand-build the shared **gallery** and per-brand **bespoke** themes, and assign a brand's default theme — the managed/services model (decision 3).
- **Backend:** new operator routes under `src/app/api/operator/themes/` (`POST`, `PATCH /[id]`, `GET`) + `POST /api/operator/clients/[id]/default-theme`; tier-gate so a **custom** theme can only be built/assigned for a **Premium+** brand (`clients.tier`, locked default D-1); new audit actions.
- **Frontend:** 🎨 `src/app/operator/themes/` index (gallery grid + per-org bespoke) + a theme-builder form (palette pickers, font selectors, logo URL + background/position, powered-by toggle, optional landing HTML, live preview) + a **Themes** card on the org-detail page.
- **Acceptance:** an operator creates a gallery theme and a bespoke theme for a Premium brand, assigns it as that brand's default, and sees audit rows; assigning a custom theme to a Standard brand is rejected; gallery themes are forced `show_powered_by=true`; preview renders via the CT1 email kit.
- **Depends on:** CT1 (`themes` table, `makeEmailKit`, resolver). · **Risks:** reuse the brand hex validator (`normaliseHexColor` in `api/admin/clients`); enforce gallery/custom invariants on both create + edit; never let a bespoke theme cross orgs.

---

## Scope detail

### Routes (`requireApiOperator`, `src/lib/api.ts:72-80`)
- **`POST /api/operator/themes`** — body `{ name, scope, org_id?, client_id?, palette, font_display, font_sans, logo_url?, logo_background, logo_position, show_powered_by, landing_html?, preview_image_url? }`.
  - `scope ∈ {gallery, custom}`. **gallery** ⇒ `org_id`/`client_id` null, `show_powered_by` forced `true` (D-4). **custom** ⇒ both set + same org + `clients.tier ∈ {premium, enterprise}` (D-1) else `400`.
  - Colours validated as hex; `landing_html` (if present) validated with `validateHtmlTemplate` (`src/lib/slots.ts:55-96`). Audit `theme_create`.
- **`PATCH /api/operator/themes/[id]`** — re-assert the gallery/custom invariants; audit `theme_update`.
- **`POST /api/operator/clients/[id]/default-theme`** — set `clients.default_theme_id`. Guard: target theme ∈ that brand's availability (`gallery ∪ client_id=brand`) **and** Premium+ if custom. Audit `set_brand_default_theme` with `{ from, to }`.
- **`GET /api/operator/themes?org_id=&client_id=`** — gallery + a brand's bespoke themes for the console.

### Audit (`src/lib/operator-audit.ts:11-23`)
- Append `"theme_create"`, `"theme_update"`, `"set_brand_default_theme"` to `OPERATOR_AUDIT_ACTIONS` (in-code allow-list, no migration). Use `recordOperatorAudit({ … endedAt: now })` per the `set_tier` precedent (`api/operator/organizations/[id]/route.ts:207-216`). Audit granularity: point-in-time + `{ name, scope }` metadata (RD-4).

### Frontend (frontend-design skill, control-plane palette)
- `src/app/operator/themes/page.tsx` — gallery grid + per-org bespoke listing.
- Theme-builder form — palette pickers, font selectors, logo fields, powered-by toggle (disabled-on/forced for gallery), optional landing HTML box, **live preview** reusing `makeEmailKit` + the existing `TemplatePreview` (`campaign-wizard.tsx:1446-1531`).
- A **Themes** card on `src/app/operator/orgs/[id]/page.tsx` beside Plan & billing (`:275-332`): assign brand default, link to bespoke builds; Premium-gated visibly (server-enforced).

## Tests
- **Unit:** create/edit validation (gallery forces powered-by + null org/client; custom requires org+client+Premium); hex validation; `landing_html` slot validation.
- **Integration:** operator creates gallery + bespoke + assigns default (audit rows written); assigning custom to a Standard brand → `400`; cross-org assignment → `400`/`404`.

---

# Implementation Spec: CT2 · Operator theme authoring console

**Generated**: 2026-06-19
**Codebase snapshot**: branch `member-brand-access` @ `362590c`
**Change type**: UI/UX (operator console screens; the `frontend-design` skill is **mandatory** for all UI work here — control-plane palette)

---

## Codebase Analysis

Every primitive CT2 needs already exists; CT2 composes the existing operator-mutation + audit + validation patterns over CT1's `themes` table.

- **Operator mutation precedent** — `src/app/api/operator/organizations/[id]/route.ts` PATCH (`:152-240`). The shape to copy exactly: `const { ctx, response } = await requireApiOperator(); if (response) return response;` → parse/validate body → `db.update(...).returning()` → `recordOperatorAudit({ operatorUserId: ctx.userId, action, targetOrgId, metadata, ip: clientIp(request), endedAt: now })` (`:208-215`, the `set_tier` point-in-time precedent).
- **`requireApiOperator()`** — `src/lib/api.ts:72-80`. Returns the discriminated union `{ ctx: TenantContext; response: null } | { ctx: null; response: NextResponse }` (403 if `!ctx.isOperator`). `ctx.userId` is the operator id for audit.
- **Audit allow-list** — `src/lib/operator-audit.ts`: `OPERATOR_AUDIT_ACTIONS` (`:11-23`, currently `impersonate … purge_org`), `isOperatorAuditAction` (`:27-34`), `recordOperatorAudit(entry)` (`:40-56`, fields `operatorUserId`/`action`/`targetOrgId?`/`metadata?`/`ip?`/`endedAt?`). It is an **in-code allow-list — appending actions needs no migration** (`operator_audit.action` is free text validated in code).
- **Hex validator** — `normaliseHexColor(value)` lives in **`src/lib/utils.ts:8-15`** (returns a normalised `#rrggbb`/`#rgb` or `null`); applied in the brand routes as `const n = normaliseHexColor(raw); if (!n) return error(...)`.
- **HTML/slot validator** — `src/lib/slots.ts` `validateHtmlTemplate(html)` (`:55-96`) → `{ ok: true } | { ok: false; errors: string[] }`; requires a `<div id="application-form">` mount, forbids `<script>`, and checks `{{…}}` against `SLOT_ALLOW_LIST` (`:10-21`).
- **Operator console UI** — `src/app/operator/layout.tsx` is a **server** component (control-plane chrome: `bg-ink`, `text-paper`, `cobalt`/`vermillion` accents). `src/app/operator/orgs/[id]/page.tsx` is a **client** component: fetches via `useEffect`, mutates via `fetch(PATCH …)`, then `setOrg` + toast. The "Plan & billing" card (`:275-332`, `TIER_OPTIONS` at `:52-56`) and "Usage" card (`:334-385`) are the layout precedent for a new **Themes** card. `src/app/operator/page.tsx` is the org-list page.
- **Preview** — `TemplatePreview` in `src/components/admin/campaign-wizard.tsx:1446-1531` renders via `<iframe srcDoc={processed} sandbox="allow-same-origin">` after `replaceSlots` + swapping the form mount for a placeholder. The **iframe-`srcDoc`** technique is reusable for an email preview; its slot/form-mount logic is landing-specific (not needed for email previews).

## Related Issues

This is **CT2** ([spec §8](../campaign-themes-spec.md)). **Depends on: CT1** ([ct1](./ct1-theme-model-email-refactor.md)) — the `themes` table, `clients.default_theme_id`, `makeEmailKit`, `DEFAULT_EMAIL_THEME`, and `resolveCampaignTheme` must exist first.

### Assumptions from siblings (do NOT build these in CT2)
- **CT1 owns the schema.** The `themes` table, its columns, and `clients.default_theme_id` already exist — CT2 adds **no migration** except (none: the audit actions are an in-code list). Do **not** add theme columns to `clients` or invent a separate themes table.
- **CT3 builds the tenant side.** CT2's `GET /api/operator/themes` is operator-only; the tenant availability route (`GET /api/admin/themes`) and the wizard picker are **CT3**. The tenant-facing `default_theme_id` write (via `PATCH /api/admin/clients/[id]`) is also CT3 — CT2 sets the brand default only through the operator route `POST /api/operator/clients/[id]/default-theme`.
- **CT4 consumes `landing_html`.** CT2 authors + validates the `landing_html` artifact (it must pass `validateHtmlTemplate`, i.e. contain `<div id="application-form">`); CT4 renders it.

## Implementation Plan

### API / Backend Changes

All four routes follow the operator precedent: `requireApiOperator()` guard → validate → mutate → `recordOperatorAudit({ … endedAt: now })`. New files under `src/app/api/operator/themes/`.

**1. Audit actions** — append `"theme_create"`, `"theme_update"`, `"set_brand_default_theme"` to `OPERATOR_AUDIT_ACTIONS` (`operator-audit.ts:11-23`). No migration. Metadata is point-in-time `{ name, scope }` for create/update and `{ from, to }` for the brand-default set (RD-4).

**2. `POST /api/operator/themes`** — create. Body `{ name, scope, org_id?, client_id?, palette, font_display, font_sans, logo_url?, logo_background, logo_position, show_powered_by, landing_html?, preview_image_url? }`.
- `scope ∈ {gallery, custom}` else `400`.
- **gallery** ⇒ force `org_id = null`, `client_id = null`, `show_powered_by = true` (D-4) regardless of body.
- **custom** ⇒ `org_id` **and** `client_id` both required; the `client_id` brand must belong to `org_id` (load it, assert `brand.org_id === org_id` — cross-org integrity, S4/S5); and `brand.tier ∈ {premium, enterprise}` (D-1) else `400`. Reuse the tier predicate from the operator org route (the `TIERS`/`isTier` set in `api/operator/organizations/[id]/route.ts`).
- **Palette validation**: run every one of the 11 palette values (`bg, card, primary, primaryDeep, primaryTint, accent, ink, inkSoft, inkMuted, inkFaint, border`) through `normaliseHexColor`; reject on the first invalid. Store the normalised object.
- `font_display`/`font_sans` non-empty strings. `landing_html` (if present) → `validateHtmlTemplate`; return its `errors` on `{ ok: false }`.
- Insert into `themes` with `created_by: ctx.userId`. Audit `theme_create` with `{ name, scope }`.

**3. `PATCH /api/operator/themes/[id]`** — edit. Resolve the theme; **re-assert the same gallery/custom invariants** on the merged result (a `scope` flip must re-validate org/client/tier and the powered-by force). Audit `theme_update` with `{ name, scope }`.

**4. `POST /api/operator/clients/[id]/default-theme`** — set `clients.default_theme_id` for brand `[id]`. Load the brand (org-scope it). Guard: the target theme must be in the brand's **availability set** — `theme.scope === 'gallery' OR theme.client_id === brand.id` (never another org's/brand's bespoke) **and**, if `scope === 'custom'`, `brand.tier ∈ {premium, enterprise}`. `db.update(clients).set({ default_theme_id })`. Audit `set_brand_default_theme` with `{ from: oldDefault, to: newDefault }`.

**5. `GET /api/operator/themes?org_id=&client_id=`** — list `scope='gallery'` ∪ (`client_id` = the queried brand's bespoke), for the console grid.

> **Factor the shared guard.** The availability + tier check recurs in routes 2/4 (and CT3's tenant routes). Put a single helper in `src/lib/theme.ts` (CT1's module), e.g. `assertThemeAssignable({ theme, brand })`, so operator and tenant paths share one source of truth.

### Frontend Changes

> **The `frontend-design` skill MUST be used** when implementing these screens (mandatory project standard; operator control-plane palette — `bg-ink`/`text-paper`/`cobalt`/`vermillion`, matching `operator/layout.tsx` and the existing label/input/button classes on `orgs/[id]/page.tsx`).

- **`src/app/operator/themes/page.tsx`** (new, client component, mirroring the `orgs/[id]` fetch-then-mutate pattern) — a gallery grid + a per-org bespoke listing, fed by `GET /api/operator/themes`.
- **Theme-builder form** — palette colour pickers (11 tokens), font selectors (`font_display`/`font_sans`), logo URL + `logo_background`/`logo_position`, a **powered-by toggle forced on + disabled when `scope==='gallery'`**, an optional `landing_html` textarea wired to `validateHtmlTemplate` (reuse the wizard's inline-validation UX), and a **live email preview**.
- **A Themes card** on `src/app/operator/orgs/[id]/page.tsx` beside Plan & billing (`:275-332`) — assign the brand default (calls `POST /api/operator/clients/[id]/default-theme`) and link to bespoke builds; show the bespoke option **disabled with a Premium+ hint** for Standard brands (visual gate; the server enforces it).

> ⚠️ **Email preview is server-only — important.** `src/lib/email.ts` imports `@/db`/`recordUsageEvent` at module scope, so the template functions (`applicationReceivedEmail`, `makeEmailKit`, …) **cannot be imported into a client component** (the bundler would try to pull `db`/`postgres` into the browser). Render the preview through a small **server endpoint** (resolved) — `POST /api/operator/themes/preview` (operator-gated) builds an `EmailTheme` from the unsaved form values and returns `applicationReceivedEmail(theme, …sample…)` HTML, which the form drops into an `<iframe srcDoc=…>` (the `TemplatePreview` technique), debounced (~250ms) on form edits. Splitting the pure templates out of `email.ts` into a db-free module (for instant client-side preview) is a deferred optimization — not needed now, and it would expand CT1's byte-identical refactor.

### Edge Cases and Boundary Conditions

- **Invariants enforced on BOTH create and edit.** A `scope` flip on PATCH must re-run org/client/tier validation and re-force `show_powered_by=true` for gallery. Test both verbs.
- **No cross-org bespoke.** `client_id`'s brand must share `org_id`; the brand-default target must be gallery or the brand's own bespoke. Reject cross-org with `400`/`404`.
- **Tier gate is structural.** A custom theme cannot be created for, or assigned to, a Standard brand. White-label (`show_powered_by=false`) is only reachable on bespoke themes, so it is implicitly Premium+.
- **Gallery forces powered-by.** Even if the body sends `show_powered_by:false` for a gallery theme, store `true`.
- **`landing_html` must satisfy the mount contract** (`<div id="application-form">`, no `<script>`) or CT4's render shows a formless page — `validateHtmlTemplate` guarantees this at create time.
- **Audit always written** on every successful mutation (`endedAt: now`), matching the operator audit posture.

### Test Plan

> ⚠️ `*.itest.ts` truncate **all** tables — run only against the throwaway `interview_insider_test` DB.

- **Unit:** create/edit validation — gallery forces `show_powered_by=true` + nulls org/client; custom requires org+client+same-org+Premium tier; bad palette hex → `400`; `landing_html` failing `validateHtmlTemplate` → `400` with `errors`.
- **Integration:** operator creates a gallery theme + a bespoke theme for a Premium brand, assigns it as the brand default → assert the `themes`/`clients` rows and the `theme_create` + `set_brand_default_theme` audit rows; assigning a custom theme to a Standard brand → `400`; assigning org B's bespoke theme as org A's brand default → `400`/`404`; the preview endpoint returns themed HTML.
- **Build:** `npm run build` clean with the new routes.

### Suggested Implementation Order

1. Append the three audit actions; add the `assertThemeAssignable` helper in `src/lib/theme.ts`.
2. `POST`/`PATCH /api/operator/themes` with full validation + unit tests.
3. `POST /api/operator/clients/[id]/default-theme` + `GET /api/operator/themes`.
4. Preview endpoint (`POST /api/operator/themes/preview`).
5. UI: themes index, builder form, Themes card on `orgs/[id]` (`frontend-design` skill).
6. Integration tests + `npm run build`.

### Resolved Decisions (enrichment)

1. **Email preview = a server endpoint** (`POST /api/operator/themes/preview`, operator-gated), debounced from the builder form. It reuses the exact send-path rendering (faithful) and keeps `email.ts`'s db-coupled code off the client. Extracting pure templates into a db-free module is a deferred optimization, not required now.
2. **Cards show a live mini-preview by default; `preview_image_url` is an optional override** (RD-3). No mandatory upload — the CT1-seeded gallery has no image and still previews via the live render. Operators *may* set `preview_image_url` later for lighter, faster grids; when present it wins over the live render.
3. **Audit = point-in-time** with `{ name, scope }` for `theme_create`/`theme_update` and `{ from, to }` for `set_brand_default_theme` (RD-4), matching `set_tier`. No field-level diff.
