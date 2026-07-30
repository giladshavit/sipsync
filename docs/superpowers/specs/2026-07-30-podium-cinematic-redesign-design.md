# Podium Cinematic Redesign — Design

## Summary

Declutter `frontend/app/room/[code]/podium.tsx` (Issue #57) so it reads as a premium, cinematic results moment instead of a data dashboard. The animated podium visualization (`PodiumColumn`, `AnimatedScore`, tier math) is a hard constraint and stays byte-for-byte identical. Everything around it — header, inline list, popups, admin row — is restructured.

## Scope

- Header: centered "PODIUM" title in a true 3-column symmetric layout.
- Move the "Up Next" preview out of the icon-button column into its own full-width strip.
- Delete the inline ranked-list `ScrollView`; the podium becomes a `flex-1` centered stage.
- Replace `ChasersPopup` with a unified `StatsModal` (SCOREBOARD / DRINKS top tabs).
- Redesign the admin action row (Edit Games / End Night / Next Round).
- Out of scope: any change to `PodiumColumn`/`AnimatedScore`/tier logic, any backend change, any change to `SharePopup` or `NextGameRulesModal` beyond what their surrounding layout requires, any new REST endpoint.

## Header

Replace the current left-aligned two-line "Leaderboard" title + right-aligned icon/Up-Next column with a single `Animated.View` row using **three equal `flex: 1` columns** so the center title is geometrically centered regardless of how many buttons sit in the side columns (left has 1 button, right has 2):

- **Left column** (`alignItems: 'flex-start'`): Leave Room icon button — unchanged 40×40 `DoorOpen`/`STOP` styling, unchanged `confirmingLeave` flow.
- **Center column** (`alignItems: 'center'`): a small muted "ROUND RESULTS" eyebrow (`typography.label`, `MUTED`, tight tracking) above `"PODIUM"` (`typography.title`, `color: AMBER`, ~22px) — mirrors the existing eyebrow-over-title pattern already used in `NextGameRulesModal` ("Up next") and `SharePopup` ("Invite friends").
- **Right column** (`alignItems: 'flex-end'`, `flexDirection: 'row'`, `gap: 8`): Share icon button (unchanged `Share2`/`showSharePopup` wiring) + a new Stats icon button (`ListOrdered` icon) that opens `StatsModal`. Unlike today's conditional Chasers button, **Stats always renders** — the Scoreboard tab always has content, so there's no empty state to hide it for.

Drop `ICON_BTN`/`iconRowWidth`/`headerIconCount`/`showChasersBtn` — they existed only to keep the old stacked Up-Next card the same pixel width as the icon row above it; the new full-width strip has no such coupling.

## Up Next strip

A new full-width row directly under the header, `marginTop: 12`, horizontally centered, fixed height (reuse `UP_NEXT_CARD_HEIGHT`). Same tap-to-open-`NextGameRulesModal` behavior and same admin-only Skip pill (`UP_NEXT_SKIP_HEIGHT`) as today, just laid out full-width instead of squeezed into a narrow right-aligned column. The "reserve the box before `nextGameId` arrives" placeholder behavior is preserved to avoid layout jump.

## Body — podium takes center stage

Replace the outer `ScrollView` with a plain `View style={{ flex: 1 }}`:

```
Header row
Up Next strip
flex-1 View (justifyContent: 'center', alignItems: 'center')
  → existing podium row (untouched PodiumColumn usage)
  → existing baseline rule
  → phase caption ("Before this round" / "After this round"), now centered under the podium instead of right-aligned above a list
Admin action block (bottom)
```

The ranked-list `.map()` block (rank chip, avatar, name, delta pill, `AnimatedScore`) is deleted from the screen body — that JSX moves into `StatsModal`'s SCOREBOARD tab (see below), reusing the same row markup and `LinearTransition`/`FadeInDown` treatment. The `ranked` derivation (`useMemo`-free `const ranked = (() => {...})()`) stays as-is; it's still needed to feed the modal.

## StatsModal (replaces ChasersPopup)

Rename `ChasersPopup` → `StatsModal`. Same overlay/card chrome (`rgba(10,10,15,0.94)` scrim, `CARD` card, 2px `INK` border, entrance scale/opacity spring) as every other popup in this file.

- **Top-level tab bar** (new): two-segment `SCOREBOARD` / `DRINKS`, same visual language as the existing round/total segment bar (filled `INK` for active, transparent for inactive, `typography.label`).
- **`SCOREBOARD` tab**: the ranked list moved from the main screen — rank chip, `AvatarCircle`, name (+" (you)"), delta pill (`phase === 'after'` gate preserved), `AnimatedScore`. Takes `ranked` as a prop from the parent.
- **`DRINKS` tab**: exactly today's `ChasersPopup` body — the existing round/total sub-tab bar, `rows`/`totalRows` props, empty-state copy, top-total `Skull` accent — unchanged internals, just nested one level deeper under the new top-level tab.
- Card content wrapped in a `ScrollView` with a `maxHeight` (e.g. 70% of screen) since either tab's list can now run long.
- **No auto-open.** Delete the module-scope `lastChasersPopupKey`, the `showChasers` auto-open `useEffect`, and `CHASERS_POPUP_DELAY_MS`. `StatsModal` only opens via the header Stats button (`onPress={() => setShowStats(true)}`), defaulting to the `SCOREBOARD` tab (`useState<'scoreboard' | 'drinks'>('scoreboard')`, reset on each open).
- Rename the local `showChasers` state to `showStats` throughout; rename `ChasersTab` type usage to a nested `DrinksTab` type so it doesn't collide with the new top-level tab type.

## Admin action block

Replace the single icon-flanked row with two stacked rows:

1. **Secondary row** (`flexDirection: 'row'`, `gap: 10`): Edit Games and End Night as two equal-width (`flex: 1`) outlined buttons, each icon (`Pencil` / `LogOut`) + uppercase label (`typography.label`, small), `borderWidth: 2`, `borderColor: INK` (not the current dim `HAIRLINE`/`MUTED` treatment — that's exactly the "looks disabled" look being fixed). Same `onPress` wiring as today (`setGamesSheetMode('edit')`, `setConfirmingEndNight(true)`).
2. **Primary CTA** (`marginTop: 10`): full-width `Next Round` button, taller than today (e.g. 64px vs `ADMIN_ROW_ICON_BTN`'s 56px), `backgroundColor: AMBER`, bold uppercase text, plus a soft glow (`shadowColor: AMBER`, `shadowOpacity: ~0.4`, `shadowRadius: ~14`, `shadowOffset: { width: 0, height: 4 }`, `elevation: 8`). Same `handleNextRound` wiring.

Non-admin "Waiting for host…" fallback is unchanged.

## Data / cleanup

- Remove: `ICON_BTN`, `iconRowWidth`, `headerIconCount`, `showChasersBtn`, `lastChasersPopupKey`, `CHASERS_POPUP_DELAY_MS`, the auto-open `useEffect`.
- Rename: `ChasersPopup` → `StatsModal`, `showChasers`/`setShowChasers` → `showStats`/`setShowStats`, `ChasersTab` → `DrinksTab`.
- Unchanged: `useRoomSocket` hook usage, `outcomes`/`ranked`/`podium`/`podiumOrder`/`chasersRows`/`totalChaserRows` derivations, `PodiumColumn`, `AnimatedScore`, `SharePopup`, `NextGameRulesModal`, `GamesSheet` wiring, `PromotionToast`, both confirmation overlays (Leave / End Night).

## Testing

No automated test suite covers this screen (manually-verified RN/Expo UI throughout the codebase, per the existing total-drinks-leaderboard spec). Verification: run the app through a full round → podium transition and confirm:

- Header renders symmetrically (PODIUM stays centered) with 1 button left / 2 right, and again once the Up Next card's admin Skip pill is showing.
- Podium animation (bar fill, avatar pop, before→after score roll) is pixel-identical to before.
- Tapping Stats opens the modal on SCOREBOARD by default; switching to DRINKS preserves its existing round/total sub-tab behavior and empty states.
- StatsModal never auto-opens on arrival, even when someone owes chasers.
- Edit Games / End Night / Next Round all fire their existing actions; Next Round's glow renders correctly on both iOS and Android (`elevation` fallback).
- Non-admin players still see "Waiting for host…" and no admin controls.
