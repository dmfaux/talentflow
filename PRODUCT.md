# Product

## Register

product

> Dual-register product. The default lens above is `product` because the centre of
> gravity is the recruiting workspace — admin & operator dashboards, candidate
> management, campaigns, billing, usage. But three surfaces are **brand**-register
> and should be designed with the brand lens when worked on directly:
> the marketing **homepage** (`src/app/page.tsx`), the **candidate apply/landing
> flow** (`src/app/c/[clientSlug]/[campaignSlug]`), and the **per-client
> white-label themes**. Override the register per task accordingly.

## Users

**Recruiters & hiring teams at South African corporates** (org owners, org admins,
members). They run AI-powered hiring campaigns: write a role spec, publish a
branded landing page, and review a rated, qualified shortlist instead of wading
through hundreds of raw CVs. They work under time pressure, manage one or more
client brands (white-label), and must trust — and pay real money for — AI scoring
and AI candidate chat. The job: get from "we have a role to fill" to "here is a
defensible shortlist" in about two weeks, with humans in control of consequential
calls.

**Operators** (internal TalentStream staff) manage organizations, theme kits,
invoicing, impersonation/support, and platform health from a separate console.

**Candidates** — South African job applicants — meet the product through a
branded public landing page: they apply, upload a CV, and complete an AI chat
interview. This is a broad public audience on every device, so accessibility,
clarity, and warmth carry real weight here.

## Product Purpose

TalentStream runs AI-powered recruitment campaigns. Give it the role spec; receive
a rated, qualified shortlist. It replaces manual CV screening and ad-hoc WhatsApp
candidate comms with AI scoring plus an in-app chat channel, and keeps a human in
the loop on rejections (weak candidates are parked for explicit human accept /
dismiss, never auto-rejected). It is a multi-tenant SaaS with usage-based pricing
(AI credits + model tiers), per-client white-label branding, and POPIA-compliant
data handling. Success looks like: recruiters trust the shortlist enough to act on
it, candidates feel respected throughout, and the platform's own identity stays
crisp while each client's brand shines on its public pages.

## Brand Personality

**Confident, warm, precise.** Authoritative like a firm that knows hiring cold —
decisive, evidence-led, premium — but humane, because hiring is about people, not
rows in a table. Voice is clear and direct; it explains its reasoning rather than
asking for blind faith, and it treats candidates with dignity (especially around
rejection). Confidence comes from clarity, not volume. Emotional goals: recruiters
feel *in control and well-advised*; candidates feel *respected and informed*.

## Anti-references

- **Generic AI SaaS.** Indigo-on-white sameness, rounded cards everywhere, gradient
  blobs, the hero-metric template, eyebrow-above-every-section scaffolding. The
  default everyone ships — TalentStream should not be guessable as "an AI tool."
- **Legacy enterprise HR** (Workday / Taleo / SAP). Cluttered, dated, form-soup,
  joyless corporate gray. We are the modern alternative to this, not a reskin of it.
- **Cold, clinical ATS.** Spreadsheet-gray, candidates-as-rows, no warmth. Treating
  people as data is the exact failure our "candidates are people" principle rejects.
- (Also avoid loud startup/crypto theatrics: neon gradients, gradient text,
  aggressive motion, gimmicky 3D.)

## Design Principles

1. **Decisions, not data dumps.** Recruiters come to act — shortlist, advance,
   reject. Lead every screen with the decision and the evidence behind it, not raw
   rows. Data-dense is fine; data-soup is not.
2. **Candidates are people, not records.** Treat applicants with dignity across
   both the candidate-facing flow and the recruiter's view. Warmth is a feature,
   most of all around rejection and waiting states.
3. **Earn trust in the AI.** The product asks humans to rely on AI scoring and to
   spend real money. Show the reasoning, surface confidence honestly, and keep
   humans in control of consequential calls. Never hide the machine.
4. **One frame, many brands.** TalentStream's own identity must coexist with
   per-client white-label themes. The system frame stays quietly excellent so each
   client's brand can shine on its public pages — confident, never competing.
5. **Confident restraint.** Authority comes from clarity and precision, not volume
   or decoration. Say less, mean more; every element earns its place.

## Accessibility & Inclusion

Target **WCAG 2.2 AA**: ≥4.5:1 body-text contrast (≥3:1 large text), full keyboard
navigation with visible focus, and honored `prefers-reduced-motion` (crossfade or
instant fallback for every animation). Because candidates are a broad public
audience on every device, status colours must not rely on hue alone (pair with
icon/label/shape), and the candidate apply/landing/chat flow is the highest
accessibility priority. POPIA governs data handling but is a privacy requirement,
not an a11y one — keep the two distinct.
