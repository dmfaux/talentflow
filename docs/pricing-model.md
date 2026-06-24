# TalentStream — Usage-Based Pricing Model (canonical: value-credit)

> Status: **canonical**, 2026-06-24. Calibrated against real `usage_events` telemetry
> (dev DB, 504 `ai_tokens` rows) and authoritative Anthropic pricing (cached 2026-06-04).
> FX assumption **R18.50 / USD**. The landing page, `src/lib/pricing.ts`, the spend view,
> and future billing all use the model below.

## 1. The unit — the "AI Credit"

- **1 AI credit = R1.20 ex VAT** — the single sell-price knob.
- An AI operation's **credit cost = base units × the tier's credit rate**, where
  `base units = (input_tokens + 5 × output_tokens) / 1000`.
- The **×5 output weight** isn't arbitrary: every model we map a tier to prices output at
  exactly 5× input ($1/$5, $3/$15, $5/$25), so base units are a clean cost-normalising measure.
- **Premium tiers charge MORE credits for the same work** — the margin lever. Cheaper tiers
  charge fewer. Chat is always billed at the Essential rate.
- Client-facing, a scored candidate ≈ 7 base units → **≈3 / ≈7 / ≈18 credits** by tier.

## 2. Model tiers — credit rates + internal cost basis

| Tier | Model | Model ID | $ in/out per 1M | **Credit rate** (credits/1k units) | Internal raw cost / 1k units |
|---|---|---|---|---|---|
| **Essential** | Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | **0.4** | R0.019 |
| **Professional** *(default)* | Sonnet 4.6 | `claude-sonnet-4-6` | $3 / $15 | **1.0** | R0.056 |
| **Executive** | Opus 4.8 | `claude-opus-4-8` | $5 / $25 | **2.5** | R0.093 |

- Raw cost/1k units = `input_price_per_1M ÷ 1000 × R18.50` (output is exactly 5× input, so the
  ×5 weight makes this exact). This is the **internal cost basis** for margin only — never shown to clients.
- A `_default` rate (= Professional, 1.0) catches unknown/local/openrouter model strings.
- ⚠️ **Migration required:** code still defaults to `claude-sonnet-4-20250514` (`src/lib/ai/config.ts`,
  seed), which **retires 2026-06-15**. Map Professional → `claude-sonnet-4-6`.

## 3. Per-operation credits (from telemetry)

| Operation | base units | Essential | Professional | Executive |
|---|---|---|---|---|
| Scored candidate / re-score / job-spec (≈3,600 in + ≈680 out) | ~7 | ≈3 | ≈7 | ≈18 |
| Chat message (classify + reply + withdrawal, ≈7.3 units) | ~7.3 | **≈3 (always Essential)** | — | — |

Chat is hard-pinned to Essential, so a chat-interviewed candidate (~4 messages) ≈ 12 credits + a
re-score at the campaign's tier.

## 4. What a candidate costs (credits × R1.20)

| | Essential | Professional | Executive |
|---|---|---|---|
| Credits / scored candidate | ≈3 | ≈7 | ≈18 |
| Sell (× R1.20) | R3.60 | **R8.40** | R21.60 |
| Internal raw cost | R0.13 | R0.39 | R0.65 |
| Markup | ~28× | ~21× | ~33× |

Premium intelligence carries a **higher markup** — the "Executive is genuinely worth it" lever.
For comparison, a human first-pass CV screen costs a SA agency R30–100+; R8.40 to AI-screen at
Professional is a strong, defensible story.

## 5. Plans — base fee + included allowance (credits) + overage

Base fees per the owner's directive (Standard +400% = ×5, Premium +300% = ×4, Enterprise +200% = ×3).

| Plan (`organizations.tier`) | Base / mo | Included credits | ≈ Prof. candidates | Overage rate |
|---|---|---|---|---|
| **Standard** | **R7,500** | 6,000 | ~850 | R1.20 / credit |
| **Premium** | **R18,000** | 18,000 | ~2,570 | R1.08 / credit (−10%) |
| **Enterprise** | **R36,000** | 45,000 | ~6,400 | R0.90 / credit (−25%) |

`Period bill = base_fee + max(0, total_credits − allowance) × overage_rate + 15% VAT`

- The allowance is **one credit bucket**; premium-tier campaigns draw it down faster (more credits
  per candidate), which is the spend-control story behind the per-campaign tier lock.
- "≈ candidates" assumes Professional; an Essential-heavy month covers ~2.3× more candidates, an
  Executive-heavy month ~2.5× fewer.

## 6. Worked examples — Premium org (R18,000 base · 18,000 credits · R1.08 overage), Professional tier

*Assumptions: Sonnet $3/$15, R18.50/USD; scored candidate ≈7 base units; chat message ≈3 credits (Essential).*

**(a) Small month** — 200 scored + 30 chat-interviewed (~4 msgs) + re-scored:
- Credits = 200×7 (scoring) + 30×7 (re-score) + 30×12 (chat) = **1,970** → inside the 18,000 bundle.
- **Client pays R18,000 base** (+VAT R2,700 = **R20,700**). Raw cost ≈ **R107**. **Margin ≈ R17,893 (~99%)** — the float case.

**(b) Viral month** — 5,000 scored + 1,000 chat-interviewed + re-scored:
- Credits = 5,000×7 + 1,000×7 + 1,000×12 = **54,000**. Overage = 54,000 − 18,000 = 36,000 × R1.08 = **R38,880**.
- Ex-VAT = R18,000 + R38,880 = **R56,880** (+VAT = **R65,412**). Raw cost ≈ **R2,903**. **Margin ≈ R53,977 (~95%)**.
- Revenue scales with volume — the viral month is by far the most profitable in absolute terms. A hard
  ceiling (e.g. 50,000 credits) caps both the client's worst-case bill and the owner's cost tail.

## 7. Sensitivity & risk

- **Markup is the headline lever.** Pricing in *candidates* (not tokens) and the per-screen comparison in §4
  blunt the "you're marking up tokens 20×" objection.
- **FX:** raw cost moves with R/USD; refresh the cost basis (or the R1.20 credit price) on a schedule.
  A 10% rand weakening lifts raw cost ~10% — negligible against 20×+ margin.
- **Token drift:** if prompts grow, base units per candidate rise — but so do billed credits, so the
  model self-corrects.
- **Allowance sizing** is the main revenue lever: too generous erodes the float margin. Recalibrate off
  the first 1–2 months of real org telemetry.
