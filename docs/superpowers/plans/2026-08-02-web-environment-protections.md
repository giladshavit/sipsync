# Web Environment Protections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent mobile-web browser behaviors (pull-to-refresh, accidental tab close/refresh, backgrounded-tab socket death) from disrupting an in-progress SipSync room.

**Architecture:** Three independent, additive, web-only pieces, gated by `Platform.OS === 'web'`: (1) a runtime-injected `<style>` tag disabling overscroll/pull-to-refresh, (2) a reusable `usePreventLeave` hook wired once at the room-stack layout level via `useSegments()`, (3) a `visibilitychange` listener in `useRoomSocket` that triggers the hook's existing `reconnect()` immediately on tab foreground if the socket isn't open.

**Tech Stack:** Expo Router (`expo-router` `useSegments`), React Native Web, TypeScript strict mode. No new dependencies.

## Global Constraints

- All new/changed logic must be gated by `Platform.OS === 'web'` (`import { Platform } from 'react-native'`) — none of this may run or affect native iOS/Android builds. Matches the existing pattern in `frontend/contexts/AudioContext.tsx:137`.
- TypeScript strict mode is on. No `any`.
- No REST endpoints, no backend changes — this is frontend-only, browser-API behavior.
- Do not modify `frontend/global.css` for the pull-to-refresh CSS — use runtime `<style>` injection instead (see spec's rationale: avoids the NativeWind/PostCSS pipeline that also feeds the native build).
- No commented-out code. Keep functions small and single-purpose.
- There is no frontend automated test runner in this repo (no jest/testing-library configured) — verification per task is `npx tsc --noEmit` (from `frontend/`) plus manual browser verification via `npm run web`, as called out per task.

---

### Task 1: Disable pull-to-refresh (global, web-only)

**Files:**
- Modify: `frontend/app/_layout.tsx`

**Interfaces:**
- Produces: nothing consumed by later tasks — fully self-contained.

- [ ] **Step 1: Add the web-only CSS injection effect**

Edit `frontend/app/_layout.tsx`. Add `useEffect` and `Platform` imports, and inject a `<style>` tag on mount, web-only:

```tsx
import '../global.css';

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AudioProvider } from '@/contexts/AudioContext';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `html, body { overscroll-behavior-y: none; touch-action: pan-y; }`;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AudioProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0A0A0F' },
              animation: 'fade',
            }}
          />
        </AudioProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
```

`RootLayout` only ever mounts once for the app's lifetime, so the cleanup function is dead code in practice — but it's cheap and correct to include, and avoids a duplicate `<style>` tag if Fast Refresh ever remounts this component during development.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run: `cd frontend && npm run web`, open the printed localhost URL in a browser.
Open devtools → toggle device toolbar → select a mobile device profile. Confirm a fast downward swipe/scroll at the top of any screen does **not** trigger a page reload (no browser refresh spinner). Confirm normal vertical scrolling inside scrollable screens (e.g. the lobby player list) still works.
Inspect `document.head` in devtools Elements panel and confirm a `<style>` tag containing `overscroll-behavior-y: none` is present.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/_layout.tsx
git commit -m "feat: disable pull-to-refresh on web via injected overscroll CSS"
```

---

### Task 2: `usePreventLeave` hook, wired to all non-lobby room screens

**Files:**
- Create: `frontend/hooks/usePreventLeave.ts`
- Modify: `frontend/app/room/[code]/_layout.tsx`

**Interfaces:**
- Produces: `usePreventLeave(enabled: boolean): void` — exported from `frontend/hooks/usePreventLeave.ts`. No other task consumes it.

- [ ] **Step 1: Create the hook**

Create `frontend/hooks/usePreventLeave.ts`:

```ts
import { useEffect } from 'react';
import { Platform } from 'react-native';

// Warns before an accidental refresh/back/tab-close drops a player mid-room
// (web only — native has no equivalent browser-chrome exit path). Callers
// gate `enabled` on whichever screens should actually prompt; see
// room/[code]/_layout.tsx for the room-wide wiring.
export function usePreventLeave(enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Chrome requires returnValue to be set to show the native prompt.
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled]);
}
```

- [ ] **Step 2: Wire it into the room stack layout**

Read `frontend/app/room/[code]/_layout.tsx` first (current contents):

```tsx
import { Stack } from 'expo-router';

export default function RoomLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0f172a' },
        animation: 'fade',
      }}
    />
  );
}
```

Replace with:

```tsx
import { Stack, useSegments } from 'expo-router';
import { usePreventLeave } from '@/hooks/usePreventLeave';

