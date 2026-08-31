---
name: game-post
description: Use when Gilad asks for an Instagram/social post or carousel for a SipSync/Quickle mini-game (new game post, "פוסט ל...", another game for the feed). Covers deriving the slides from the catalog, collecting captures, rendering, review, and the PR.
---

# Game Post

Produce one Instagram carousel for one mini-game with
`frontend/scripts/ig-game-posts.mjs` (HTML rendered by Playwright), in the
established Quickle style, then ship it through the per-issue PR flow.

**The generator, existing specs, and three shipped examples (roulette,
twenty-one, closest-average) are the style reference — read the GAMES map in
the script first and copy its patterns.**

## Workflow

1. **Plan from the catalog.** Read the game's entry in
   `frontend/constants/games.ts` (title, tagline, Icon, accentColor, rules,
   drinkingRules). Slides are fixed: accent cover → 3 rule steps over real
   captures → "Who drinks" chips → duck close. Compress the rules into 3
   short captions in simple English; color 1-2 keywords with the script's
   `red()`/`green()`/`yellow()` helpers. Captions compress the `rules` array
   only — a `rulesNote` is context, not a caption; drop it unless it fits a
   caption naturally. Game hashtag: `#` + slug without dashes. No em-dashes
   anywhere - not in captions, not in caption.md (they read as
   machine-written, and a dash starting a wrapped line looks broken);
   use a period or colon instead. The Icon name
   in kebab-case is the lucide file (e.g. `CircleSlash` → `circle-slash`).
2. **Request captures and STOP.** Print a table: filename
   (`01-…png`, `02-…png`, `03-…png`) → exact game state wanted, and ask Gilad
   to drop the files into `docs/marketing/shots/<slug>/` (create it).
   Ask only for states a screenshot can hold still — for a mid-motion
   mechanic, request the nearest static state (before/after the gesture).
   **Images pasted into the chat are not files** — you can look at them for
   planning, but never render until a size check
   (`Image.open(...).size` via `uv run --with pillow`) shows real files in
   the folder. Placeholder renders read as broken work; don't show them.
3. **Measure, then spec.** From the actual files, with Pillow: sample the
   edge background color per capture, and locate any bot names / back
   buttons / status remnants. Add one entry to `GAMES` in the script.
   Windows must not cut meaningful UI at the bottom; center a popup with its
   context. Replace every `(Bot)` name via cover+text overlays with fresh
   human names — vary across games (used: Sam, Ava, Kai, David, Rob).
4. **Render and self-check before showing.** `cd frontend && node
   scripts/ig-game-posts.mjs <slug>`. Build a 6-up contact sheet AND zoom
   crops of every overlay and every letterboxed edge; look at them yourself.
   Fix seams, remnants, and off-center popups first — Gilad will catch them.
5. **Iterate to explicit approval.** Show the sheet; apply his notes; only
   his "מאושר/נראה טוב" closes the loop.
6. **Ship.** New branch off main (never commit on main — check
   `git branch --show-current`), `gh issue create`, explicit `git add` of
   the three paths (instagram set, shots, script) — never `-A` — commit
   `Closes #N`, PR, squash-merge after CI passes.

## Gotchas

| Trap | Reality |
|---|---|
| Rendering with copied/placeholder shots "meanwhile" | Broken-looking output; wait for real files |
| Flat-color or blurred letterbox fill | Visible seams; the script's edge-stretch bars handle it — verify with zooms anyway |
| Covers/patches near popup borders | Check a zoom; borders bleed a few px past measured bounds |
| Skipping the caption | `caption.md` is generated per game — it's part of the deliverable |
| Alcohol wording | Use only the app's own words (chaser, drink); add nothing beyond them |
