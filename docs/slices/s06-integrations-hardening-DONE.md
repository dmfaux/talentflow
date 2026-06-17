# S6 · Integrations hardening: private blobs + ownership-checked SAS + org-prefixed paths

> **Phase 1 — Close the live breach (isolation + RBAC + blob privacy) — **V1 core****
>
> Extracted from the [Multi-Tenant (Org → Brands) Migration Plan](../multi-tenant-migration-plan.md) (§6 — The vertical slices). Slice IDs are stable references for tracking.

- **Goal:** close the public-blob PII breach.
- **Backend:** `scripts/init-storage.ts` — container **private**, CORS restricted to the app host. `src/lib/azure-storage.ts` — `generateSasUrl` is the **only** CV read path; upload paths → `cvs/{orgId}/{brandSlug}/{candidateId}/…`, `logos/{orgId}/…` (take `orgId`); stop returning any raw `blockBlob.url`. Gate SAS issuance behind `resolveOwnedResource`/`assertOwnership` **before** `generateSasUrl` in `candidates/[id]/cv`, `cvs.zip`, and report CV downloads. `apply` upload writes to the org/brand path.
- **↳ Review correction (blocker for shippability — dangling blobs):** include a **`cv_url` backfill / one-off blob move inside this slice** (existing seeded values use `cvs/{clientSlug}/…`). Verify `generateSasUrl`/`deleteCV` resolve post-rename. **Acceptance add:** every non-null `cv_url` resolves to an existing blob after S6. Do **not** defer this to S14.
- **Frontend:** 🎨 report/candidate-detail request CVs via the SAS endpoint; careers-page logos via a public-logo path or long-TTL signed URL.
- **Acceptance:** direct blob GET without SAS → 403; CV download works for authorised admin via short-lived SAS; cross-tenant candidate → 404 before any SAS; new uploads under `cvs/{orgId}/…`; `cvs.zip`/report bundle only in-org CVs; no wildcard CORS; careers logo still renders.
- **Depends on:** S5 · **Risks:** flipping to private breaks embedded raw URLs (route logos via signed/public path); ensure connection-string credential extraction still works.

---

# Implementation Spec: S6 · Integrations hardening — private blobs + ownership-checked SAS + org-prefixed paths

**Generated**: 2026-06-17
**Codebase snapshot**: branch `s04-read-isolation`, commit `f1989db` (working tree carries in-flight S5 changes — see below)
**Change type**: Backend-only in practice (see Resolved Decision 1) — originally classified UI/UX because the blob-privacy flip threatened careers/chat **logo** rendering, but the public-logos-container decision keeps `branding_logo_url` a directly-usable URL, so **no component changes are required**.

> Originally classified UI/UX because flipping the container to private breaks every embedded raw logo URL on the **public careers + candidate-chat pages**. **Resolved Decision 1 (public logos container) eliminates all component changes** — `branding_logo_url` stays a directly-usable URL — so in practice S6 ships no UI edits. The `frontend-design` skill mandate stands for any logo UI work, but none is required under the chosen design.

