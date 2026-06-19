# CT4 · Landing-page theme integration (default + override) + AI-prompt tier-flip

> **✅ DONE** — implemented 2026-06-19. Public render now resolves the effective landing via `resolveEffectiveLanding` (snapshot → tenant override → theme `landing_html`), extending the campaign select with the theme/brand columns and routing a null result through today's no-template surface. `buildTemplatePrompt` is tier-flipped (Standard/null → TalentStream palette + "Powered by TalentStream" footer; Premium+ → brand colours, no footer) via the shared `isPremiumTier`. The wizard threads the brand `tier` into the copied prompt and reflects the theme's landing default (live preview) with an "override with custom HTML" affordance; `html_template` is now required only when the resolved theme provides no landing. The themes feed + `Theme` type carry `landing_html`. Verified: 5 prompt-builder + 4 `pickLandingHtml` unit tests, 6 CT4 landing integration tests (theme landing renders, override wins, frozen snapshot stable after a theme edit, effective-landing freeze, mount-point present, null-everywhere), CT1/CT3/operator theme suites green (41 tests), full unit suite 299/299, `npm run build` clean. All acceptance criteria met.

> **Campaign Themes — Phase 4 (unify the second surface).** Extracted from the [Campaign Themes spec](../campaign-themes-spec.md) (§10). Slice IDs CT1–CT4 are stable references for tracking.

- **Goal:** make "one theme → both surfaces" true by giving the **landing page** a theme-provided default (operator-built, brand-baked for Premium) that a campaign can still override, and tier-flipping the self-serve AI prompt so overrides match the tier.
- **Backend:** public render resolves `landingHtml = campaign.theme_snapshot?.landingHtml ?? campaign.html_template ?? resolved.landingHtml` (decision 7 + RD-1); `buildTemplatePrompt` tier-flip (Standard → TalentStream palette + "Powered by TalentStream"; Premium+ → brand colours, no "Powered by").
- **Frontend:** the wizard reflects the theme's landing default (preview) and the copied AI prompt reflects the tier.
- **Acceptance:** a campaign with no `html_template` override renders the theme's `landing_html`; an override wins; a Standard campaign's generated landing prompt uses TalentStream colours + the powered-by footer; a Premium prompt uses brand colours and omits powered-by; the rendered landing matches its emails.
- **Depends on:** CT1 (resolver + snapshot), CT3 (theme selection). · **Risks:** two landing code paths to keep coherent; operator `landing_html` must pass `validateHtmlTemplate`; the `<div id="application-form">` mount contract is unchanged.

---

## Scope detail

### Public render (`src/app/c/[clientSlug]/[campaignSlug]/page.tsx:113-143`)
- Resolve effective landing: `campaign.theme_snapshot?.landingHtml ?? campaign.html_template ?? (await resolveCampaignTheme(campaign)).landingHtml`.
- Feed it to `replaceSlots(...)` (`src/lib/slots.ts:173-186`) → `<HtmlTemplateRenderer>` (`src/components/candidate/HtmlTemplateRenderer.tsx:65-87`) — downstream unchanged.
- CT1's `freezeCampaignTheme` already captures `landingHtml` into `theme_snapshot` at activation, so active campaigns are stable.