export default function RoomLayout() {
  const segments = useSegments();
  // Every room/[code] screen warns before an accidental leave except the
  // lobby itself — that's the one screen where navigating away/refreshing
  // is an expected, safe action (see usePreventLeave design spec).
  const onLobby = segments[segments.length - 1] === 'lobby';
  usePreventLeave(!onLobby);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0f172a' },
        animation: 'fade',
      }}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run: `cd frontend && npm run web`.
Create/join a room, reach the lobby. Try refreshing the page (Cmd+R / F5): confirm **no** browser confirm dialog appears.
Advance into a game (start a round, or use practice mode to reach `game.tsx`). Try refreshing: confirm the browser's native "Leave site?" confirmation dialog **does** appear. Cancel it, confirm the room state is unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/usePreventLeave.ts frontend/app/room/\[code\]/_layout.tsx
git commit -m "feat: warn before accidental leave on non-lobby room screens"
```

---

### Task 3: Instant reconnect check on tab wake

**Files:**
- Modify: `frontend/hooks/useRoomSocket.ts:130-378` (the `useRoomSocket` function body, specifically adding a new effect near the existing connect effect and before the `send`/`reconnect`/`dismissPromotion` callbacks at line 380 onward)

**Interfaces:**
- Consumes: the hook's own `wsRef` (`useRef<WebSocket | null>`, already defined at line 132), `unmountedRef` (line 134), and `reconnect` (the `useCallback` defined at lines 384-409 — must reference the *stable* callback, not redeclare reconnect logic).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the visibilitychange effect**

Edit `frontend/hooks/useRoomSocket.ts`. Add a new `useEffect` after the `reconnect` callback definition (after line 409, before `dismissPromotion` at line 411) — placed after `reconnect` because it depends on that stable callback reference:

```ts
  // Mobile browsers throttle or silently kill WebSockets when a tab is
  // backgrounded, often without ever firing `onclose` — the socket looks
  // alive to this hook until the next message would have arrived. Checking
  // readyState the instant the tab becomes visible again catches that dead
  // state immediately instead of waiting on a message that will never come.
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    function handleVisibilityChange() {
      if (unmountedRef.current) return;
      if (document.visibilityState !== 'visible') return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnect();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reconnect]);
```

Add the `Platform` import at the top of the file alongside the existing imports:

```ts
import { Platform } from 'react-native';
```

(Full updated import line: `import { useEffect, useRef, useState, useCallback, MutableRefObject } from 'react';` stays as-is; add `Platform` as its own new import line since it comes from `react-native`, not `react`.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run: `cd frontend && npm run web`. Join a room so the socket connects (confirm the room UI shows connected/live state).
Open devtools → Application/More tools → "Rendering" or the command palette → find "Emulate a focused page" / Page Visibility override, or use `document.dispatchEvent` manually: in the console run `Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true}); document.dispatchEvent(new Event('visibilitychange'));` then kill the WS connection from the Network tab (right-click the `ws` connection → close), then flip back: `Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); document.dispatchEvent(new Event('visibilitychange'));`.
Confirm a new WebSocket connection opens immediately (visible in the Network tab) rather than waiting ~1.5s for the ordinary `onclose`-triggered reconnect timer, and confirm room state (players, current screen) is intact afterward.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useRoomSocket.ts
git commit -m "feat: reconnect instantly on tab visibility change if socket isn't open"
```

---

## Final Step: Open PR

- [ ] Push the branch and open a PR into `main` (squash-merge per `CLAUDE.md`'s PR flow), confirming with the user before pushing/merging per the standing rule on shared-state actions.

```bash
git push -u origin feat/web-environment-protections
gh pr create --title "feat: add web environment protections (pull-to-refresh, leave warning, wake reconnect)" --body "$(cat <<'EOF'
## Summary
- Disable mobile pull-to-refresh on web via injected overscroll CSS
- Warn before accidental refresh/close/back on any non-lobby room screen (usePreventLeave)
- Reconnect instantly on tab visibility change if the WebSocket isn't open, instead of waiting on the ordinary reconnect timer

## Test plan
- [ ] `npx tsc --noEmit` passes
- [ ] Manual: fast swipe-down on a mobile emulation profile does not reload the page
- [ ] Manual: refresh in lobby shows no dialog; refresh mid-game shows the native leave-confirmation dialog
- [ ] Manual: backgrounding then foregrounding the tab with a killed socket reconnects immediately

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
