# CT3 · Tenant theme picker + brand default + test-send

> **Campaign Themes — Phase 3 (tenant self-serve selection).** Extracted from the [Campaign Themes spec](../campaign-themes-spec.md) (§9). Slice IDs CT1–CT4 are stable references for tracking.

- **Goal:** tenants pick a theme for a campaign from the themes **available** to their brand (gallery ∪ their own bespoke — decisions D-2/D-3), set a brand default, and test-send. Tenants never author (decision 3).
- **Backend:** `GET /api/admin/themes` (availability for the active brand); extend `PATCH /api/admin/clients/[id]` to set `default_theme_id`; extend campaign `POST/PATCH` to accept `theme_id` with availability validation.
- **Frontend:** 🎨 a **Theme** control in the wizard's Landing Page step (gallery picker, brand-default badge, test-send, live email preview) + a brand-default selector in brand settings.
- **Acceptance:** the picker lists only gallery ∪ own-brand themes (never another org's/brand's); a `theme_id` outside availability → `400`; `null` inherits the brand default; test-send delivers a themed sample email; the brand default drives new campaigns.
- **Depends on:** CT1 (resolver + `themes`); CT2 for real bespoke content (gallery alone works from the CT1 seed). · **Risks:** enforce availability server-side (not just in the UI); `manage_brand` RBAC for the brand default (`rbac.ts:52`).

---

## Scope detail

### Routes
- **`GET /api/admin/themes`** — `getApiTenant()` (`src/lib/api.ts:48-65`); returns `themes` where `scope='gallery' OR client_id = activeBrandId`, `is_active` (D-2/D-3). Feeds the wizard picker + brand settings.
- **`PATCH /api/admin/clients/[id]`** (extend existing) — allow owner/org_admin (`manage_brand`, `rbac.ts:52`) to set `default_theme_id`, validated against availability (and Premium+ for custom). All other brand-field RBAC unchanged.
- **Campaign `POST`/`PATCH`** (`/api/admin/campaigns[...]`, extend existing) — accept `theme_id`; validate it is in the campaign brand's availability set (else `400`), or `null` to inherit. (Activation snapshot is CT1.)

### Frontend (frontend-design skill, admin palette)
- Wizard Landing Page step (`src/components/admin/campaign-wizard.tsx:1048-1148`): add a theme picker (cards with `preview_image_url`, "Brand default" badge) defaulting to the brand's `default_theme_id`; a **test-send** button (sends a sample `applicationReceivedEmail` themed to the current user's email via the CT1 kit); a live email preview.
- Brand settings (`src/app/(admin)/clients/[id]/edit`): a brand-default theme selector.

## Tests
- **Unit:** availability query returns gallery ∪ own-brand only; `theme_id` validation accepts available, rejects foreign/null-inherits.
- **Integration:** tenant `GET /api/admin/themes` scoping (not another org's, not a sibling brand's); campaign `theme_id` outside availability → `400`, valid persists, null inherits; brand default set by org_admin, rejected for recruiter/viewer; test-send delivers a themed email.

---

# Implementation Spec: CT3 · Tenant theme picker + brand default + test-send

**Generated**: 2026-06-19
**Codebase snapshot**: branch `member-brand-access` @ `362590c`
**Change type**: UI/UX (wizard + brand-settings screens; the `frontend-design` skill is **mandatory** — admin palette)

---

## Codebase Analysis

CT3 extends three existing routes and two existing screens; no new tables.

