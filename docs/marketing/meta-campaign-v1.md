# Quickle — Meta campaign v1 (international, web-first)

First paid test. Goal: learn which message makes a stranger abroad open
quicklegame.com and create a room, at a cost per *room* (not per click) that
makes sense given every room pulls in 4–8 more players.

Status: plan. Prerequisites (§1) are code and are not done yet.

---

## 1. Prerequisites — do these before spending

| # | What | Why | Owner |
|---|---|---|---|
| 1 | **Meta Pixel** on the web build — loads only when `EXPO_PUBLIC_META_PIXEL_ID` is set in Vercel (code merged; waiting on the id) | Without it Meta optimises for clicks, not players; the whole test is blind | code ✓ / Gilad |
| 2 | Custom events `room_created` and `room_joined` (via code / via link) — `lib/metaPixel.ts` | `room_created` is the conversion we buy. `room_joined` proves the multiplier | code ✓ |
| 3 | **Ad landing page** (`/play` or `/party`) — not the app home | Cold traffic needs "what is this" in 3 s: one line, 3 screenshots, a *Start a room* CTA. Home screen assumes you already know | code |
| 4 | UTM passthrough: `?utm_source=meta&utm_campaign=…` survives into room creation | Attribution outside Meta's own (inflated) numbers | code |
| 5 | Meta Business Manager + ad account, domain `quicklegame.com` verified, page for Quickle | Domain verification is required for web conversion events | Gilad |
| 6 | Age-gate copy on the landing page ("18+ · drink responsibly · plays the same with water") | Matches store rating; helps ad review | code |

---

## 2. Positioning for ads

**Lead with:** party game · one phone each · nothing to set up · no download ·
15 mini-games. **Support with:** "any drink" (true, and the honest way to say
what it is without tripping alcohol policy in the headline).

Never claim: "drinking game" in the headline, alcohol brands, drinking as a
reward. The app itself is honest about chasers; the *ad* just doesn't lead
with the bottle.

Identity keywords for the Andromeda "one-keyword" variants: *flat party*,
*pregame*, *house party*, *uni*, *game night*, *Friday*, *hostel*, *bar table*.

---

## 3. Structure

```
META_Traffic→Conv_Intl_WebRoom_2026-09   (CBO, $15/day)
├── AdSet A  "Tier A 18+"   UK · IE · AU · NZ · CA      age 18–29, all genders, broad, Advantage+ placements
├── AdSet B  "US 21+"       US                          age 21–29, all genders, broad
└── (later)  "EU English"   DE · NL · SE · DK · NO      age 18–29 — English creative works, CPMs low
```

- **Objective:** *Traffic (landing page views)* for the first ~10 days, then
  switch to *Sales/Conversions* on `room_created` once it fires ~50×/week.
  (Meta can't optimise a conversion it hasn't seen.)
