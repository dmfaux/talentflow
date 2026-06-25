---
name: TalentStream
description: The Signal Desk — a precision recruiting instrument on a calm, cool field.
colors:
  cobalt: "#2c5bff"
  cobalt-deep: "#1a45d4"
  cobalt-tint: "#e8eeff"
  electric-teal: "#05dbd6"
  electric-teal-deep: "#04b0ac"
  electric-teal-soft: "#d4f7f6"
  moss: "#0a8a5a"
  moss-deep: "#066b44"
  moss-soft: "#d0f0de"
  saffron: "#d68a0b"
  saffron-deep: "#a86a00"
  saffron-soft: "#fff0cc"
  red: "#c02616"
  red-light: "#ffe0da"
  midnight-indigo: "#11123c"
  ink-soft: "#2f3941"
  ink-muted: "#5a6b7a"
  ink-faint: "#9fb5c4"
  cool-slate: "#f0f3f7"
  cool-slate-2: "#e1e7ef"
  surface: "#ffffff"
  border: "#d1dce6"
  border-strong: "#9fb5c4"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "clamp(2.5rem, 6vw, 5rem)"
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Instrument Sans, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Instrument Sans, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Instrument Sans, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
    fontFeature: "'ss01', 'ss02'"
  label:
    fontFamily: "Instrument Sans, -apple-system, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.14em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "40px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "36px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
    textColor: "{colors.surface}"
  button-danger:
    backgroundColor: "{colors.red}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "#00000000"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "36px"
  input:
    backgroundColor: "#f0f3f766"
    textColor: "{colors.midnight-indigo}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.midnight-indigo}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-tier:
    backgroundColor: "{colors.cobalt-tint}"
    textColor: "{colors.cobalt-deep}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
    typography: "{typography.label}"
  nav-item-active:
    backgroundColor: "#ffffff26"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
---

# Design System: TalentStream

## 1. Overview

**Creative North Star: "The Signal Desk"**

TalentStream is a precision recruiting instrument laid out on a calm, cool field. The
working surface is a quiet blue-grey canvas — never white, never warm — and against
that calm, two saturated colours appear *rarely and on purpose*: Cobalt Signal for the
one action that matters, Electric Teal for the one thing worth noticing. This is the
visual translation of the logo (a funnel of muted bars narrowing to a single bright
signal dot) and of the product's first principle: **decisions, not data dumps.** The
interface holds a lot of information, but it never shouts all of it at once. It points.

The personality is confident, warm, and precise — a senior recruiter who knows hiring
cold but speaks plainly and treats people, not rows, as the subject. Authority comes
from clarity: generous structure, deliberate hierarchy, evidence laid beside every
decision. Components are **tactile and confident** — primary actions are solid and
present, they lift on hover, arrows slide, links draw their own underline — but the
restraint is in *where* that energy is spent, never on decoration for its own sake.

This system explicitly rejects three things. It is **not generic AI SaaS** —
no indigo-on-white sameness, no rounded-card grids, no gradient blobs, no
hero-metric template, no tracked eyebrow over every section. It is **not legacy
enterprise HR** — not Workday/Taleo/SAP form-soup or joyless corporate grey. And it
is **not a cold, clinical ATS** — candidates are people, so warmth (especially around
rejection and waiting) is a feature, not a missing one.

**Key Characteristics:**
- Cool blue-grey canvas (`#f0f3f7`), never white or warm — the calm field that makes signals read.
- Two rationed accents: Cobalt Signal (action/brand) + Electric Teal (the one thing to notice).
- Deep Midnight Indigo ink (`#11123c`) and a navy app frame; depth from tone, not shadow.
- Instrument Serif display against Instrument Sans body — editorial authority, humanist warmth.
- Flat by default; shadow is a response to state. Tactile, lifting components.
- Semantic status vocabulary (moss/saffron/red) rendered as soft-tint callouts, never side-stripes.

## 2. Colors

A cool, low-temperature palette: a blue-grey field and deep-indigo ink, punctuated by two rationed saturated signals and a warm-shifted status set.