### AI prompt tier-flip (`src/lib/prompt-builder.ts:35-149`)
- **Standard:** pass the **TalentStream palette** (not brand colours) into `brandSection` (`:54-60`) and keep the "Powered by TalentStream" footer instruction (`:125`).
- **Premium+:** pass brand colours (today's behaviour) and **drop** the powered-by footer instruction.
- Thread the brand tier (`clients.tier`) into the wizard's `generatePrompt()`/`buildTemplatePrompt` call (`campaign-wizard.tsx:406-431`).

### Frontend
- Wizard Landing Page step: when the selected theme provides `landing_html` and the tenant hasn't overridden, show it as the default (preview) with an explicit "override with custom HTML" affordance; the copied prompt's colour/footer guidance reflects the brand tier.

## Tests
- **Unit:** landing resolution precedence (snapshot > override > theme default); `buildTemplatePrompt` emits TS palette + powered-by for Standard, brand colours + no powered-by for Premium.
- **Integration:** theme `landing_html` renders when `html_template` is null; an override wins; active campaign uses the frozen snapshot landing; a Standard vs Premium campaign render the matching colour/footer treatment across email + landing.

---

# Implementation Spec: CT4 · Landing-page theme integration + AI-prompt tier-flip

**Generated**: 2026-06-19
**Codebase snapshot**: branch `member-brand-access` @ `362590c`
**Change type**: UI/UX (modifies the wizard's Landing Page step; the `frontend-design` skill is **mandatory** for that work — see Frontend Changes)

---

## Codebase Analysis

CT4 unifies the second surface (landing pages) with the theme already driving emails. Two mechanisms: a theme-provided landing default, and a tier-aware AI prompt for self-serve overrides. Everything it touches exists today.

- **Public render — `src/app/c/[clientSlug]/[campaignSlug]/page.tsx`** (server component). Loads the campaign via an explicit-column `db.select` joined to `clients` (`:14-45`), selecting `html_template` (`:30`) and the brand colours (`:33-36`) — **but not `theme_id` / `theme_snapshot`, nor the brand `default_theme_id` / `branding_logo_url` / `logo_*` the resolver needs**. Builds `slotData` (`:113-124`), calls `replaceSlots(campaign.html_template, slotData)` (`:125`), and mounts `<HtmlTemplateRenderer>` (`:128-143`) with `brandColours`.
- **Slots — `src/lib/slots.ts`.** `replaceSlots(html, data)` (`:173-186`) processes conditional blocks then standalone `{{…}}` markers; `SLOT_ALLOW_LIST` (`:10-21`); `validateHtmlTemplate(html)` (`:55-96`) returns `{ ok: true } | { ok: false; errors: string[] }`, requires a `<div id="application-form">` mount and forbids `<script>`.
- **`src/components/candidate/HtmlTemplateRenderer.tsx`** (client component, `"use client"`). Sets `container.innerHTML = safeHtml` (`:65`), queries `#application-form` (`:67`), and mounts `<ApplicationForm>` into it via `createRoot` (`:76-87`). **The mount contract is unchanged** — any theme-provided `landing_html` MUST contain `<div id="application-form"></div>` and pass `validateHtmlTemplate`, or the form never renders.
- **AI prompt — `src/lib/prompt-builder.ts`** (~150 lines, pure). `buildTemplatePrompt({ name, brief, brandColors, logo })` (`:35-40`); `BuildPromptInput`/`BrandColors` (`:28-33`). `brandSection` (`:54-60`) embeds exact brand hexes when `brandColors` is truthy, else prompts for a palette. The hard-coded "Powered by TalentStream" footer instruction is at `:125`. **The function receives no tier today** — colours/logo are passed in by the caller.
- **Wizard call site — `src/components/admin/campaign-wizard.tsx`** (client component). `generatePrompt()` (`:406-431`) maps the selected `client`'s brand fields → `brandColors` + `logo`, then calls `buildTemplatePrompt(...)`. The wizard's `Client` interface (`:31-42`) carries the brand colours/logo fields **but not `tier`**.

## Related Issues

This is **CT4**, the final Campaign Themes slice ([spec §10](../campaign-themes-spec.md)).

- **Depends on: CT1** ([ct1](./ct1-theme-model-email-refactor.md)) — `resolveCampaignTheme` (returns `{ email, landingHtml }`), `freezeCampaignTheme`, and the `theme_snapshot` column. **Depends on: CT3** ([ct3](./ct3-tenant-theme-picker.md)) — for a campaign to *have* a selected `theme_id`; without CT3 every `theme_id` is null and the landing falls through to `html_template` (today's behaviour), so CT4's render change is **safe to land before CT3** but only does visible work once themes carry `landing_html` (CT2) and are selected (CT3).
- **CT2** ([ct2](./ct2-operator-theme-console.md)) builds the `landing_html` artifacts CT4 renders, and validates them with `validateHtmlTemplate` at create time.

### Assumptions from siblings (do NOT build these in CT4)
- **The `landing_html` / `preview_image_url` columns and `resolveCampaignTheme`'s `landingHtml` return value already exist (CT1).** CT4 only *consumes* them — it does not add columns or change the resolver's signature.
- **`theme_snapshot.landingHtml` is captured at activation by CT1's `freezeCampaignTheme`.** ⚠️ See the boundary condition below — CT1's freeze as currently specced captures the *theme's* landing only; CT4 needs the *effective* landing (override-aware). This is a cross-slice refinement to confirm.
- **Authoring/validation of operator landing artifacts is CT2; theme selection is CT3.** CT4 assumes a resolved/selected theme and a valid `landing_html`.

## Implementation Plan

### API / Backend Changes

**1. Landing resolution in the public render** (`src/app/c/[clientSlug]/[campaignSlug]/page.tsx`):
- **Extend the `db.select` (`:16-37`)** to add `theme_id: campaigns.theme_id`, `theme_snapshot: campaigns.theme_snapshot`, and the brand fields the resolver needs: `default_theme_id: clients.default_theme_id`, `branding_logo_url: clients.branding_logo_url`, `logo_background: clients.logo_background`, `logo_position: clients.logo_position`.
- **Resolve the effective landing before `:125`:**
  ```ts
  const landingHtml =
    campaign.theme_snapshot?.landingHtml ??
    campaign.html_template ??
    (await resolveCampaignTheme({
      theme_id: campaign.theme_id,
      client: {
        default_theme_id: campaign.default_theme_id,
        branding_logo_url: campaign.branding_logo_url,
        logo_background: campaign.logo_background,
        logo_position: campaign.logo_position,
      },
    })).landingHtml;
  ```
- **Preserve today's null-handling.** When `landingHtml` is null (the common pre-CT2 case: no theme landing, no override), the page must behave exactly as it does today with a null `html_template` — confirm that branch (a fallback template / `notFound()` / default render) and route the null through it; do **not** pass `null` into `replaceSlots`. Only call `replaceSlots(landingHtml, slotData)` when `landingHtml` is non-null.

**2. Tier-flip `buildTemplatePrompt`** (`src/lib/prompt-builder.ts`) — keep the tier logic in the pure lib so it is unit-testable and single-sourced:
- Add `tier?: string | null` to `BuildPromptInput` (`:28-33`).
- In `brandSection` (`:54-60`): treat the tier as Premium+ when `tier === "premium" || tier === "enterprise"` (reuse the existing `TIERS`/`isTier` predicate from the operator tier route rather than re-deriving the set). **Premium+** → embed the brand colours as today. **Standard / null** → ignore `brandColors` and embed the TalentStream palette (`primary: #2c5bff, secondary: #f0f3f7, accent: #05dbd6, text: #11123c` — the `DEFAULT_EMAIL_THEME` palette mapped to `BrandColors`; define a shared `TALENTSTREAM_PROMPT_PALETTE` const).
- The footer instruction (`:125`): emit the "Powered by TalentStream" block **only for Standard/null**; **drop it for Premium+** (the white-label lever, D-4) — consistent with the email kit's `showPoweredBy`.
- Logo handling is unchanged (brand logo is shown on both tiers per the tier matrix).

### Frontend Changes

> **The `frontend-design` skill MUST be used when implementing these wizard changes** — this is a mandatory project standard for all UI/UX work (admin palette here).

- **`src/components/admin/campaign-wizard.tsx`:**
  - Add `tier: string` to the `Client` interface (`:31-42`) and ensure the server component that renders the wizard includes `clients.tier` in the brand list it passes down (trace the `clients` prop source and extend that query).
  - In `generatePrompt()` (`:406-431`), pass `tier: client?.tier` into `buildTemplatePrompt(...)` so the copied prompt's colour + footer guidance matches the brand tier.
  - In the Landing Page step (`:1048-1148`): when the selected theme provides a `landing_html` and the tenant has **not** pasted an override, show the theme's landing as the **default** (a preview, reusing the existing preview mechanism) with an explicit "override with custom HTML" affordance that reveals the existing paste flow. When the tenant has pasted into `html_template`, the override is shown (it wins). This mirrors the resolution precedence on the server.
- State management follows the wizard's existing `form` object + `useState` pattern; no new persistence path — `theme_id` is already saved via CT3's campaign POST/PATCH extension, and `html_template` saves as today.

### Edge Cases and Boundary Conditions

- ✅ **Override-vs-snapshot precedence (RESOLVED).** Render order `theme_snapshot?.landingHtml ?? html_template ?? resolved.landingHtml`. For a **draft** (snapshot null), `html_template` (tenant override) wins per decision 7. For an **active** campaign this is now also correct because **CT1's `freezeCampaignTheme` captures the *effective* landing** (`html_template ?? resolved.landingHtml`) at activation — the snapshot already encodes "override wins", so reading it first cannot beat the override. No CT4-side change beyond this render order; the fix lives in CT1's freeze.
- **Null landing everywhere.** No theme `landing_html`, no override → resolution yields null → must fall back to today's null-`html_template` behaviour (don't crash `replaceSlots`).
- **Mount contract.** A theme `landing_html` lacking `<div id="application-form">` renders a page with no form. CT2 must enforce `validateHtmlTemplate` on `landing_html` at create; CT4 relies on that. Add a defensive integration assertion that a rendered theme landing contains the mount point.
- **Frozen landing is stable.** Editing a theme's `landing_html` does not change active campaigns (they read `theme_snapshot.landingHtml`); drafts re-resolve live and re-freeze on publish.
- **Coherence across surfaces.** A Standard campaign's landing prompt uses TalentStream colours + powered-by, matching its emails; a Premium campaign uses brand colours + no powered-by on both. Assert the pairing.

### Test Plan

> ⚠️ `*.itest.ts` truncate **all** tables — run only against the throwaway `interview_insider_test` DB.

- **Unit (`src/lib/prompt-builder.test.ts` — new):** `buildTemplatePrompt` with `tier:"standard"` → TalentStream palette in `brandSection` + the powered-by footer present; `tier:"premium"`/`"enterprise"` → brand colours + footer **absent**; null/unknown tier → treated as Standard. Assert on substrings of the returned prompt.
- **Unit (landing resolution):** a small helper or inline test of the precedence `snapshot.landingHtml ?? html_template ?? resolved.landingHtml`, including the null-everywhere branch.
- **Integration (`src/lib/*.itest.ts`):** theme `landing_html` renders when `html_template` is null; an override `html_template` wins (per the confirmed precedence); an active campaign renders the frozen snapshot landing even after the theme's `landing_html` is edited; a rendered theme landing contains `<div id="application-form">`.
- **Build:** `npm run build` clean.

### Suggested Implementation Order

1. **Resolve the override-vs-snapshot precedence question** (touches CT1's `freezeCampaignTheme`); pick the effective-landing approach if confirmed.
2. **`buildTemplatePrompt` tier-flip** + unit tests (pure lib, no UI).
3. **Public render resolution** — extend the select, add the landing fallback, preserve null-handling.
4. **Wizard** — thread `tier` into `generatePrompt`, reflect the theme landing default + override affordance (`frontend-design` skill).
5. **Integration tests** + `npm run build`.

### Resolved Decisions (enrichment)

1. **Effective-landing freeze — YES, baked into CT1.** `freezeCampaignTheme` captures `html_template ?? resolved.landingHtml`, keeping decision 7 (override wins) true for active campaigns. See CT1's resolved decisions; CT4 just reads the snapshot first.
2. **The tier lever lives inside `buildTemplatePrompt`** (single, unit-testable source). Callers pass `tier`; the function decides palette + footer. No caller-side palette pre-selection.
3. **Tier source = `clients.tier`** (brand level, D-1), surfaced via the wizard's brand list — extend the wizard `Client` interface + the server query that feeds it to include `tier` (no extra fetch).
