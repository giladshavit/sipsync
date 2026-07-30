# Russian Roulette tutorial: two-hand player swap

## Problem

`RouletteTutorial.tsx` (the animated "how to play" preview for the Russian
Roulette mini-game) is meant to depict two different players — Tomer and
Maya — each tapping one card during the scripted demo. Today it's a single
`<Image>` hand (`tap-gesture.png`) whose Reanimated `fingerX`/`fingerY`
shared values just slide it from card A's position to card B's position
(`withTiming`, 450ms). Visually this reads as *one* hand/person tapping both
cards, undermining the "two different players" story the tutorial is trying
to teach.

## Scope

Single file: `frontend/components/tutorials/RouletteTutorial.tsx`. No other
tutorial, engine file, or backend code changes. This is a self-contained
tweak to one mini-game's tutorial animation, not a new mini-game, so the
Mini-Game Isolation constraint (never edit `fsm.py`/`deck.py`/`base.py`/
`ws.py`) doesn't even come into play here — noted only for completeness.

## Design

Replace the single sliding hand with an exit/entrance sequence: hand 1
physically leaves the frame, hand 2 physically arrives, using the phone
mockup's existing `overflow: hidden` outer frame (the
`className="items-center overflow-hidden"` wrapper around the whole
phone-in-phone mockup) to clip the hand as it moves past the visible area —
no manual masking needed, just translateY distance.

### Timeline (replacing the current slide at `TURN2_MS`)

1. **Tap 1** (unchanged): at `TAP1_MS`, `pressFinger()` fires and card A
   flips. Hand 1 is at `FINGER_A`, untinted (natural asset color).
2. **Exit — hand 1 leaves down and off-screen**: starting at `TURN2_MS`
   (same beat that currently kicks off the slide), animate:
   - `fingerY` (or a new offset added to it) downward by enough distance to
     clear the phone frame's visible area — roughly 160–200px, whatever
     value visually clears the frame in testing, since the frame is a fixed
     288×450 mockup.
   - `fingerOpacity` → 0, over the same duration (~300–350ms).
   Both run together so the hand appears to slide down and out of frame
   while fading, then gets clipped by the outer frame's `overflow: hidden`.
3. **Swap (while invisible)**: once hand 1's exit animation completes and
   opacity is 0, snap (no animation — it's invisible, so a jump is
   unnoticeable) `fingerX` to `FINGER_B.x` and `fingerY` to a start point
   below the frame (`FINGER_B.y` + the same ~160–200px offset used for the
   exit). At the same instant, flip a piece of state so the `<Image>`
   picks up `tintColor: colors.tapped` (`#2563EB`) — the same neutral blue
   already used elsewhere in this codebase to mark "the other player" (see
   `BlackBoxTutorial.tsx`'s `PLAYER_A_TINT = colors.tapped`). Hand 1 always
   stays untinted/natural; hand 2 is always tinted `colors.tapped`.
4. **Entrance — hand 2 arrives from below**: animate `fingerY` upward from
   that below-frame start point to `FINGER_B.y`, and `fingerOpacity` → 1,
   together (~300–350ms) — reads as a different hand reaching up into frame
   and landing on card B.
5. **Tap 2** (unchanged): at `TAP2_MS`, `pressFinger()` fires, card B
   flips, phone-shake plays.

### Implementation notes

- The existing `fingerX`/`fingerY`/`fingerScale`/`fingerOpacity` shared
  values stay; no need for a separate "lift" shared value now that the exit
  uses real Y-axis travel instead of a small in-place offset. The
  withTiming animation that currently drives the A→B slide is replaced by
  two withTiming calls (exit-down+fade-out, then — after a snap — 
  entrance-up+fade-in), sequenced via the existing `setTimeout` timeline
  pattern already used throughout this component (not `withSequence`,
  since the snap in between must be a non-animated jump).
- Hand tint: use React `useState` (e.g. `handTurn: 'A' | 'B'`) rather than
  an animated/interpolated color — the swap happens during the invisible
  gap, so it can be a discrete state flip, consistent with how `stage`
  (`Stage` state) already drives discrete UI changes in this same
  component.
- `startCycle()`'s existing reset block (which already resets `rotationA`,
  `rotationB`, `fingerX`, `fingerY`, `fingerScale`, `fingerOpacity`,
  `shake`) must also reset the new `handTurn` state back to `'A'` so the
  loop replays correctly.
- Total timeline budget: the cycle currently finishes around
  `POISON_CAPTION_MS + 700` = 4100ms, inside the file's documented 5s
  loop window. The old 450ms slide is being replaced by two ~300–350ms
  animations plus an instantaneous snap — comparable total duration, should
  still fit; exact ms constants can be tuned during implementation as long
  as the 5s budget holds and there's a believable hold before `TAP2_MS`.

## Testing

No automated test coverage is expected or needed for this — it's a purely
visual Reanimated choreography change in a tutorial preview component, no
game logic. Verification is visual: run the app, open the Russian Roulette
tutorial (`frontend/app/games/[id]/tutorial.tsx` with id `roulette`, or the
in-room pre-round tutorial), and confirm:

- Hand 1 (natural color) taps card A, then visibly slides down and off the
  bottom of the phone mockup while fading, fully disappearing.
- Hand 2 (blue-tinted) then visibly slides up from below the frame into
  card B's position while fading in, then taps it.
- The loop replays correctly (hand 1's natural color returns on the next
  cycle, not stuck on hand 2's blue tint).
