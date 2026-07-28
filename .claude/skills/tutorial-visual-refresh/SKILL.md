---
name: tutorial-visual-refresh
description: Redesigns the visual chrome of a SipSync mini-game's "how to
  play" tutorial — both the standalone preview (frontend/app/games/[id]/tutorial.tsx)
  and the in-room mandatory pre-round screen (frontend/app/room/[code]/tutorial.tsx),
  plus the matching frontend/components/tutorials/<Id>Tutorial.tsx — background,
  title, cue line, and who-drinks chips — without touching the animation
  choreography, timing, or number of staged screens. Use when asked to make
  a mini-game's tutorial look better, or to fix a mismatch between the
  simulated phone screen and the real game's colors.
---

# Tutorial Visual Refresh

You are restyling how a mini-game's tutorial preview *looks*, never how it
*behaves*. The tutorial exists to simulate a real round happening on a
phone screen. Two completely different rules apply to its two halves —
mixing them up is the main way this goes wrong.

## Hard constraint — never touch

The `Stage`/state values, the `useEffect`/`setTimeout` sequencing, any
animation duration or easing curve, the number of staged screens, or what
triggers each visual state in
`frontend/components/tutorials/<Id>Tutorial.tsx`. If the choreography looks
wrong, that's a separate conversation — this skill only ever changes
colors, typography, layout, icons, and copy sourcing.

## The two zones

**Inner zone — the simulated phone screen itself.** This must be a pixel-
accurate mirror of the real `frontend/components/games/<Id>GameUI.tsx` for
every visual state it depicts — same `colors.*` tokens, same state
transitions, nothing invented or approximated. Read the real GameUI file
before touching the tutorial's colors; don't infer them from what "looks
about right." A state the tutorial currently skips (e.g. a color change
that only happens after a tap) is a bug to fix, not a detail to leave out.

**Outer zone — the chrome around the phone mockup.** Two different screens
host it, and both are in scope:

- `frontend/app/games/[id]/tutorial.tsx` — the standalone preview reached
  from a game's rules screen. Has back + replay buttons.
- `frontend/app/room/[code]/tutorial.tsx` — the in-room mandatory pre-round
  screen. No back or replay buttons — it runs once for a fixed duration
  (`DEFAULT_DURATION_MS` / `DURATION_MS_OVERRIDES`) and then the round
  starts. Its countdown-bar animation, the `TUTORIAL_DONE` send-on-timeout,
  and the navigate-on-`PLAYING` effect are gameplay-adjacent logic, not
  chrome — never touch them. It only has `tutorialAsset` (a
  `tutorial.<game_id>` string) in its route params, not a game id directly;
  strip the `tutorial.` prefix to call `getGameById`.

The title, cue line, and who-drinks chips are shared UI, factored into
`frontend/components/tutorials/TutorialCue.tsx` (`CueText`, `DrinkChip`,
`DrinkRow`) and imported by both screens, so a wording/style change to one
applies to both automatically — don't fork the styling between them.
Background treatment, title, the cue line above the mockup, and the
who-drinks footer below it are all free to redesign. Since both host
screens already read off `getGameById`, a redesign here applies to every
game at once — that's the point, not a scope overrun.

Ground the redesign in SipSync's existing dark-mode vocabulary rather than
inventing an unrelated palette: `colors.ink`/`surface`/`rim`/`chalk` from
`frontend/constants/design.ts`, the blocky bordered-chip / numbered-badge
language already established in `frontend/app/games/[id]/index.tsx`
(`SectionLabel`, the numbered rules rows, the drinkingRules chips), and
`colors.amber` as the accent — adapted for a dark background instead of the
rules screen's light one. Load the `frontend-design` skill for the actual
design pass (palette/type/layout decisions), but treat "matches the app's
existing brutalist system" as the brief's own constraint, not something to
override with a generic template look.

Content rules for the outer zone — this screen is a quick-glance reminder,
not a second rules screen, so everything on it must be terser than its
source, not equal to it:
- **Title** — the game's real `title` from `GAME_CATALOG`, not reworded.
  Styled with `typography.title`, its own size, separate from the cue line
  below it.
- **Cue line** — exactly one short trigger→action sentence (e.g. "When it
  turns green — tap fast!"), sourced from `GameMeta.tutorialCue` (a
  `RuleLine`, so it keeps the same red/green word-coloring convention as
  the real rules — this is the reason it isn't just `tagline`, which is a
  plain string with no color segments). If a game doesn't have a
  `tutorialCue` yet, author one as part of that game's rollout — don't
  fall back to dumping the full `rules` array, and don't reuse `tagline`
  as a permanent substitute, only as an interim fallback. Give it its own
  distinct type treatment (larger, centered, different weight/tracking
  than both the title and the rules-screen body copy) and place it directly
  above the phone mockup, grouped with it in the same centered block — not
  up in the fixed header/title area.
- **Who-drinks footer** — one row of small chips, one per `drinkingRules`
  entry: a `GlassWater` icon (from `lucide-react-native`, never `Wine` or
  any other drink glyph) plus `rule.shortLabel ?? rule.description`, one to
  two words (e.g. "Tapped too early", "Didn't tap"), single line, no wrap.
  Author `shortLabel` on each `DrinkingRule` that needs it as part of that
  game's rollout — the full-sentence `description` written for the rules
  screen is too long for a small chip.

**No scroll.** The whole screen — header, title, cue + mockup, footer chips
— must fit in one viewport on an ordinary phone. Give the cue-line-plus-
mockup group a single `flex: 1` centering container between the fixed-size
header/title block and the fixed-size footer row so it absorbs whatever
space is left, instead of wrapping the screen in a ScrollView.

## Process

1. Read the real `<Id>GameUI.tsx`, the current `<Id>Tutorial.tsx`, and the
   game's `GameMeta` entry in `frontend/constants/games.ts` before writing
   anything.
2. Fix the inner zone first: make the simulated screen match the real
   GameUI's colors/states exactly.
3. Redesign the outer zone: put shared pieces (title block, `CueText`,
   `DrinkRow`) in `frontend/components/tutorials/TutorialCue.tsx` and wire
   them into both `frontend/app/games/[id]/tutorial.tsx` and
   `frontend/app/room/[code]/tutorial.tsx` (the latter without back/replay
   buttons, and without touching its countdown/networking logic) — this is
   shared across every game, so sanity-check it still reads fine for a
   couple of other games' data, not just the one being piloted.
4. Typecheck (`npx tsc`). Offer to use the `run` skill to actually view the
   result in the app — don't claim the visual match is correct without
   either that or the human confirming from a screenshot.

## Rollout

This skill is meant to be piloted on one game, reviewed, then left alone —
the outer zone is already global once step 3 lands, and the inner-zone fix
only needs repeating per game if that game's own tutorial has a similar
color/state mismatch. Check each remaining tutorial file for the same class
of bug (stale colors, `Wine` icon, redundant inline rules text now
duplicated by the outer zone) before assuming it's already fine.
