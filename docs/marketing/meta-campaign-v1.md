# Quickle — Meta campaign v1 (international, web-first)

First paid test. Goal: learn which message makes a stranger abroad open
quicklegame.com and create a room, at a cost per *room* (not per click) that
makes sense given every room pulls in 4–8 more players.

Status: plan. Prerequisites (§1) are code and are not done yet.

---

## 1. Prerequisites — do these before spending

| # | What | Why | Owner |
|---|---|---|---|
| 1 | **Meta Pixel** on the web build + Conversions API later | Without it Meta optimises for clicks, not players; the whole test is blind | code |
| 2 | Custom events: `ViewContent` (landing), `room_created`, `room_joined`, `game_started` | `room_created` is the conversion we buy. `room_joined` proves the multiplier | code |
| 3 | **Ad landing page** (`/play` or `/party`) — not the app home | Cold traffic needs "what is this" in 3 s: one line, 3 screenshots, a *Start a room* CTA. Home screen assumes you already know | code |
| 4 | UTM passthrough: `?utm_source=meta&utm_campaign=…` survives into room creation | Attribution outside Meta's own (inflated) numbers | code |
| 5 | Meta Business Manager + ad account, domain `quicklegame.com` verified, page for Quickle | Domain verification is required for web conversion events | Gilad |
| 6 | Age-gate copy on the landing page ("18+ · drink responsibly · plays the same with water") | Matches store rating; helps ad review | code |

---

## 2. Positioning for ads

**Lead with:** party game · one phone each · nothing to set up · no download ·
16 mini-games. **Support with:** "any drink" (true, and the honest way to say
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

## 4. Creative — 6 concepts, statics first

Andromeda-era rule: volume of native-looking statics beats one polished
video. Ship all six as 4:5 feed + 9:16 story; two of them also as 10–15 s
screen-recorded Reels. Palette: cream `#FFF8E1`, amber `#F59E0B`, ink
`#0A0A0F`, duck mascot. Don't make it look like an ad.

### C1 — "Nothing to set up" (utility)
- **Visual:** one phone, lobby screen with the room code; caption-style text
  overlay: *"no cards. no board. no deck to buy."*
- **Headline:** Party game with nothing to set up
- **Primary:** Everyone's phone is the game. One person opens a room, the rest
  type a 6-letter code, and you're playing in ten seconds. 16 fast mini-games —
  reflexes, luck, a bit of game theory. Whoever loses drinks. Any drink counts.
  quicklegame.com — no download, no account.

### C2 — "10 seconds, no download" (friction)
- **Visual:** 3-panel static: *type code → pick games → GO*. Stopwatch "0:10".
- **Headline:** From "let's play something" to playing: 10 seconds
- **Primary:** No app store. No "wait, download it first". Open the link, join
  with a code, go. Works on any phone at the table.

### C3 — "The morning after" (chat reveal — humour)
- **Visual:** fake group-chat screenshot (iMessage/WhatsApp style, obviously
  staged, no real names):
  > **Sam:** who made me do 4 chasers
  > **Priya:** the app did. you lost prisoner's dilemma. twice.
  > **Sam:** I TRUSTED YOU
  > **Priya:** and I betrayed you. in secret. as instructed.
  > **Leo:** same time friday?
- **Headline:** Help your partner — or betray them. In secret.
- **Primary:** Quickle is 16 mini-games for a night with friends, on
  everyone's own phone. Some are speed, some are luck, some will end
  friendships. quicklegame.com

### C4 — "16 games" (variety grid)
- **Visual:** the coloured game-tile grid from the lobby (Green Light, Tap
  Race, Russian Roulette, Liar's Coin…) — 16 tiles, one word each.
- **Headline:** 16 mini-games. You pick tonight's lineup.
- **Primary:** Reflex rounds, bluffing rounds, a coin flip where the flipper
  can lie, an auction paid in chasers. Choose which ones you play tonight.

### C5 — "Prisoner's Dilemma" (game-theory drama, best for Reels)
- **Visual:** 12 s screen recording: two phones side by side, both choose in
  secret, reveal → one betrays. Overlay: *"she said she'd cooperate."*
- **Headline:** She said she'd cooperate.
- **Primary:** One round of Quickle. Both players choose in secret: help or
  betray. Then everyone sees. Play it with friends on any phone — quicklegame.com

### C6 — "Works with water" (pregame / honest hedge)
- **Visual:** glass of water next to a beer, both with the duck. Overlay:
  *"plays exactly the same with water"*.
- **Headline:** The pregame game. Any drink.
- **Primary:** Beer, wine, soda, water — Quickle doesn't care what's in the
  glass, only who lost. 16 mini-games, everyone on their own phone, nothing to
  install.

### Headline bank (for the 20–40-headline mirror test → winning one becomes the landing H1)

1. Party game with nothing to set up
2. Everyone's phone is the game
3. 16 mini-games. One phone each.
4. Playing in 10 seconds, no download
5. She said she'd cooperate.
6. Help your partner or betray them — in secret
7. The coin flipper is allowed to lie
8. Loser drinks. Any drink counts.
9. No cards, no board, no deck to buy
10. The pregame game
11. Type the code. That's the setup.
12. Bid chasers to run the table
13. Fast, light mini-games for a night out
14. Your flat party just got a game master
15. Game night without the box

---

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