- **Targeting:** country + age only. No interests. Creative is the targeting.
- **Exclusions:** existing players (custom audience from `room_joined`), and
  countries where alcohol advertising is prohibited (Meta enforces some;
  we just don't target them).
- **Placements:** Advantage+ but watch the breakdown — expect Reels + Stories
  to carry it; cut Audience Network if it eats spend.
- **Schedule:** always-on for the test. If a lifetime-budget rerun later,
  weight Thu–Sat 15:00–23:00 local (party-planning window).

### Budget & duration

- $15/day × 14 days ≈ **$210** for the first read. Below that Meta barely
  exits learning; above that we're guessing with more money.
- Don't touch budgets for the first 7 days. Increases ≤20% per 3–5 days after.

### Kill / keep rules (per ad, checked every 3 days)

| Signal | Action |
|---|---|
| Spent $15 and CTR (link) < 0.8% | off |
| CTR ≥ 1.5% but landing→`room_created` < 10% | landing page problem, not the ad — fix page, keep ad |
| Cost per `room_created` < $3 | winner — duplicate with 3 identity-keyword variants, add to a "zombie" ad set anything Meta starved |
| Frequency > 3 in 7 days | refresh creative (statics are cheap — ship 3 new ones) |

### Targets (first test, sanity not promises)

| Metric | Tier A | US |
|---|---|---|
| CPM | $6–12 | $12–20 |
| Link CTR | ≥ 1.2% | ≥ 1.0% |
| CPC | ≤ $0.40 | ≤ $0.70 |
| Landing → `room_created` | ≥ 15% | ≥ 15% |
| **Cost per room** | ≤ $2.70 | ≤ $4.70 |
| Cost per *player* (÷ ~5 joins) | ≈ $0.55 | ≈ $0.95 |

The cost-per-player line is the number that matters — it's what a install
campaign will never beat because every room is a group.

---

## 4. Creative v1 — the carousel

Eight 4:5 cards from `uv run scripts/meta-carousel.py` (in
`docs/marketing/carousel/`): the brand card, then seven full-bleed windows
onto real screens. No captions on the images, nothing that hints at alcohol
— the screens speak for themselves and the game plays the same with water.
Whole screens (for a 9:16 placement later) are in `docs/marketing/screens/`.

### Primary text — three options (Meta rotates them; long copy gives it context)

**A — how it works**
> Everyone's phone is the game. One friend opens a room, the rest join with a
> 6-letter code, and you're playing in ten seconds — no download, no account,
> nothing to set up. 15 fast mini-games: some are pure speed, some are luck,
> some are strategy with a little game theory mixed in. You pick tonight's
> lineup. quicklegame.com

**B — the games**
> A coin flip where the flipper is allowed to lie. An auction. A counter
> nobody wants to be the one to push to 21. A round where you help your
> partner or betray them — in secret. 15 mini-games for a night with
> friends, everyone on their own phone. quicklegame.com — free, no download.

**C — short**
> 15 fast, fun mini-games for a night with friends. One phone each. Nothing
> to set up. Play free at quicklegame.com

### Per-card headline · description (≤ 40 / ≤ 30 characters)

| Card | Headline | Description |
|---|---|---|
| 1 brand | Fast & Fun mini-games | Free · no download |
| 2 games | 15 mini-games, one phone each | You pick tonight's lineup |
| 3 room | Open a room. Friends join with a code. | Playing in ten seconds |
| 4 auction | Auction — bid to run the table | Strategy |
| 5 twenty-one | 21 — don't be the one who hits it | Strategy |
| 6 roulette | Russian Roulette — dodge the poison | Luck |
| 7 sacrifice | The Sacrifice — who's in? | Nerve |
| 8 bomb | Flying Bomb — swipe it away in time | Speed |

### The rest of the ad

- **CTA button:** Play Game
- **Website URL (every card, identical):**
  `https://www.quicklegame.com/?utm_source=meta&utm_medium=paid&utm_campaign=intl_web_v1&utm_content=carousel_v1`
- **Display link:** quicklegame.com
- **Identity:** the Quickle Page + the Quickle Instagram account — never a personal profile
- **"Optimize card order":** off — the brand card stays first
- **"Add a card at the end with your Page profile picture":** off

### Later statics — angles worth a card each once the carousel has a read

1. *Nothing to set up* — one phone, the lobby code, "no cards, no board, no deck to buy"
2. *10 seconds* — type code → pick games → GO, with a stopwatch
3. *Prisoner's Dilemma* — "help your partner or betray them — in secret" (best as a Reel)
4. *Plays the same with water* — the honest hedge, if the alcohol angle ever needs answering

## 5. Week-by-week

| Week | Do |
|---|---|
| 0 | Prereqs §1. Business Manager, pixel verified firing on a real room creation. |
| 1 | Launch AdSet A only, 6 statics. Don't touch. Read CTR on day 4. |
| 2 | Kill by rules. Add AdSet B (US). Add 2 Reels (C3, C5). |
| 3 | Switch objective to `room_created` if ≥50 events. Identity-keyword variants of the winner. |
| 4 | Retarget landing visitors who didn't create a room — with a *different* angle than the one they saw. Mirror the winning headline on the landing page. |

When the iOS build is approved: add an *App Install* campaign only after the
web one has a proven creative — reuse it, don't restart the test.

## 6. Ads Manager — field by field (the first campaign)

Business portfolio **Quickle** selected top-left before anything else.

**Campaign** (Ads Manager → Create)
- Buying type: Auction · Objective: **Traffic**
- Name: `META_Traffic_Intl_WebRoom_2026-09`
- Special ad categories: none (this is not an alcohol *product* ad; if review pushes back, see §3 kill rules and the C6 hedge)
- Advantage+ campaign budget: **on**, daily, **$12**
- Bid strategy: Highest volume

**Ad set A** — name `TierA_UK-AU_18-29`
- Conversion location: Website · Performance goal: Landing page views
- Pixel: Quickle Web
- Locations: United Kingdom, Australia (add Ireland, New Zealand, Canada in week 2)
- Age: 18–29 · Gender: all · Languages: English (all)
- Advantage+ audience: on, **no interests, no lookalikes**
- Placements: Advantage+ placements (check the breakdown on day 4; drop Audience Network if it eats spend)

**Ad set B** — name `US_21-29` — **create in week 2**, duplicate of A with United States, age 21–29.

**Ad** — name `Carousel_v1_screens`
- Identity: Page **Quickle** · Instagram **@quickle…**
- Format: **Carousel** · *Optimize card order:* **off** · *Add a card at the end with your profile picture:* **off**
- Cards 1–8: `docs/marketing/carousel/01..08.png`, headline + description per card from §4, **same URL on every card** (§4 UTM link)
- Primary text: option A (add B and C as extra text options - Meta rotates them)
- Call to action: **Play Game** · Display link: `quicklegame.com`
- Tracking: Website events → Pixel Quickle Web ✓, URL parameters already in the link

**Publish** → review usually clears within hours. Then **nothing for 7 days** except reading numbers on day 4.
