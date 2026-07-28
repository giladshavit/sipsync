---
name: minigame-scaffold
description: Scaffolds a complete new SipSync mini-game end-to-end — backend
  BaseMiniGame class, frontend live GameUI, the GAME_CATALOG rules entry
  (icon, accent color, how-to-play, who-drinks, scoring), and the animated
  tutorial preview, then hands the new tutorial to the tutorial-visual-refresh
  skill for its chrome/polish pass — from a rules list and design notes. Runs
  a spec-confirmation checkpoint before writing any code. Use when adding a
  brand new mini-game to SipSync, not for editing an existing one.
---

# Mini-Game Scaffold

You are scaffolding a new SipSync mini-game from a human-provided brief: a
game id/name, an ordered rules list, and free-form design notes (visual
vibe, pacing, what the tutorial animation should show). The brief will not
specify implementation details like WS payload shapes or timing constants —
that's expected. Your job is to turn the brief into the same shape as the
10 existing mini-games, not to reinterpret SipSync's architecture.

Read CLAUDE.md's "Mini-Game Isolation (Open-Closed)" section before
starting if you haven't already loaded it this session: new games extend,
core engine files never change.

## Before anything else — read the references

Do not start drafting from memory of this file. Open and actually read:

- `backend/app/engine/base.py` — the `BaseMiniGame` contract
- `backend/app/games/coin_flip.py` — a timed-vote pattern with a
  server-verified expiry (`EXPIRE` action checked against server clock)
- `backend/app/games/reflex.py` — the server-as-judge timing pattern
  (see CLAUDE.md's architectural decisions table — this is load-bearing,
  never trust a client-reported timestamp for who-won)
- `backend/app/engine/game_loader.py` — GAME_REGISTRY wiring
- `frontend/components/games/CoinFlipGameUI.tsx` — a live GameUI driven
  purely by `gameState`/`onAction`/`clockOffset` props
- `frontend/components/ActiveGameScreen.tsx` — frontend GAME_REGISTRY +
  `END_HOLD_MS` wiring
- `frontend/constants/games.ts` — the `GameMeta` shape, `RuleSegment`
  color convention, `rankedScoring()` helper, `pairwiseMatrix` variant
- `frontend/components/tutorials/CoinFlipTutorial.tsx` — two-mockup
  staged-animation tutorial pattern
- `frontend/components/tutorials/DilemmaTutorial.tsx` — the tutorial
  pattern for a `pairwiseMatrix` game, if the new game is one
- `frontend/constants/tutorials.ts` — `TUTORIAL_COMPONENTS` wiring
- one existing `backend/tests/test_*.py` for a game with a similar shape
  (timed-vote vs. reflex-timing vs. free-for-all)

If the brief's game shape doesn't clearly match any existing game (e.g. it
needs a state phase none of the 10 have), say so explicitly before drafting
the spec rather than forcing it into the nearest pattern.

## Phase 1 — draft the spec, do not write code yet

From the brief, produce and present a compact spec, then stop and wait for
the human to confirm or correct it:

- **State phases** — e.g. `PLAYING → DONE`, or with sub-phases if the brief
  implies distinct stages (reveal, vote, resolve)
- **WS actions** — action names and payload shapes the client sends
  (mirror the `action` dispatch style in `handle_ws_event`)
- **Timing constants** — every window in ms, and what happens at each
  deadline (server-verified via an `EXPIRE`-style action, plus a hard-stop
  `timeout_at` grace period, matching the coin_flip/reflex pattern)
- **Scoring & chasers** — the exact formula per outcome, expressed the same
  way `coin_flip.py`'s `_finish()` builds its `outcomes` dict
- **Edge cases** — disconnect mid-round, a player who never acts, ties —
  state the resolution for each; don't leave any unhandled
- **Tutorial story beats** — the sequence of visual events the animation
  plays, run-once-and-freeze on the final frame, in the same terms as the
  existing tutorials' opening comments (e.g. "two independent mockups,
  shown side by side" vs. one shared board)
- **Visual identity** — icon (a real `lucide-react-native` export name),
  accent color, category tag(s). Your judgment call from the design notes;
  state your picks so they can be redirected before you build.

## Phase 2 — generate, only after the spec is confirmed

Write, in this order:

1. `backend/app/games/<id>.py` — `BaseMiniGame` subclass implementing the
   confirmed spec. Module-level RNG if randomness is involved (so tests can
   substitute a deterministic one, per the `coin_flip.py` convention).
2. Register the class in `GAME_REGISTRY` in
   `backend/app/engine/game_loader.py`.
3. `backend/tests/test_<id>.py`, following the structure of the closest
   existing test file for this game's shape.
4. `frontend/components/games/<Id>GameUI.tsx` — live game UI, animations on
   `react-native-reanimated` worklets per CLAUDE.md, no JS-thread-blocking
   visual work.
5. Register in `GAME_REGISTRY` in `frontend/components/ActiveGameScreen.tsx`,
   plus an `END_HOLD_MS` entry if the round needs a post-finish animation
   hold before navigating to the summary.
6. Add the entry to `GAME_CATALOG` in `frontend/constants/games.ts`: title,
   tagline, icon, accentColor, categories, `rules` (use `RuleSegment` color
   spans only where the brief calls out a specific word), `drinkingRules`,
   `scoring` (reuse `rankedScoring()` for free-for-all ranked games,
   `pairwiseMatrix` only for 2-player payoff games), plus `rulesNote` /
   `whoDrinksNote` if a clarifying aside doesn't fit the numbered flow.
7. `frontend/components/tutorials/<Id>Tutorial.tsx` implementing the
   confirmed story beats, and register it in `TUTORIAL_COMPONENTS` in
   `frontend/constants/tutorials.ts` keyed `tutorial.<id>`. Draft only the
   choreography here — the mockup, its stages, its timing.
8. Invoke the `tutorial-visual-refresh` skill (via the Skill tool) on the
   game you just added. That skill owns the chrome/polish pass: authoring
   `tutorialCue` and any `drinkingRules[].shortLabel`s in `GAME_CATALOG`,
   verifying the mockup's colors mirror the real `<Id>GameUI` exactly,
   stripping any internal duplicate rules text or "who drinks" rows (the
   shared chrome already renders those), and confirming the tutorial runs
   once and holds rather than looping. Don't re-derive those conventions by
   hand in step 7 — they change independently of this skill and
   tutorial-visual-refresh is the single source of truth for them.

Typography in any new UI text must use `typography.title` /
`typography.label` from `frontend/constants/design.ts` — never a monospace
font (see CLAUDE.md). Icons only from `lucide-react-native`, never emoji.

## Never modify

`backend/app/engine/{fsm,deck,base,ws}.py`,
`frontend/app/games/[id]/index.tsx`, `frontend/app/games/[id]/tutorial.tsx`,
`frontend/app/room/[code]/practice-start.tsx` — all of these are already
fully generic and drive off the registries/catalog above. If a new game
seems to need one of them to change, that's a sign the spec (Phase 1) needs
rethinking, not that the constraint should be bent. The one sanctioned
exception is step 8's handoff: `tutorial-visual-refresh` may touch
`frontend/app/games/[id]/tutorial.tsx` and
`frontend/app/room/[code]/tutorial.tsx` as part of its own job — that's
delegated to that skill, not something step 1-7 should do directly.

## Verify before reporting done

Run the backend test suite (`uv run pytest`) scoped to the new test file at
minimum, and the frontend typecheck. Report which passed; don't claim the
game works end-to-end without running it — offer to use the `run` skill to
launch the app and play through the new game's practice-vs-computer mode if
the human wants that level of verification.
