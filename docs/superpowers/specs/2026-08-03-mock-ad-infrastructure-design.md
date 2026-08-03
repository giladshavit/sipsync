# Mock Ad Infrastructure (Web) — Design

## Purpose

Build monetization infrastructure for the Web build using mock ads, so we can test placement, timing, and UX before wiring in real Google AdSense scripts. Nothing here talks to a real ad network — it's flag-gated fake inventory.

## Feature Flags — `frontend/config/ads.ts`

```ts
export const ENABLE_ALL_ADS = true;
export const ENABLE_LOBBY_AD = true;
export const ENABLE_PODIUM_AD = true;

export function shouldShowAd(specificFlag: boolean): boolean {
  return ENABLE_ALL_ADS && specificFlag;
}
```

Plain hardcoded booleans, no remote config or persisted storage — this is dev-facing test infrastructure that gets flipped by editing the file, not a runtime toggle.

An ad only shows if `ENABLE_ALL_ADS` AND its own specific flag are both `true`.

## Platform Scope

Mock ads are Web-only. Gating checks `Platform.OS === 'web'` in addition to the flags — native iOS/Android builds never show a mock ad, even if the flags are left on.

## Gating Hooks — `frontend/hooks/useMockAd.ts`

Two hooks centralize all "should this actually show" logic so the screens themselves stay dumb (just a `visible`/`dismiss` pair):

- **`useLobbyAd(code: string | undefined)`**: a module-level `Set<string>` tracks room codes that have already shown the lobby ad this session. On mount, if `code` is defined, we're on web, `shouldShowAd(ENABLE_LOBBY_AD)` is true, and `code` isn't already in the set, it adds `code` to the set and sets `visible = true`. A later re-mount of `LobbyScreen` for the same `code` (e.g. bouncing back from the Games sheet, or the FSM resetting the room to `LOBBY` after End Night) does not re-trigger it, since the code is already recorded.
- **`usePodiumAd()`**: `visible` lazy-initializes to `Platform.OS === 'web' && shouldShowAd(ENABLE_PODIUM_AD)`. `PodiumScreen` genuinely remounts fresh on every round (via `router.replace`), so "fires on every mount" naturally means "fires after every round" — matching the literal ask ("trigger the Podium ad immediately when the Podium component mounts").

Both hooks return `{ visible: boolean, dismiss: () => void }`.

## Component — `frontend/components/MockAdOverlay.tsx`

A full-screen sibling overlay, following the same convention already used in this codebase (`lobby.tsx`'s `confirmingLeave` overlay, `podium.tsx`'s `StatsModal`/`SharePopup`) — an absolutely-positioned `View` rendered as the last child of the screen, not an RN `Modal`. This is inherently Web-compatible and needs no portal.

Props: `{ type: 'lobby' | 'podium'; onClose: () => void }`.

Styling, imported from `constants/design.ts` directly (not from the host screen's own palette, so it renders identically whether triggered from Lobby or Podium):
- `position: 'absolute'`, filling the screen, `zIndex` above all other content (`999`), `backgroundColor: colors.ink`.
- A small "AD" pill badge (amber background, `typography.label` text) in a top corner, signaling this is ad inventory.
- Centered content: "TEST AD PLACEMENT" in `typography.title` (large, tracked, uppercase), with a muted one-line sub-caption underneath.
- Interaction is blocked for everything underneath simply by this View covering the full screen and intercepting all touches (default `Pressable`/`View` behavior — no `pointerEvents="none"` anywhere on it).

Type-specific behavior:
- **`type="lobby"`**: internal countdown state `secondsLeft` starting at 5, ticking down every second via `setTimeout`. While `secondsLeft > 0`, a disabled-looking countdown readout is shown (e.g. "Skip in 3s") and no button is pressable. Once `secondsLeft` reaches 0, a "Skip Ad" button appears/enables and calls `onClose` when pressed.
- **`type="podium"`**: an X close button renders in the top-right corner immediately on mount and calls `onClose` when pressed — no delay.

## Wiring

- **`frontend/app/room/[code]/lobby.tsx`**: add `const { visible: lobbyAdVisible, dismiss: dismissLobbyAd } = useLobbyAd(code);` and render `{lobbyAdVisible && <MockAdOverlay type="lobby" onClose={dismissLobbyAd} />}` as the last element in the screen's root `View`, after the existing overlays (Games sheet, Avatar picker, Leave confirmation).
- **`frontend/app/room/[code]/podium.tsx`**: add `const { visible: podiumAdVisible, dismiss: dismissPodiumAd } = usePodiumAd();` and render `{podiumAdVisible && <MockAdOverlay type="podium" onClose={dismissPodiumAd} />}` alongside the screen's other overlays (`StatsModal`, `SharePopup`, etc.), all of which already use the same `zIndex: 50` absolute-overlay pattern — `MockAdOverlay`'s own `zIndex: 999` keeps it on top of those too, matching "sits on top of all other elements."

## Out of Scope

- No real AdSense/ad-network integration — that's explicitly deferred to a later pass.
- No analytics/impression tracking on the mock ads.
- No ad content variation (single static "TEST AD PLACEMENT" creative for both types).
- No native (iOS/Android) ad surface — Web only, per the Platform Scope section above.