> **Sequencing note — S6 depends on S5, and S5 is still being delivered.** At this commit the working tree already contains part of S5: the `org_id` `.notNull()` flip is applied in `src/db/schema.ts`, the S5 RBAC helpers (`effectiveOrgRole`/`authorizeApiOrg`/`authorizeApiBrand`) are live in `src/lib/api.ts:55-91`, and `src/db/seed.ts` is stamping `org_id`. **But the route conversions are not yet applied** — `candidates/[id]/cv` (`route.ts:11`), `cvs.zip` (`:15`), `report` (`:10`) and `clients/logo` (`:14`) all still call `requireApiAuth()`. **S6 must not start until S5 lands**, for two hard reasons: (1) S6's org-prefixed paths read `candidate.org_id` / `client.org_id`, which S5 guarantees non-null and correctly stamped on public writes; (2) S6 layers SAS-ownership-gating onto routes whose `getApiTenant()`+`resolveOwnedResource` conversion is S5's (read side is S4's). This spec is written against the **post-S5 world** (reads on `getApiTenant()`+`orgScope`/`resolveOwnedResource`, writes RBAC-gated, every leaf `org_id` non-null). Where S6 edits a route S5 also touches, apply S6 **on top of** S5's converted handler; if they land together, do both in one pass on that file.

> **AGENTS.md mandate:** this slice adds a new route handler (the public logo path) and edits several existing ones. Per `AGENTS.md`, **read the relevant route-handler / streaming-response guide under `node_modules/next/dist/docs/` before writing any route code** — this is a modified Next.js (16.2.2) and the response/streaming APIs may differ from training data.

---

## Codebase Analysis

The storage layer is a single module, `src/lib/azure-storage.ts` (179 lines), wrapping `@azure/storage-blob` against **one** container named by `AZURE_STORAGE_CONTAINER_NAME`:

- `uploadCV(clientSlug, campaignSlug, candidateId, file, filename)` (`:54`) → writes to `cvs/{clientSlug}/{campaignSlug}/{candidateId}/{filename}` (`:68`) and **returns `blockBlob.url`** (`:77`) — the raw, publicly-resolvable blob URL that is then stored in `candidates.cv_url`.
- `uploadClientLogo(clientId, file, filename)` (`:80`) → writes to `logos/{clientId}/{filename}` (`:92`), sets `Cache-Control: public, max-age=3600`, **returns `blockBlob.url`** (`:102`), stored in `clients.branding_logo_url`.
- `downloadBlob(blobUrl)` (`:105`), `deleteCV(blobUrl)` (`:130`), `generateSasUrl(blobUrl, expiresInHours)` (`:140`) all take a **full blob URL** and derive the blob path by stripping the container URL prefix (`blobUrl.replace(containerUrl + "/", "")` — `:115,:135,:150`). `generateSasUrl` extracts `AccountName`/`AccountKey` from the connection string (`:153-154`) → `StorageSharedKeyCredential` → a read-only (`"r"`) blob SAS (`:166-177`).

`scripts/init-storage.ts` (52 lines, run via `npm run storage:init`) creates the container with **`access: "blob"` (public blob read)** (`:22`), force-sets public access on an existing container (`:27`), and installs **wildcard CORS** (`allowedOrigins: "*"`, `:37`) so the browser canvas in `branding-section.tsx` can read logos cross-origin.

**Consumers of the storage layer (the full surface S6 touches):**

| Consumer (file:line) | Function | Notes |
|---|---|---|
| `apply/[clientSlug]/[campaignSlug]/route.ts:149` | `uploadCV` | public apply; stores `cv_url` (`:151`) |
| `apply/[clientSlug]/[campaignSlug]/upload/route.ts:51` | `uploadCV` | public separate upload; stores `cv_url` (`:54`) |
| `admin/clients/logo/route.ts:40` | `uploadClientLogo` | stores `branding_logo_url` (via client PATCH) |
| `admin/candidates/[id]/cv/route.ts:25` | `generateSasUrl` | **the sole SAS issuance point**; 1-hour TTL |
| `admin/campaigns/[id]/cvs.zip/route.ts:67` | `downloadBlob` | server-side bundle of shortlisted CVs |
| `lib/process-candidate.ts:72` | `downloadBlob` | worker reads CV for scoring (no auth ctx — internal) |
| `lib/popia.ts:19` | `deleteCV` | purge deletes the CV blob |
| `api/jobs/process/route.ts:53` | — | only a `cv_url IS NOT NULL` raw-SQL check; **path-agnostic, unaffected** |

**The SAS read paths, end to end:** the CV SAS endpoint `admin/candidates/[id]/cv/route.ts` is consumed by **both** `candidate-actions.tsx:67` (`downloadCv`) **and** `report-cv-preview.tsx:30` (the in-report PDF preview). So "report CV downloads" in the slice text is **not a separate route** — it is the same `candidates/[id]/cv` endpoint; gating that one endpoint covers the report preview too. The `cvs.zip` bundle (`report-toolbar.tsx:56` links to it) is the only path that reads CV blobs without a SAS, and it does so **server-side** inside an already-admin-gated route.

**Logo render sites (all consume `branding_logo_url` directly as `<img src>` — these are what break when the container goes private):** public careers chat page → `ChatPageClient`/`ChatInterface`/`ChatAuth` (`c/[clientSlug]/[campaignSlug]/chat/page.tsx:83`, `ChatInterface.tsx:312,389,506,688`, `ChatAuth.tsx:80,108`); admin `clients/[id]/page.tsx:429`, `campaign-wizard.tsx:1363`, `live-campaign-preview.tsx:299`; and `branding-section.tsx:64` `extractDominantColors`, which sets `img.crossOrigin="anonymous"` (`:67`) and reads the logo into a `<canvas>` via `getImageData` (`:80`) — this is the cross-origin reader the wildcard CORS exists for.

**Seed reality (matters for the backfill acceptance):** `seed.ts:811` writes `cv_url = https://example.blob.core.windows.net/cvs/${campaign.slug}/${email}.pdf` — a **fake host** and an **older path shape** (campaign-slug, no candidate-id segment) that never pointed at a real blob. Seeded candidates rely on `cv_text` (`:812`), not `downloadBlob`, so the demo never resolved these. No seeded `branding_logo_url` exists (logos are null in seed).

**Guards already in place (post-S1–S5):** `getApiTenant()` (`api.ts:37`), `resolveOwnedResource(table, id, ctx)` (`tenant.ts:168`, flat row or null, org-scoped in one query), `assertOwnership`/`isInScope` (`tenant.ts:149-161`), `orgScope` (`tenant.ts:141`), and the API RBAC gates `authorizeApiOrg`/`authorizeApiBrand`/`effectiveOrgRole` (`api.ts:58-91`). S6 **reuses these verbatim** — it adds no new guard primitives.

**Tech stack:** Next.js 16.2.2 (App Router), `@azure/storage-blob` 12.31, Drizzle 0.45.2 over postgres-js, vitest 4. `NEXT_PUBLIC_APP_URL` is available for CORS allow-listing. S6 adds one env var — `AZURE_STORAGE_LOGO_CONTAINER_NAME` (the public logos container, Resolved Decision 1) — to `.env.example` / `.env.local`.

## Related Issues

- **S1 (`3d99f1f`, done)** — `org_id` on every leaf + the `BEFORE INSERT` trigger backstop. S6 relies on `candidates.org_id` / `clients.org_id` being populated to build org-prefixed paths.
- **S4 (`f1989db`, spec done — read conversions are the prerequisite)** — converts all admin **GETs** to `getApiTenant()` + `orgScope`/`resolveOwnedResource`. This is what makes the CV SAS endpoint and the `cvs.zip`/report routes resolve their resource **org-scoped → 404 cross-tenant** *before* any blob access. S6's "gate SAS before `generateSasUrl`" and "bundle only in-org CVs" acceptance items are **largely satisfied by S4's read conversion**; S6's net-new contribution on those read routes is small (verify ordering + make the blob path resolve under the new scheme).
- **S5 (in flight — see Sequencing note)** — `org_id` `.notNull()` flip, public-write `org_id` stamping (apply/events/chat), the RBAC gates, and the `clients/logo` POST conversion to `getApiTenant`+`resolveOwnedResource(clients)`+`authorizeApiOrg(manage_brand)`. **S5 deliberately leaves `azure-storage.ts` untouched** ("keeps the current blob paths … Do not change `azure-storage.ts` paths/ACLs") — that refactor is **explicitly handed to S6**. So there is no overlap risk in the storage module; the only shared files are the route handlers (logo POST, apply POST/upload), where S6 layers the path change onto S5's already-converted handler.

### Assumptions from siblings (do **not** build these in S6)

- **The read-route org-scoping itself (S4).** S6 does **not** re-implement the `getApiTenant`+`resolveOwnedResource` conversion of `candidates/[id]/cv`, `cvs.zip`, or `report` — S4 owns that. S6 assumes the candidate/campaign is already resolved org-scoped and simply ensures the (now SAS-only) blob access happens **after** that resolve and resolves the **new** blob path.
- **Public-write `org_id` stamping (S5).** The apply POST already selects+stamps the campaign's `org_id` (S5 item 16); S6 reuses that resolved `org_id` to build the CV path rather than re-deriving it.
- **The `clients/logo` ownership+role gate (S5).** S5 converts the logo POST to resolve the brand in-org and gate `manage_brand`. S6 only changes the **blob path** (`logos/{orgId}/…`) and the **return/storage shape** on top of that converted handler.
- **`org_id` `.notNull()` model flip (S5).** Already applied in the working tree; S6 treats `candidate.org_id`/`client.org_id` as non-null `string`.
- **Full seed rework (S14)** and **POPIA cascade completeness (S11)** remain out of scope; S6 touches seeds only insofar as the backfill / forward path-shape requires (see Database Changes).

## Implementation Plan

### Database Changes

**No schema migration.** `candidates.cv_url` (`schema.ts:162`) and `clients.branding_logo_url` (`:56`) are already `text`. What changes is the **value stored** in them, plus a one-off **data backfill** (the slice's shippability blocker).

**Decision — store a relative blob *path* (key), not a full URL.** "Stop returning any raw `blockBlob.url`" (slice) is satisfied by having `uploadCV` return the **blob path** (e.g. `cvs/{orgId}/{brandSlug}/{candidateId}/{filename}`) and storing *that* in `cv_url`. This is backward-compatible with the existing helpers: `generateSasUrl`/`downloadBlob`/`deleteCV` already reduce their input to a path via `blobUrl.replace(containerUrl + "/", "")` — passing a bare path makes that replace a **no-op**, so a path flows through unchanged. (One subtlety: `decodeURIComponent` at `:115,:135,:150` will decode `%xx` in a stored path — keep stored paths URL-safe, which the current `clientSlug`/`candidateId`/sanitised-filename segments already are.)

- **Backfill script — `scripts/backfill-blob-paths.ts`** (new; add `"storage:backfill": "tsx scripts/backfill-blob-paths.ts"` to `package.json`, alongside `storage:init`). For every candidate with a non-null `cv_url`, joined to its campaign→client for `org_id` + `client.slug`:
  1. Derive the **old** blob path from the stored value (strip the container-URL prefix; for legacy values this is `cvs/{clientSlug}/{campaignSlug}/{candidateId}/{filename}`).
  2. Compute the **new** path `cvs/{org_id}/{client.slug}/{candidateId}/{filename}` (note: the new scheme is **org-prefixed and drops the `{campaignSlug}` segment** — `brandSlug === client.slug`).
  3. Server-side copy old→new (`destBlob.beginCopyFromURL(srcBlob.url)`, await completion), then `deleteIfExists` the source; update `candidates.cv_url` to the new path. Make the script **idempotent** (skip when `cv_url` is already in the new shape; tolerate a missing source if the dest already exists).
  4. **Log, don't fail on, blobs whose host is not the configured storage account** — the seeded `example.blob.core.windows.net` placeholders cannot be moved. Emit a summary count.
- **`seed.ts:811` (Resolved Decision 2)** — the current value is a fake-host placeholder that never resolved. Replace it so the acceptance holds in seeded environments: **when `isStorageConfigured()`, upload one shared sample CV per org once** (e.g. `cvs/${orgId}/_sample/sample.pdf`) and point every seeded `cv_url` at that path (all seeded CVs are synthetic, so a shared blob is fine and keeps the demo CV preview/download working); **otherwise set `cv_url` to `null`** (CI / fresh clones run seeds without storage — `cv_text` at `:812` still drives scoring/report content). Either branch leaves **no non-null `cv_url` that fails to resolve**. (The fuller per-candidate seeded-blob rework remains S14.)
- **Acceptance gate:** after the backfill, **every non-null `cv_url` resolves to an existing blob** (verify with `generateSasUrl` + a HEAD, or a dry-run report mode in the script). The script **nulls any production `cv_url` that cannot be resolved** (orphaned rows / non-account hosts such as the old fake placeholders) and logs them, so the guarantee holds literally (Resolved Decision 2). Do **not** defer to S14.

### API / Backend Changes

#### 1. `scripts/init-storage.ts` — make the CV container private, restrict CORS

- Replace `createIfNotExists({ access: "blob" })` (`:22`) and the `setAccessPolicy("blob")` (`:27`) with **no public access** (omit `access`, i.e. private container) for the CV/PII container.
- Replace the **wildcard CORS** block (`:34-44`) with an account-level allow-list of the app origin only — read `NEXT_PUBLIC_APP_URL` and set `allowedOrigins` to that host (comma-joined across envs), never `"*"`. (Azure CORS is set at the **storage-account** level via `BlobServiceClient.setProperties`, so it applies to both containers; it governs only browser cross-origin reads and does **not** grant access — the private CV container still requires a SAS regardless. The restricted CORS is what keeps `extractDominantColors` able to read a logo into its canvas — Resolved Decision 1.)
- **Provision the second, public logos container** (Resolved Decision 1): `client.getContainerClient(process.env.AZURE_STORAGE_LOGO_CONTAINER_NAME).createIfNotExists({ access: "blob" })`. Keep it public-blob; logos are non-PII branding assets.

#### 2. `src/lib/azure-storage.ts` — org-prefixed paths, path-based values, SAS-only CV reads

- **`uploadCV`** — new signature `uploadCV(orgId, brandSlug, candidateId, file, filename)`; blob path `cvs/${orgId}/${brandSlug}/${candidateId}/${filename}`; **return the blob path**, not `blockBlob.url`.
- **`uploadClientLogo`** — new signature `uploadClientLogo(orgId, clientId, file, filename)`; writes to the **public logos container** (`AZURE_STORAGE_LOGO_CONTAINER_NAME`) at `logos/${orgId}/${clientId}/${filename}`, keeps `Cache-Control: public, max-age=3600`, and **returns the direct public URL** stored in `branding_logo_url` (Resolved Decision 1 — a public logo URL is not a PII leak; the "stop returning raw `blockBlob.url`" rule applies to **CVs only**).
- **`generateSasUrl` / `downloadBlob` / `deleteCV`** — accept a blob **path** (rename the param to `blobPath`); keep the defensive `.replace(containerUrl + "/", "")` so any still-full-URL legacy value during the backfill window is reduced correctly. `generateSasUrl` remains the **only** code path that yields a readable CV URL; confirm nothing else returns a raw CV URL.
- Keep the connection-string `AccountName`/`AccountKey` extraction (`:153-158`) — **risk per slice**: verify it still works after the container ACL flip (it is independent of container access level, but assert in the integration test that a SAS is still mintable).

#### 3. Caller updates (build the org-prefixed paths from already-resolved org context)

- **`apply/[clientSlug]/[campaignSlug]/route.ts:149`** — call `uploadCV(campaign.org_id, clientSlug, candidateId, buffer, cvFile.name)`. `campaign.org_id` comes from the S5-added `org_id` in the campaign select (`:27-38`); `clientSlug` is the route param (== `client.slug` == brandSlug).
- **`apply/[clientSlug]/[campaignSlug]/upload/route.ts:51`** — same call shape; **add `org_id` to this route's campaign select** (`:22-27` currently selects only `id`+`status`) so the path can be built. (S5 did not need `org_id` here because it does not insert a candidate — S6 does.)
- **`admin/clients/logo/route.ts:40`** — call `uploadClientLogo(brand.org_id, clientId, buffer, safeName)`, where `brand` is the `resolveOwnedResource(clients, clientId, ctx)` row from S5's conversion. (The standalone `UUID_REGEX` check at `:22` is superseded by `resolveOwnedResource`; keep both — defence in depth.)

#### 4. SAS-ownership gating on the read paths (mostly verify; small net-new)

- **`admin/candidates/[id]/cv/route.ts`** — once on S4/S5's `getApiTenant()`+org-scoped resolve, the candidate is already 404'd cross-tenant *before* line 25. S6's job: (a) **confirm** `generateSasUrl` runs only **after** a successful in-org resolve; (b) feed it the **new path** value of `cv_url`; (c) keep the 1-hour TTL. No 403/role change for reads — **any in-org member may download** (acceptance: "CV download works for authorised admin"; Resolved Decision 3 — org-scoped read, no `recruiter+` gate). The cross-tenant `id` returns **404 before any SAS is minted** (the headline acceptance item).
- **`admin/campaigns/[id]/cvs.zip/route.ts`** — after S4's `resolveOwnedResource(campaigns, id, ctx)` (replacing `:21-26`) and `orgScope` on the shortlisted-candidates query (`:38-39`), the bundle **only contains in-org CVs**. S6 verifies this and that `downloadBlob` resolves the new paths. No SAS here (server-side read inside an admin route is fine).

### Frontend Changes

> **No component changes are required under Resolved Decision 1** (the public logos container keeps `branding_logo_url` directly usable). The CV-side UI also needs **no change** — `report-cv-preview.tsx` and `candidate-actions.tsx` already fetch the SAS endpoint and consume `data.url`; once the container is private the SAS URL simply becomes the *only* way to read the blob, which already works. **If any logo-adjacent UI is touched, the `frontend-design` skill is mandatory** (all UI/UX work in this project; the logo surfaces use the Tailwind v4 tokens in `globals.css`) — but the chosen design ships zero UI edits.

**The one real frontend risk — logos — is closed by Resolved Decision 1.** Today every careers/chat/admin surface renders `<img src={branding_logo_url}>` against a **publicly-readable** blob URL; the moment the CV container goes private those URLs would 403 and **careers/chat branding would disappear** (acceptance: "careers logo still renders"). The decision — **serve logos from a dedicated public logos container** (`AZURE_STORAGE_LOGO_CONTAINER_NAME`, provisioned by `init-storage.ts`, account-level CORS restricted to `NEXT_PUBLIC_APP_URL`) — keeps `branding_logo_url` a **direct public URL**, so **every render site below is unchanged** and `extractDominantColors` keeps working (cross-origin allowed by the restricted CORS):

- Public/candidate: `c/[clientSlug]/[campaignSlug]/chat/page.tsx:83`, `ChatInterface.tsx:312,389,506,688`, `ChatAuth.tsx:80,108`.
- Admin: `clients/[id]/page.tsx:429`, `campaign-wizard.tsx:1363`, `live-campaign-preview.tsx:299`, `branding-section.tsx:64` (`extractDominantColors`).

Because the stored value stays a directly-usable URL, **the work is entirely in `init-storage.ts` + `uploadClientLogo`** — no component edits. (The rejected single-container proxy-route alternative is discussed in Resolved Decision 1.)

### Edge Cases and Boundary Conditions

- **Direct blob GET without SAS → 403.** After the ACL flip, an unauthenticated GET of a CV blob URL must 403. Assert in the integration test against a real (or Azurite) container.
- **Cross-tenant candidate → 404 before any SAS.** A valid Org-B candidate UUID hit by an Org-A admin returns 404 from the org-scoped resolve, and `generateSasUrl` is **never reached** — assert the SAS function is not called (spy) for the cross-tenant case.
- **`cvs.zip` / report bundle only in-org CVs.** An Org-A admin bundling a campaign must never receive an Org-B candidate's CV even if the campaign query were tampered — guaranteed by `orgScope` on the candidates query.
- **Backfill idempotency & partial runs.** Re-running the backfill must be safe (skip already-migrated, tolerate dest-exists/source-missing). A crash mid-run leaves a consistent mix of old/new paths, all resolvable because the helpers strip-prefix defensively.
- **Non-resolving rows reconciled, never skipped.** Orphaned/non-account `cv_url`s are **nulled and logged** by the backfill; seeded values are either backed by a shared sample blob or null (Resolved Decision 2). After S6 no non-null `cv_url` dangles.
- **`deleteCV` / POPIA purge post-rename.** `popia.ts:19` must delete the **new** path; verify a purge after backfill removes the moved blob (slice: "Verify `generateSasUrl`/`deleteCV` resolve post-rename").
- **Worker reads (`process-candidate.ts:72`).** The scoring worker has no auth context and reads via `downloadBlob` — confirm it resolves new paths and is unaffected by the ACL flip (server-side credential access, not public read).
- **Logo CORS / canvas taint.** `extractDominantColors` must still produce colours — verify it reads a logo from the public logos container under the **app-host-restricted** CORS without tainting the canvas (Resolved Decision 1).
- **Connection-string credential extraction (slice risk).** Assert `generateSasUrl` still mints a valid SAS after the container goes private.
- **No raw CV URL leaks.** Grep the codebase post-change: no handler or component returns/embeds a raw CV blob URL; the only CV URL emitted to a client is a SAS from `candidates/[id]/cv`.

### Test Plan

Extends the **`DATABASE_URL`-gated integration project** introduced in S4/S5 (the shared two-org fixture). Storage tests additionally need a blob backend — gate them on storage config (Azurite locally, or a flag) so default `npm test` stays DB/blob-free.

- **DB-free unit tests (vitest, `npm test`):**
  - `azure-storage` path construction: `uploadCV`/`uploadClientLogo` produce exactly `cvs/{orgId}/{brandSlug}/{candidateId}/{filename}` and `logos/{orgId}/{clientId}/{filename}`; `generateSasUrl`/`downloadBlob`/`deleteCV` reduce **both** a bare path and a full legacy URL to the same blob key (the backward-compat assertion).
  - Backfill old→new path derivation: legacy `cvs/{clientSlug}/{campaignSlug}/{candidateId}/{file}` → `cvs/{orgId}/{clientSlug}/{candidateId}/{file}`; non-account hosts flagged.
- **Storage-backed integration tests (gated):**
  1. **Privacy:** unauthenticated GET of a CV blob → 403; `generateSasUrl` for the same blob → 200 and expires (assert the `se`/expiry param).
  2. **Ownership-before-SAS:** Org-A admin → `candidates/[id]/cv` for an Org-B candidate → **404, SAS spy never called**; for an in-org candidate → 200 with a working SAS.
  3. **Bundle scoping:** `cvs.zip` for an Org-A campaign never includes an Org-B CV; new-path blobs download into the zip.
  4. **Upload paths:** an `apply` upload lands at `cvs/{org}/{brand}/{candidate}/…`; a logo upload lands at `logos/{org}/{client}/…`.
  5. **Backfill:** seed an old-path blob + `cv_url`, run the script, assert the blob moved, the source is gone, `cv_url` updated, and `generateSasUrl`+`deleteCV` resolve; re-run is a no-op.
  6. **Logo render:** a logo in the public logos container returns the image for a public (unauthenticated) request and renders cross-origin under the restricted CORS; the **CV** container rejects an unauthenticated GET (403); the account-level CORS is non-wildcard.
- **Build/typecheck:** `npm run build` — the `uploadCV`/`uploadClientLogo`/`generateSasUrl` signature changes force every call site to compile against the new shapes.

### Suggested Implementation Order

1. **`azure-storage.ts` signature + path + return-shape changes** (org-prefixed paths, path-based values, SAS-only) — the forcing function; fix the resulting compile errors at all call sites (apply POST/upload, logo POST, plus add `org_id` to the upload route's select).
2. **`init-storage.ts`** — private CV container, **public logos container**, account-level CORS restricted to the app host (Resolved Decision 1); add `AZURE_STORAGE_LOGO_CONTAINER_NAME` to `.env.example`/`.env.local`.
3. **Logo serving** — point `uploadClientLogo` at the public logos container; **no component changes** (Resolved Decision 1). Verify careers/chat logos and `extractDominantColors` still render.
4. **Backfill script** `scripts/backfill-blob-paths.ts` + `seed.ts:811` path-shape update; run dry-run, then live; verify the acceptance (every non-null `cv_url` resolves).
5. **Verify SAS-ownership ordering** on `candidates/[id]/cv` and in-org bundling on `cvs.zip` (mostly inherited from S4) and that `deleteCV`/worker reads resolve the new paths.
6. **Tests:** unit path tests + the gated storage integration matrix; full suite + `npm run build`.

### Resolved Decisions

All three prior open questions are resolved below — best-judgement calls grounded in the slice acceptance, the current schema, and the V1 breach-closing goal. The body sections above already reflect them.

1. **Logo serving — dedicated public logos container.** Add a second container named by a new `AZURE_STORAGE_LOGO_CONTAINER_NAME`, provisioned public-blob by `init-storage.ts`; the CV/PII container goes private. `uploadClientLogo` writes logos there and returns a **direct public URL**, so `branding_logo_url` stays directly usable and **every render site is unchanged** (zero component churn). Account-level CORS is restricted to `NEXT_PUBLIC_APP_URL` (never `*`), which still lets `extractDominantColors` read a logo into its canvas. This satisfies every acceptance line — "container private" (CVs), "no wildcard CORS", "careers logo still renders" — at the lowest risk, because logos are non-PII branding assets for which a public tier is appropriate. **Rejected alternative:** a single private container with a same-origin logo **proxy route** (resolve client → stream the blob via `downloadBlob`, store the route URL in `branding_logo_url`). It is architecturally cleaner (one container, no CORS at all) but adds a new public route and per-request function egress with **no security benefit for non-PII assets**. Revisit only if logos must later become access-controlled.

2. **Non-resolving `cv_url`s — reconcile, never dangle.** The acceptance ("every non-null `cv_url` resolves") is enforced in both data sources. **Production backfill:** move real blobs old→new; for any non-null `cv_url` that does not resolve (orphans, non-account hosts such as the old fake placeholders), **null the column and log it**. **Seed:** the existing fake-host value never resolved — replace it so the guarantee holds in seeded environments too: when `isStorageConfigured()`, upload **one shared sample CV per org** (`cvs/{orgId}/_sample/sample.pdf`) and point seeded `cv_url`s at it (keeps the demo CV preview/download working); otherwise set `cv_url` to `null` (`cv_text` still drives scoring/report copy). The per-candidate seeded-blob rework remains S14, but the **resolution guarantee is met now**, not deferred.

3. **CV reads stay org-scoped, not role-gated.** CV download (`candidates/[id]/cv`) is allowed to **any in-org member**, matching S4's read posture and the acceptance's "authorised admin" (= in-org). A `recruiter+` gate is intentionally **not** added: a viewer who can already see a candidate's name, score, and rationale in the report/list is not meaningfully restricted by hiding the CV, so the extra gate would be inconsistent without a broader PII-minimisation pass. The hook, if product later wants it, is a one-line `authorizeApiBrand(ctx, brandId, "recruiter")` on the SAS endpoint.
