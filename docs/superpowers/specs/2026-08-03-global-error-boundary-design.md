# Global Error Boundary — Design

## Problem

An uncaught render error anywhere in the app tree currently produces a blank
white screen with no recovery path — the "White Screen of Death" flagged in
the technical audit. There's no crash-reporting service in the repo (no
Sentry/Bugsnag), so the only debugging signal available today is whatever the
Metro/native crash log shows, and end users get nothing but a dead screen.

## Scope

Frontend-only, additive. No backend changes, no new dependencies (Expo
Router's `ErrorBoundary` export and `lucide-react-native` are both already in
the project). Core engine files are untouched — this isn't a mini-game.

## 1. `frontend/components/ErrorFallback.tsx`

New standalone component, styled to match the existing dark-screen convention
(`onboarding.tsx`): `colors.ink` background, `LinearGradient` + amber glow
accent.

Props: `{ error: Error; retry: () => void }`.

- `useEffect` on mount: `console.error(error)` — full stack goes to the
  console for debugging; never rendered in the UI.
- Centered `AlertTriangle` (lucide) icon in `colors.stop`.
- Heading "Oops! Something went wrong" in `typography.title`.
- Generic, calm subtext — no raw error message or stack shown to the user.
- CTA button matching onboarding's primary-button style (amber `Pressable`,
  `typography.title` label) with a `RefreshCw` icon, label "Try Again",
  `onPress={retry}`.

## 2. Wiring — `frontend/app/_layout.tsx`

Export `ErrorBoundary({ error, retry }: ErrorBoundaryProps)` alongside the
existing default `RootLayout` export. Expo Router (v4, already in
`package.json`) renders this in place of the crashed route subtree and
supplies `retry()`.

Because `ErrorBoundary` replaces the whole `Stack` (not a leaf route), it
needs to bring its own `SafeAreaProvider` / `GestureHandlerRootView` wrapper —
those aren't guaranteed to survive whatever crashed. It renders:

```tsx
<SafeAreaProvider>
  <GestureHandlerRootView style={{ flex: 1 }}>
    <ErrorFallback error={error} retry={retry} />
  </GestureHandlerRootView>
</SafeAreaProvider>
```

No `AudioProvider` — the crash may have originated inside it, and the
fallback screen has no audio needs.

## 3. Retry semantics

Soft retry only: the button calls Expo Router's `retry()`, which re-renders
the failed route segment. No forced reload (`window.location.reload` /
`Updates.reloadAsync`), no escalation tier if it fails again — a second crash
just re-enters the same boundary and shows the same screen. This was a
deliberate choice over a full-reload fallback: it's faster and preserves
other in-memory state (audio mute setting, player identity cache) that a hard
reload would drop, at the cost of not helping if the crash is caused by
persistently corrupted state.

## Out of scope

- No crash-reporting/telemetry service wiring (none exists in the repo yet).
- No hard-reload fallback tier.
- No changes to `fsm.py`, `deck.py`, `base.py`, or `ws.py`.
