# Global Error Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blank "White Screen of Death" on an uncaught render error with a branded fallback screen (message + "Try Again") using Expo Router's built-in `ErrorBoundary` export, while logging the full error to the console for debugging.

**Architecture:** Two pieces. (1) `ErrorFallback.tsx`, a standalone presentational component styled like `onboarding.tsx` (dark background, amber CTA), that logs the error on mount and calls a `retry()` prop on button press. (2) An `ErrorBoundary` export added to `frontend/app/_layout.tsx` alongside the existing default export — Expo Router renders it in place of the crashed route tree and supplies `error`/`retry`.

**Tech Stack:** Expo Router `ErrorBoundary`/`ErrorBoundaryProps` (already in `expo-router` ~4.0.0, no new dependency), `lucide-react-native` (`AlertTriangle`, `RefreshCw`), `react-native-safe-area-context`, `react-native-gesture-handler`. No new dependencies.

## Global Constraints

- No REST endpoints, no backend changes — this is frontend-only.
- Core engine files (`fsm.py`, `deck.py`, `base.py`, `ws.py`) are not touched.
- No `fontFamily: 'Courier New'` / monospace for any new UI text. Use `typography.title` for the fallback screen's heading (standalone heading, no larger heading above it) — see `frontend/constants/design.ts`.
- Icons: `lucide-react-native` only, imported as named components (`import { AlertTriangle, RefreshCw } from 'lucide-react-native'`). No emoji, no `@expo/vector-icons`.
- TypeScript strict mode is on. No `any`.
- No commented-out code. Keep functions small and single-purpose.
- The raw error/stack trace must never render in the UI — `console.error` only.
- Retry is soft-only: call Expo Router's `retry()` prop. No `window.location.reload()`, no `Updates.reloadAsync()`, no escalation tier on repeat failure.
- There is no frontend automated test runner in this repo (no jest/testing-library configured) — verification per task is `npx tsc --noEmit` (from `frontend/`) plus manual browser verification via `npm run web`, as called out per task.

---

### Task 1: `ErrorFallback` component

**Files:**
- Create: `frontend/components/ErrorFallback.tsx`

**Interfaces:**
- Produces: `ErrorFallback({ error, retry }: { error: Error; retry: () => Promise<void> })` — default export, a React component. Matches Expo Router's `ErrorBoundaryProps` shape exactly (`retry` returns `Promise<void>`, not `void`). Consumed by Task 2.

- [ ] **Step 1: Create the component**

Create `frontend/components/ErrorFallback.tsx`:

```tsx
import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Rendered by Expo Router's ErrorBoundary export (see app/_layout.tsx) in
// place of the crashed route tree. Keeps the raw error out of the UI —
// console.error is the only place the stack trace goes — while still giving
// the user a branded way out instead of a blank white screen.
export default function ErrorFallback({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error);
  }, [error]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.surface, colors.ink]}
        locations={[0, 0.65]}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -220,
          left: '50%',
          width: 460,
          height: 460,
          marginLeft: -230,
          borderRadius: 230,
          backgroundColor: colors.stop,
          opacity: 0.08,
        }}
      />
      <View style={styles.content}>
        <AlertTriangle size={56} color={colors.stop} strokeWidth={2} />
        <Text style={[typography.title, styles.title]}>Oops! Something went wrong</Text>
        <Text style={styles.subtitle}>
          The app hit a snag. Give it another try — your room and progress are usually still there.
        </Text>
        <Pressable onPress={retry} style={styles.button} className="active:opacity-80">
          <RefreshCw size={18} color={colors.ink} strokeWidth={2.5} />
          <Text style={[typography.title, styles.buttonText]}>Try Again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  title: {
    fontSize: 20,
    color: colors.chalk,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.fog,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 28,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonText: {
    fontSize: 15,
    color: colors.ink,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ErrorFallback.tsx
git commit -m "feat: add ErrorFallback component for global error boundary"
```

---

### Task 2: Wire `ErrorBoundary` into the root layout

**Files:**
- Modify: `frontend/app/_layout.tsx`

**Interfaces:**
- Consumes: `ErrorFallback` from `frontend/components/ErrorFallback.tsx` (Task 1), Expo Router's `ErrorBoundaryProps` type from `expo-router`.
- Produces: nothing consumed by later tasks — last task in the plan.

- [ ] **Step 1: Add the `ErrorBoundary` export**

Edit `frontend/app/_layout.tsx`. Current contents (full file):

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

Replace with (adds the `ErrorBoundaryProps` import and the new named `ErrorBoundary` export; the default export and its body are unchanged):

```tsx
import '../global.css';

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AudioProvider } from '@/contexts/AudioContext';
import ErrorFallback from '@/components/ErrorFallback';

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

// Expo Router renders this in place of the whole Stack when a child route
// throws during render. It replaces everything RootLayout would normally
// wrap, including providers that may not have survived whatever crashed —
// so it brings its own SafeAreaProvider/GestureHandlerRootView rather than
// assuming RootLayout's tree is still intact. Deliberately no AudioProvider:
// the crash may have originated inside it, and the fallback has no audio
// needs.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ErrorFallback error={error} retry={retry} />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run: `cd frontend && npm run web`, open the printed localhost URL in a browser.
Temporarily add `throw new Error('test crash');` at the top of the render body of any screen component (e.g. `frontend/app/index.tsx`'s default export function, first line), save, and confirm:
- The fallback screen renders (dark background, triangle icon, "Oops! Something went wrong", "Try Again" button) instead of a blank white screen.
- The browser devtools console shows the logged error (`[ErrorBoundary] Error: test crash` with a stack trace).
- No raw error text or stack trace appears anywhere in the rendered UI.
Remove the injected `throw` line, save, then tap/click "Try Again" — confirm the screen recovers and shows the normal app content without a manual page reload.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/_layout.tsx
git commit -m "feat: wire Expo Router ErrorBoundary to global error fallback"
```

---

## Final Step: Issue + PR

- [ ] Create a GitHub issue for this work (no existing open issue covers it), then push the branch and open a PR into `main` (squash-merge per `CLAUDE.md`'s PR flow), confirming with the user before pushing/merging per the standing rule on shared-state actions.

```bash
gh issue create --title "feat: global error boundary (prevent White Screen of Death)" --body "$(cat <<'EOF'
Uncaught render errors currently produce a blank white screen with no recovery path, flagged in the technical audit. Add an Expo Router ErrorBoundary with a branded fallback UI and a soft "Try Again" retry.
EOF
)"

git push -u origin feat/global-error-boundary
gh pr create --title "feat: add global error boundary" --body "$(cat <<'EOF'
Closes #<issue-number-from-above>

## Summary
- Add `ErrorFallback` component: branded "Oops! Something went wrong" screen with a "Try Again" CTA, styled to match the existing dark-screen convention
- Wire an `ErrorBoundary` export into `frontend/app/_layout.tsx` via Expo Router, replacing the blank White Screen of Death on any uncaught render error
- Raw error/stack trace goes to `console.error` only, never rendered in the UI
- Retry is soft-only (`retry()` re-renders the crashed segment) — no forced reload

## Test plan
- [ ] `npx tsc --noEmit` passes
- [ ] Manual: injected test crash renders the fallback screen instead of a blank white screen
- [ ] Manual: error is logged to the console with a stack trace, not shown in the UI
- [ ] Manual: "Try Again" recovers the app without a manual page reload

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