### Primary
- **Cobalt Signal** (`#2c5bff`): The single primary action and brand colour. Primary buttons, the active form field's focus ring, selected state, key links, the wordmark's second syllable, the `::selection` highlight. Its deep variant **Cobalt Deep** (`#1a45d4`) is the hover/pressed state; **Cobalt Tint** (`#e8eeff`) backs informational chips and the Premium tier badge.

### Secondary
- **Electric Teal** (`#05dbd6`): The "notice this" accent — the single bright signal beside the funnel. The live pulse dot in the logo and the active-nav indicator, premium/enterprise highlights, moments of editorial emphasis. Used even more sparingly than Cobalt. Deep variant **Electric Teal Deep** (`#04b0ac`) for text on tint; **Electric Teal Soft** (`#d4f7f6`) for backgrounds. *Note: the CSS token is historically named `--color-vermillion`; it is teal, not vermillion — a legacy misnomer, not a second colour.*

### Tertiary
The semantic status set — slightly warm against the cool field so success/warning/error read instantly. Always rendered as a soft-tint callout: tinted background + matching deep text + a thin matching-hue border.
- **Moss** (`#0a8a5a`, soft `#d0f0de`, deep `#066b44`): Success, shortlisted, positive signal.
- **Saffron** (`#d68a0b`, soft `#fff0cc`, deep `#a86a00`): Warning, pending, follow-up, awaiting-decision.
- **Red** (`#c02616`, light `#ffe0da`): Error and destructive only — never decorative.

### Neutral
- **Midnight Indigo** (`#11123c`): Primary ink for headings and high-emphasis text; also the colour of the app frame (sidebar, overlays). Not pure black — a deep indigo so the whole system stays in one cool family.
- **Ink Soft** (`#2f3941`): Secondary text, body copy where indigo is too heavy.
- **Ink Muted** (`#5a6b7a`): Tertiary/supporting text. *This is the floor for body text — do not go lighter.*
- **Ink Faint** (`#9fb5c4`): Placeholder text, disabled, decorative icon strokes, hairline emphasis. Decorative only — never load-bearing body copy.
- **Cool Slate** (`#f0f3f7`): The canvas. The default page background everywhere.
- **Cool Slate 2** (`#e1e7ef`): A second neutral layer — recessed panels, toolbars, the standard tier badge.
- **Surface** (`#ffffff`): Cards, inputs, raised content sitting on the canvas.
- **Border** (`#d1dce6`) / **Border Strong** (`#9fb5c4`): Hairlines and dividers; strong for emphasized separation.

### Named Rules
**The Two-Signal Rule.** Only two saturated colours exist — Cobalt and Electric Teal — and together they cover well under 10% of any screen. Status hues are functional, not part of the brand palette. If a screen looks colourful, signals have stopped being signals; pull back.

**The Cool-Field Rule.** The body background is Cool Slate (`#f0f3f7`), never white and never warm-tinted. Warmth lives in the status set and the serif, not the canvas. A warm or cream background is forbidden — it breaks the instrument.

## 3. Typography

**Display Font:** Instrument Serif (with Georgia, serif)
**Body Font:** Instrument Sans (with -apple-system, BlinkMacSystemFont, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, monospace)

**Character:** A true contrast-axis pairing — a humanist serif against a humanist sans from the same family lineage, so they harmonise without twinning. Instrument Serif carries editorial authority and warmth at display sizes (including a used italic); Instrument Sans is the clean, legible workhorse for every label, button, and table cell, with stylistic sets `ss01`/`ss02` on. JetBrains Mono carries numerics, IDs, money, and code so figures align and never get mistaken for prose.

