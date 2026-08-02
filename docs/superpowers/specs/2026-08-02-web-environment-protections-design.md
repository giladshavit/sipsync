# Web Environment Protections — Design

## Problem

SipSync's web build has no defenses against three mobile-browser behaviors that
disrupt an in-progress room:

1. A fast downward swipe on mobile Safari/Chrome triggers a native pull-to-refresh,
   reloading the page and dropping the player's WebSocket connection mid-round.
2. An accidental refresh, back-gesture, or tab close during a live room has no
   confirmation step — the player silently drops out.
3. Backgrounding the browser tab (switching apps, locking the phone) can cause
   mobile browsers to throttle or silently kill the WebSocket without ever firing
   `onclose`. `useRoomSocket`'s existing reconnect timer only fires after a full
   drop is detected, so a stale-but-not-yet-closed socket can sit dead until the
   next message would have arrived.

## Scope

Three independent, additive pieces. No backend changes, no new dependencies.
All web-only — gated by `Platform.OS === 'web'`, matching the existing pattern in
`frontend/contexts/AudioContext.tsx`.

## 1. Disable pull-to-refresh (global, web-only)

In `frontend/app/_layout.tsx`, a mount-only effect gated on `Platform.OS === 'web'`
injects a `<style>` element into `document.head`:

```css
html, body { overscroll-behavior-y: none; touch-action: pan-y; }
```

Runtime injection (not `frontend/global.css`) is deliberate: `global.css` goes
through the Tailwind/NativeWind PostCSS pipeline that also feeds the native build.
Raw `html`/`body` selectors aren't Tailwind-recognized and risk breaking native
bundling. A runtime-injected `<style>` tag only ever executes in a web `document`,
so it can't touch native at all.

## 2. `usePreventLeave` hook

New file: `frontend/hooks/usePreventLeave.ts`.

```ts
export function usePreventLeave(enabled: boolean): void
```

While `enabled && Platform.OS === 'web'`, attaches a `beforeunload` listener that
calls `preventDefault()` and sets `event.returnValue = ''` — the two calls browsers
require (varies by browser) to trigger the native "leave site?" confirmation.
Listener is removed whenever `enabled` flips to `false` or the hook unmounts.

**Wiring:** called once in `frontend/app/room/[code]/_layout.tsx`, not per-screen.
Uses `useSegments()` to compute:

```ts
enabled = segments[segments.length - 1] !== 'lobby'
```

This covers every current room screen (tutorial, waiting, game, custom-question,
podium, summary) and any future one added under `room/[code]/` automatically,
without each screen remembering to opt in. `lobby.tsx` is the one screen where
leaving is expected and safe (matches the user's framing: navigating back to Lobby
is the intentional "return" that lifts the warning).

## 3. Instant reconnect on tab wake

In `frontend/hooks/useRoomSocket.ts`, a new effect alongside the existing connect
effect: web-only, adds `document.addEventListener('visibilitychange', handler)`.

When `handler` fires with `document.visibilityState === 'visible'`, it checks
`wsRef.current?.readyState`. If the socket is missing or not `WebSocket.OPEN`
(i.e. `CONNECTING`, `CLOSING`, or `CLOSED`), it calls the hook's existing
`reconnect()` — already built to detach a stale socket's handlers and open a fresh
connection immediately, exactly the "quietly stale" case described in its own
docstring. No new reconnect logic; this is purely a faster trigger for it.

Listener is added once per hook mount (not per-connection/per-generation) and
removed on unmount, alongside the existing cleanup.

## Testing

No backend involved; this is browser-API-only behavior that can't be exercised by
the existing Python/pytest suite. Verification is manual, in `expo start --web`:
- Confirm swiping down fast on the page (via mobile emulation in devtools) no
  longer triggers a browser reload.
- Confirm navigating away or refreshing from a non-lobby room screen shows the
  browser's native confirm dialog; confirm no dialog appears from the lobby.
- Confirm `readyState` recovers promptly after simulating a background/foreground
  cycle (devtools "Page Visibility" override to `hidden` then `visible`) with the
  dev server's WebSocket briefly killed while backgrounded.