- **Tenant guards** — `src/lib/api.ts`: `getApiTenant()` (`:48-65`, returns `{ ctx, response }`; 401 no session, 403/401 inactive org; `ctx.activeBrandId`/`effectiveOrgId`), `authorizeApiOrg(ctx, action)` (`:101-106`, 403/null), `authorizeApiBrand(ctx, brandId, minRole)` (`:112-126`, **404** for a non-member brand / **403** for too-low role / null), `effectiveOrgRole(ctx)` (`:93-96`).
- **RBAC** — `src/lib/rbac.ts`: `Action` union + `ACTION_MIN_ROLE` (`:37-56`), `manage_brand: "org_admin"` (`:52`); `decideBrandAccess` (`:78-89`).
- **Brand PATCH** — `src/app/api/admin/clients/[id]/route.ts` PATCH (`:57-157`): resolves via `resolveOwnedResource(clients, id, ctx)` (`:69`), then a **blanket** `authorizeApiBrand(ctx, existing.id, "brand_admin")` gate (`:82-83`) covers all branding fields; a slug change additionally requires `authorizeApiOrg(ctx, "manage_brand")` (`:75-78`). `allowedFields` (`:87-97`) currently lacks `default_theme_id`; colour fields are normalised in a loop (`:105-115`); update at `:146-151`.
- **Campaign POST** — `src/app/api/admin/campaigns/route.ts` (`:58-164`): `authorizeApiBrand(ctx, brand.id, "recruiter")` (`:111`), insert at `:121-149` (no `theme_id` today). **Campaign PATCH** — `src/app/api/admin/campaigns/[id]/route.ts` (`:57-154`): `authorizeApiBrand(ctx, existing.client_id, "recruiter")` (`:75`), `allowedFields` at `:114-129` (no `theme_id`), update at `:143-147`.
- **Wizard** — `src/components/admin/campaign-wizard.tsx` (client component). `FormData` state via `useState` + `updateForm()`; Landing Page step at `:1048-1148` (design-brief textarea `:1059-1069`, AI-prompt copy `:1072-1093` via `generatePrompt()` `:406-431`, `html_template` paste + inline `validateHtmlTemplate` `:1103-1135`, `TemplatePreview` `:1138-1146`). `submit(status)` (`:454-517`) POSTs `/api/admin/campaigns` or PATCHes `/api/admin/campaigns/[id]`.
- **Brand settings** — `src/app/(admin)/clients/[id]/edit/page.tsx` (client component): fetches `/api/admin/clients/[id]`, edits via `BrandingSection` + `LiveCampaignPreview`, submits a PATCH to `/api/admin/clients/[id]` (`:88-135`).

## Related Issues

This is **CT3** ([spec §9](../campaign-themes-spec.md)). **Depends on: CT1** (resolver + `themes` + `clients.default_theme_id` + `campaigns.theme_id`). **CT2** provides real bespoke content, but **CT3 works against the CT1 gallery seed alone** (gallery-only picker).

### Assumptions from siblings (do NOT build these in CT3)
- **Columns + resolver are CT1; operator authoring is CT2.** CT3 adds **no migration** — it only reads `themes` and writes the existing `default_theme_id`/`theme_id` FK columns.
- **Tenants never author themes** (decision 3) — CT3 is selection-only. No create/edit UI.
- **Activation snapshot is CT1.** CT3 sets `theme_id`/`default_theme_id`; the freeze on publish is already wired by CT1.
- **Landing-page rendering + prompt tier-flip are CT4.** CT3's picker chooses the theme; CT4 makes the landing surface reflect it.

## Implementation Plan

### API / Backend Changes

**Shared availability check.** All three writes need "is theme X assignable to brand B?" — `theme.is_active && (theme.scope==='gallery' || theme.client_id===B.id) && (theme.scope!=='custom' || B.tier ∈ {premium,enterprise})`. Put one helper in `src/lib/theme.ts` (shared with CT2's operator routes) and call it everywhere; do not inline the predicate three times.

**1. `GET /api/admin/themes`** (new) — `getApiTenant()` guard; uses `ctx.activeBrandId`. Returns `themes` where `is_active AND (scope='gallery' OR client_id = ctx.activeBrandId)` (D-2/D-3), selecting the card fields (`id, name, scope, preview_image_url, show_powered_by`). Feeds the wizard picker + brand settings. (No mutation, so `view` is sufficient; a brand member of the active brand may read it.)

**2. `PATCH /api/admin/clients/[id]`** (extend) — add `"default_theme_id"` to `allowedFields` (`:87`). When present and non-null, **validate via the shared helper** against the brand's availability + tier (else `400`); `null` clears the default. **Decision: gate `default_theme_id` at `brand_admin`** — the existing blanket `authorizeApiBrand(ctx, id, "brand_admin")` gate (`:82-83`) already rejects recruiter/viewer (satisfying that test) and is consistent with the other branding fields (logo/colours). No org-level `manage_brand` check is added (the slice's wording conflated the Action name with intent).

**3. Campaign `POST`** (extend, `:121-149`) — accept `theme_id`: insert `theme_id: body.theme_id ?? null` (do **not** silently default to the brand default here — the resolver already falls back to `brand.default_theme_id` at render; storing `null` keeps "inherit" meaningful). If `body.theme_id` is non-null, validate it against the **creating brand's** availability via the shared helper (else `400`). **Campaign `PATCH`** (extend, `:114-129`) — add `"theme_id"` to `allowedFields`; when present, validate against the **campaign's** brand (`existing.client_id`) availability, or `null` to inherit.