### Hierarchy
- **Display** (Instrument Serif, 400, `clamp(2.5rem, 6vw, 5rem)`, lh 1.0, ls −0.02em): Marketing hero and candidate-landing headlines only. Fluid clamp is permitted **on brand surfaces** (homepage, apply/landing). Capped at ~5rem — confident, not shouting.
- **Headline** (Instrument Sans, 600, 1.5rem/24px, lh 1.2): Page titles inside the product app and section openers.
- **Title** (Instrument Sans, 600, 1rem/16px, lh 1.3): Card titles, panel headers, table-group labels.
- **Body** (Instrument Sans, 400, 0.875rem/14px, lh 1.6): Default reading text. Cap prose at 65–75ch; tables and dense panels may run wider.
- **Label** (Instrument Sans, 600, 0.68rem, ls 0.14em, UPPERCASE): The `.eyebrow` — tracked, uppercase micro-labels. A *deliberate, occasional* device (kickers, tier badges, table column heads), never stamped above every section.
- **Mono** (JetBrains Mono, 500, ~0.8rem): Numerics, money, IDs, credit balances, code, timestamps.

### Named Rules
**The Fixed-Scale Rule.** Inside the product app, type sizes are fixed rem, not fluid. `clamp()` headings belong on brand surfaces only — a fluid h1 that shrinks inside a sidebar looks worse, not designed.

**The Serif-Is-For-Voice Rule.** Instrument Serif is for display and editorial voice. Never set UI labels, buttons, inputs, or table data in the serif — that's the product-register tell to avoid.

## 4. Elevation