### Frontend Changes

> **The `frontend-design` skill MUST be used** for both screens (admin palette).

- **Wizard Landing Page step** (`campaign-wizard.tsx:1048-1148`): add a **Theme picker** — cards rendered from `GET /api/admin/themes` (thumbnail from `preview_image_url`, a "Brand default" badge on the brand's `default_theme_id`), defaulting the selection to the brand default. Add `theme_id: string | null` to `FormData` (`:56`) and to the `submit` body (`:459+`). Add a **test-send** button and a **live email preview** beside the existing landing preview.
- **Brand settings** (`(admin)/clients/[id]/edit/page.tsx`): add a brand-default theme selector (state + include `default_theme_id` in the PATCH body at `:105-119`; extend the `Client` interface to carry `default_theme_id`/`tier`). Disable custom options with a Premium+ hint when the brand is Standard (server still enforces).
- **Test-send + live preview are server-only** (same constraint as CT2: `email.ts` imports `@/db`, so its template fns can't be bundled client-side). Implement **`POST /api/admin/themes/test-send`** (tenant-gated) that resolves the chosen theme and sends a sample `applicationReceivedEmail` to `ctx`'s user email via **`sendTransactionalEmail`** (not `sendCandidateEmail` — there is no candidate, and test-sends must **not** record an `email_sent` usage event). The same endpoint (or a `?preview=1` variant returning HTML) backs the live `<iframe srcDoc>` preview.

### Edge Cases and Boundary Conditions

- **Availability enforced server-side, not just in the UI.** A crafted `theme_id` for a gallery-only/other-brand theme must `400` regardless of what the picker showed.
- **`null` inherits.** A null `theme_id` (campaign) or `default_theme_id` (brand) is valid and means "inherit up the chain" — never a validation error.
- **No cross-org / sibling-brand leakage.** `GET /api/admin/themes` returns only gallery ∪ the *active* brand's bespoke — never another org's, never a sibling brand's. Cross-org `*.itest.ts`.
- **Tier downgrade.** A brand that was Premium (custom default set) and is now Standard: already-active campaigns keep their CT1 snapshot; new selections are gallery-only and the picker should flag the now-ineligible default. Validate new writes against current tier.
- **Test-send safety.** Send only to the authenticated user's own email; consider a light rate-limit; never meter it.
- **Active-brand required.** `GET /api/admin/themes` and campaign create depend on `ctx.activeBrandId` — handle the no-active-brand case as the existing routes do (`400`).

### Test Plan

> ⚠️ `*.itest.ts` truncate **all** tables — run only against the throwaway `interview_insider_test` DB.

- **Unit:** the shared availability helper returns gallery ∪ own-brand only and rejects custom-on-Standard; `theme_id` validation accepts an available theme, rejects a foreign one, treats `null` as inherit.
- **Integration:** tenant `GET /api/admin/themes` scoping (excludes another org's and a sibling brand's themes); campaign `theme_id` outside availability → `400`, valid persists, `null` inherits; brand `default_theme_id` set by org_admin/brand_admin, rejected for recruiter/viewer; `POST /api/admin/themes/test-send` delivers a themed email (assert via the stubbed transport) **without** an `email_sent` usage row.
- **Build:** `npm run build` clean.

### Suggested Implementation Order

1. Shared availability helper in `src/lib/theme.ts` (with CT2) + unit tests.
2. `GET /api/admin/themes`.
3. Extend `clients` PATCH (`default_theme_id`) and campaign POST/PATCH (`theme_id`) with validation.
4. `POST /api/admin/themes/test-send` (+ preview variant).
5. Wizard picker + brand-settings selector + previews (`frontend-design` skill).
6. Integration tests + `npm run build`.

### Resolved Decisions (enrichment)

1. **`default_theme_id` is gated at `brand_admin`** (the existing blanket brand-PATCH gate), consistent with the logo/colour branding fields — it already rejects recruiter/viewer, so no org-level `manage_brand` check is added. (The slice's `manage_brand` wording conflated the Action name with intent.)
2. **Campaign create stores `theme_id: null` to inherit** — it does not snapshot the brand default into the row, so a later brand-default change still flows to draft campaigns. The resolver supplies the fallback at render.
3. **Test-send: no metering + a light per-user throttle.** Send only to the authenticated user's own email via `sendTransactionalEmail` (no `email_sent` usage row); add a simple rate-limit (e.g. a few/min/user) so the button can't become a spam vector (mechanism at the implementer's discretion).