Flat by default; depth comes from **tone, not shadow**. The dark Midnight-Indigo app frame against the Cool-Slate canvas against white surfaces creates three legible planes with no shadow at all. Shadow is reserved as a *response to state* — modals/overlays lift off the page, and the active nav item gets a faint inset lift. The system never sprays ambient shadow across resting cards (that's the 2014-app tell).

### Shadow Vocabulary
- **Overlay** (`box-shadow: shadow-xl` ≈ `0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)`): Modals, dialogs, popovers — content that has left the page plane.
- **Nav-active lift** (`box-shadow: 0 4px 12px -4px rgba(0,0,0,0.3)`): The selected sidebar item on the navy frame, a quiet pressed-in cue.
- **Subtle** (`shadow-sm`): Sparingly, on a small set of raised cards that need separation the border can't carry alone.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. If you reach for a shadow on a resting card, reach for a border or a tonal step first. Shadow appears only when something is genuinely above the page (overlay) or responding to state.

## 5. Components

The vocabulary is **tactile and confident**: solid, present primary actions that physically respond — but a single, consistent affordance for every standard task. Same button shape, same form-control, same icon style (16px line icons, 1.5 stroke) screen to screen.

### Buttons
- **Shape:** Gently rounded (8px, `rounded-lg`). Pills (`rounded-full`) are reserved for chips/badges, not buttons.
- **Primary:** Solid Cobalt Signal (`#2c5bff`) on white text, `height 36px` (h-9; h-8/32px in dense rows), `padding 0 16px`, body weight 500–600.
- **Hover / Focus:** Background deepens to Cobalt Deep (`#1a45d4`) over `transition-colors` ~200ms. Confident variants add a magnetic lift (`.lift` → `translateY(-2px)`, ease-out-quart) and arrow-slide on CTAs. Focus-visible: a Cobalt ring.
- **Danger:** Solid Red (`#c02616`), hover `red/90`. Destructive only.
- **Ghost / Tertiary:** Transparent, Ink-Soft text, `hover:bg-cool-slate` + Ink darkens. For Cancel and low-emphasis actions.

### Chips / Badges
- **Style:** `rounded-full`, uppercase Label type, tracked (0.12–0.14em). Soft-tint background + matching deep text (e.g. Premium = Cobalt Tint bg + Cobalt Deep text; Enterprise = Electric Teal Soft + Teal Deep; Standard = Cool Slate 2 + Ink Muted).
- **State:** Status pills follow the same soft-tint formula keyed to the semantic hue.

### Cards / Containers
- **Corner Style:** 12px (`rounded-xl`); larger panels may use 16px (`rounded-2xl`).
- **Background:** White Surface on the Cool-Slate canvas.
- **Shadow Strategy:** Flat at rest (see Elevation). Lean on the `#d1dce6` border for separation.
- **Border:** 1px Border (`#d1dce6`); never a thick coloured side-stripe.
- **Internal Padding:** 24px (`p-6`) default; 20px in denser contexts.

### Inputs / Fields
- **Style:** Full-width, `rounded-lg`, 1px Border, faint Cool-Slate fill (`bg-cream/40` ≈ `#f0f3f766`), Midnight-Indigo text, Ink-Faint placeholder, `px-3 py-2` (larger auth fields `h-12 px-4`).
- **Focus:** Border shifts to Cobalt + a 1–2px Cobalt ring at ~20% (`focus:ring-1 focus:ring-cobalt/20`); larger fields brighten the fill to white. No glow.
- **Error:** Border + ring shift to Red; helper text in Red Deep.

### Navigation
- **App sidebar:** Sticky, 13rem (`w-52`), drenched Midnight-Indigo (`#11123c`). Items are white at low opacity (55% rest → 100% active), `rounded-lg`, 0.8rem medium. Active = `bg-white/15` + faint lift + an Electric-Teal dot pinned right. Logout hovers to a solid Electric-Teal/`vermillion` fill.
- **Top bar:** 56px (`h-14`), translucent white (`bg-paper/85`) + `backdrop-blur-md`, hairline bottom border, sticky. Holds the logo, active-campaign count, brand switcher.

### Logo (Signature)
A 32px mark: four descending Cobalt bars (a candidate pool narrowing to a shortlist) with a single Electric-Teal **pulse dot** beside the last bar — "the hire." Wordmark is lowercase `talent` + Cobalt `stream`, tight tracking (−0.035em). The dot's pulse is the only ambient animation in the brand and the literal source of the North Star.

## 6. Do's and Don'ts

### Do:
- **Do** keep the body background Cool Slate (`#f0f3f7`) — never white, never warm/cream.
- **Do** ration the two signals: Cobalt for the primary action, Electric Teal for the one thing to notice. Together under ~10% of a screen.
- **Do** render status as soft-tint callouts: tinted background + matching deep text + a thin matching-hue border (e.g. `bg-moss-soft` + `text-moss-deep` + `border-moss/25`).
- **Do** keep depth tonal (navy frame → slate canvas → white surface). Reserve shadow for overlays and state.
- **Do** let primary actions feel tactile — solid fill, hover-deepen, `.lift` and arrow-slide on confident CTAs — within a single consistent button shape.
- **Do** set Instrument Serif for display/editorial voice and Instrument Sans for all UI text and data.
- **Do** pair every status hue with an icon or label, not colour alone (WCAG 2.2 AA; candidates are a broad public audience).
- **Do** keep body text at Ink Muted (`#5a6b7a`) or darker for ≥4.5:1 contrast.

### Don't:
- **Don't** ship **generic AI SaaS**: no indigo-on-white sameness, no identical rounded-card grids, no gradient blobs, no hero-metric template.
- **Don't** stamp a **tracked uppercase eyebrow above every section** — the `.eyebrow` is an occasional device, not section scaffolding. No `01 / 02 / 03` numbered markers unless the content truly is an ordered sequence.
- **Don't** drift toward **legacy enterprise HR** (Workday/Taleo/SAP) form-soup or joyless corporate grey, or a **cold clinical ATS** that renders candidates as faceless rows.
- **Don't** use `border-left`/`border-right` > 1px as a coloured accent stripe on cards, callouts, or alerts — use the soft-tint formula instead.
- **Don't** use gradient text (`background-clip: text`), decorative glassmorphism, or neon/crypto theatrics.
- **Don't** set UI labels, buttons, or table data in Instrument Serif. Serif is voice, not chrome.
- **Don't** put body text in Ink Faint (`#9fb5c4`) — it fails contrast. It's for placeholders, disabled, and decorative strokes only.
- **Don't** gate content visibility on a scroll/class-triggered reveal (e.g. `.animate-on-scroll { opacity: 0 }`) — it ships blank in headless renderers and background tabs. Reveals must enhance an already-visible default.
- **Don't** scatter ambient shadows on resting cards — that's the dated-app tell.
