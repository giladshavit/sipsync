# Global Audio System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global audio system — looping background music (BGM) that persists across screen navigation, discrete sound effects (SFX) that never interrupt BGM or each other, and a persisted mute toggle — exposed via a React Context provider wrapping the whole app, with a mute button in the lobby.

**Architecture:** `AudioProvider` (`frontend/contexts/AudioContext.tsx`) holds one long-lived `expo-audio` `AudioPlayer` for BGM in a ref (swapped via `createAudioPlayer`/`.remove()` when `playBGM` is called with a different track) and spins up a fresh, self-cleaning `AudioPlayer` per `playSFX` call so SFX can overlap BGM and each other without ever pausing/reusing a shared instance. `isMuted` is React state, persisted to `AsyncStorage`, and every `.play()` call goes through a helper that catches a browser autoplay-block error (`DOMException`) and falls back to muted instead of crashing. The provider wraps `<Stack>` in `frontend/app/_layout.tsx`; a mute icon button is added to the existing top bar in the lobby screen.

**Tech Stack:** Expo SDK 52 / React Native / TypeScript (strict), `expo-audio` (not `expo-av` — deprecated in SDK 52, removed in SDK 53), `@react-native-async-storage/async-storage`, `lucide-react-native` icons. No frontend test runner exists in this repo — verified via `npx tsc --noEmit` per task and a full manual pass in the final task.

## Global Constraints

- Frontend package management: `npm`/`yarn` via `npx expo install` for new deps (picks SDK-52-compatible versions) — per CLAUDE.md.
- Use `expo-audio`, never `expo-av` — deprecated in this SDK.
- No REST endpoints, no backend changes — this is frontend-only.
- Icons: `lucide-react-native` only, imported as named components (`import { Volume2, VolumeX } from 'lucide-react-native'`). No emoji, no `@expo/vector-icons`.
- TypeScript strict mode — no `any`.
- No commented-out code, no half-finished implementations (CLAUDE.md hard constraint, and explicitly confirmed with the user for this task) — all `require()`/playback calls are real, working code from the start. The Metro-bundling concern is solved by placeholder asset *files* existing on disk, not by stubbing code.
- Out of scope (confirmed with user): do not call `playBGM`/`playSFX` from any game/lobby/podium screen logic yet — only the provider, asset scaffolding, and the lobby mute button.
- Out of scope: no new shared Header/Navbar component — this codebase has none today; the mute button goes directly into the lobby's existing inline top bar.

---

### Task 1: Dependencies, placeholder audio assets, and the sound asset table

**Files:**
- Modify: `frontend/package.json` (new deps: `expo-audio`, `@react-native-async-storage/async-storage`)
- Create: `frontend/assets/sounds/lobby-bgm.mp3` (empty placeholder)
- Create: `frontend/assets/sounds/game-bgm.mp3` (empty placeholder)
- Create: `frontend/assets/sounds/podium-sfx.mp3` (empty placeholder)
- Create: `frontend/assets/sounds/chaser-sfx.mp3` (empty placeholder)
- Create: `frontend/assets/sounds/start-sfx.mp3` (empty placeholder)
- Create: `frontend/constants/sounds.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BGMTrack` (`'lobby' | 'gameplay'`), `SFXName` (`'podium' | 'chaser' | 'start'`), `BGM_TRACKS: Record<BGMTrack, AudioSource>`, `SFX_SOURCES: Record<SFXName, AudioSource>` — all imported by Task 2's `AudioContext.tsx`.

- [ ] **Step 1: Install the new dependencies**

Run: `cd frontend && npx expo install expo-audio @react-native-async-storage/async-storage`

This resolves and installs the versions compatible with Expo SDK 52, and updates `package.json`/`package-lock.json` (or `yarn.lock`, whichever this repo uses).

- [ ] **Step 2: Verify the install**

Run: `cd frontend && grep -E "expo-audio|async-storage" package.json`
Expected: both packages listed under `dependencies`.

- [ ] **Step 3: Create the placeholder sound assets**

Run:
```bash
cd frontend && mkdir -p assets/sounds && touch \
  assets/sounds/lobby-bgm.mp3 \
  assets/sounds/game-bgm.mp3 \
  assets/sounds/podium-sfx.mp3 \
  assets/sounds/chaser-sfx.mp3 \
  assets/sounds/start-sfx.mp3
```

These are zero-byte stub files. Metro's asset pipeline only needs the file to exist on disk to resolve a `require()` call — it does not parse or validate audio content — so this is what actually prevents any bundler crash. They produce no sound until replaced with real MP3s at these exact filenames.

- [ ] **Step 4: Write the sound asset table**

Create `frontend/constants/sounds.ts`:

```typescript
import type { AudioSource } from 'expo-audio';

export type BGMTrack = 'lobby' | 'gameplay';
export type SFXName = 'podium' | 'chaser' | 'start';

// assets/sounds/*.mp3 are currently empty placeholder files (zero bytes) —
// just enough for Metro to resolve these require() calls so the app builds
// and runs with no audio yet. Drop real MP3 files at these exact filenames
// into frontend/assets/sounds/ to make BGM/SFX actually play.
export const BGM_TRACKS: Record<BGMTrack, AudioSource> = {
  lobby: require('@/assets/sounds/lobby-bgm.mp3'),
  gameplay: require('@/assets/sounds/game-bgm.mp3'),
};

export const SFX_SOURCES: Record<SFXName, AudioSource> = {
  podium: require('@/assets/sounds/podium-sfx.mp3'),
  chaser: require('@/assets/sounds/chaser-sfx.mp3'),
  start: require('@/assets/sounds/start-sfx.mp3'),
};
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (This confirms `expo-audio`'s `AudioSource` type resolves and the `.mp3` `require()` calls typecheck against Expo's built-in asset module declarations — the same mechanism that already lets `constants/avatars.ts` `require()` `.png` files without a custom `.d.ts`. Actual Metro *bundling* of these assets is verified in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/assets/sounds frontend/constants/sounds.ts
git commit -m "chore: add expo-audio, async-storage, and placeholder sound assets"
```

---

### Task 2: `AudioContext.tsx` — the `AudioProvider` and `useAudio()` hook

**Files:**
- Create: `frontend/contexts/AudioContext.tsx`

**Interfaces:**
- Consumes: `BGMTrack`, `SFXName`, `BGM_TRACKS`, `SFX_SOURCES` from `@/constants/sounds` (Task 1); `createAudioPlayer`, `AudioPlayer` from `expo-audio`; `AsyncStorage` from `@react-native-async-storage/async-storage`.
- Produces: `AudioProvider` (component, wraps children) and `useAudio(): { isMuted: boolean; toggleMute: () => void; playBGM: (track: BGMTrack) => void; playSFX: (name: SFXName) => void }`. Task 3 consumes `AudioProvider`; Task 4 consumes `useAudio`.

- [ ] **Step 1: Write `AudioContext.tsx`**

Create `frontend/contexts/AudioContext.tsx`:

```typescript
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { BGM_TRACKS, SFX_SOURCES, type BGMTrack, type SFXName } from '@/constants/sounds';

const MUTE_STORAGE_KEY = 'sipsync.audio_muted';

interface AudioContextValue {
  isMuted: boolean;
  toggleMute: () => void;
  playBGM: (track: BGMTrack) => void;
  playSFX: (name: SFXName) => void;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (!ctx) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return ctx;
}

/** Browsers block .play() before a user gesture, rejecting/throwing a
 * DOMException. DOMException isn't guaranteed to exist as a global on
 * native (Hermes), so it's guarded rather than referenced directly. */
function isBlockedAutoplayError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

/** Wraps AudioPlayer#play() so a blocked web autoplay attempt can never
 * crash or leave playback in an inconsistent state — it just falls back
 * to `onBlocked` (which the callers below use to force isMuted back on). */
function playSafely(player: AudioPlayer, onBlocked: () => void): void {
  try {
    const result: unknown = player.play();
    if (result != null && typeof (result as { catch?: unknown }).catch === 'function') {
      (result as Promise<unknown>).catch((error: unknown) => {
        if (isBlockedAutoplayError(error)) onBlocked();
      });
    }
  } catch (error) {
    if (isBlockedAutoplayError(error)) onBlocked();
  }
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [isMuted, setIsMuted] = useState(false);
  const bgmPlayerRef = useRef<AudioPlayer | null>(null);
  const bgmTrackRef = useRef<BGMTrack | null>(null);
  const activeSfxRef = useRef<Set<AudioPlayer>>(new Set());

  // Load the persisted mute preference once on mount. Default (nothing
  // stored yet) is unmuted — on web, if that turns out to be blocked by
  // the browser's autoplay policy, playBGM/toggleMute's playSafely calls
  // fall back to muted on their own; there's nothing to play yet at this
  // point since no screen calls playBGM in this task.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(MUTE_STORAGE_KEY).then((stored) => {
      if (!cancelled && stored != null) {
        setIsMuted(stored === 'true');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup on provider unmount (in practice this provider wraps the root
  // Stack and never unmounts, but a live BGM/SFX player left dangling on
  // teardown would be a native-resource leak).
  useEffect(() => {
    return () => {
      bgmPlayerRef.current?.remove();
      activeSfxRef.current.forEach((player) => player.remove());
      activeSfxRef.current.clear();
    };
  }, []);

  const playBGM = (track: BGMTrack) => {
    if (bgmTrackRef.current === track && bgmPlayerRef.current) {
      return;
    }
    bgmPlayerRef.current?.remove();
    const player = createAudioPlayer(BGM_TRACKS[track]);
    player.loop = true;
    bgmPlayerRef.current = player;
    bgmTrackRef.current = track;
    if (!isMuted) {
      playSafely(player, () => setIsMuted(true));
    }
  };

  const playSFX = (name: SFXName) => {
    if (isMuted) return;
    const player = createAudioPlayer(SFX_SOURCES[name]);
    activeSfxRef.current.add(player);
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        subscription.remove();
        activeSfxRef.current.delete(player);
        player.remove();
      }
    });
    playSafely(player, () => {
      subscription.remove();
      activeSfxRef.current.delete(player);
      player.remove();
    });
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    AsyncStorage.setItem(MUTE_STORAGE_KEY, String(next));
    const bgm = bgmPlayerRef.current;
    if (!bgm) return;
    if (next) {
      bgm.pause();
    } else {
      playSafely(bgm, () => {
        setIsMuted(true);
        AsyncStorage.setItem(MUTE_STORAGE_KEY, 'true');
      });
    }
  };

  const value = useMemo<AudioContextValue>(
    () => ({ isMuted, toggleMute, playBGM, playSFX }),
    [isMuted],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. In particular, confirm `player.addListener('playbackStatusUpdate', ...)`'s callback parameter and `.remove()` on the returned subscription typecheck against `expo-audio`'s types — if the installed version's event name or subscription shape differs, fix the type here before moving on (this is the one place in the plan most likely to need adjusting to match the exact installed `expo-audio` version).

- [ ] **Step 3: Commit**

```bash
git add frontend/contexts/AudioContext.tsx
git commit -m "feat: add AudioProvider for global BGM/SFX/mute state"
```

---

### Task 3: Wrap the app in `AudioProvider`

**Files:**
- Modify: `frontend/app/_layout.tsx` (entire file, currently 23 lines)

**Interfaces:**
- Consumes: `AudioProvider` from `@/contexts/AudioContext` (Task 2).
- Produces: nothing consumed by later tasks — every screen in the app can now call `useAudio()`.

- [ ] **Step 1: Wrap `<Stack>` in `AudioProvider`**

Replace the full contents of `frontend/app/_layout.tsx`:

```typescript
import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AudioProvider } from '@/contexts/AudioContext';

export default function RootLayout() {
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

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/_layout.tsx
git commit -m "feat: wrap app in AudioProvider"
```

---

### Task 4: Mute button in the lobby top bar

**Files:**
- Modify: `frontend/app/room/[code]/lobby.tsx:4` (icon import)
- Modify: `frontend/app/room/[code]/lobby.tsx:7` (add `useAudio` import)
- Modify: `frontend/app/room/[code]/lobby.tsx:22` (destructure `useAudio()` alongside the other hooks)
- Modify: `frontend/app/room/[code]/lobby.tsx:141-156` (top bar: add mute button next to the back button)

**Interfaces:**
- Consumes: `useAudio` from `@/contexts/AudioContext` (Task 2) — specifically `isMuted` and `toggleMute`.
- Produces: nothing consumed by later tasks — this is the final UI surface for this plan.

- [ ] **Step 1: Import the mute icons and `useAudio`**

In `frontend/app/room/[code]/lobby.tsx`, update the `lucide-react-native` import (currently line 4):

```typescript
import { ArrowLeft, Check, Copy, Eye, Pencil, Share2, Volume2, VolumeX } from 'lucide-react-native';
```

Add a new import right after the existing `usePlayerIdentity` import (currently line 7):

```typescript
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useAudio } from '@/contexts/AudioContext';
```

- [ ] **Step 2: Read `isMuted`/`toggleMute` in the component**

In `LobbyScreen`, add this alongside the existing hook calls (currently line 22, right after `usePlayerIdentity()`):

```typescript
  const { playerId } = usePlayerIdentity();
  const { isMuted, toggleMute } = useAudio();
```

- [ ] **Step 3: Add the mute button next to the back button**

Replace the existing back-button block (currently lines 141-156):

```typescript
      {/* Back to home */}
      <Pressable
        onPress={() => setConfirmingLeave(true)}
        style={{
          width: 42,
          height: 42,
          borderWidth: 2,
          borderColor: colors.ink,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
        className="active:opacity-60"
      >
        <ArrowLeft size={20} color={colors.ink} />
      </Pressable>
```

with:

```typescript
      {/* Top bar: back to home + mute toggle */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <Pressable
          onPress={() => setConfirmingLeave(true)}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>

        <Pressable
          onPress={toggleMute}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-60"
        >
          {isMuted ? (
            <VolumeX size={20} color={colors.ink} />
          ) : (
            <Volume2 size={20} color={colors.ink} />
          )}
        </Pressable>
      </View>
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/room/[code]/lobby.tsx"
git commit -m "feat: add mute toggle button to the lobby top bar"
```

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only).

**Interfaces:** N/A.

- [ ] **Step 1: Full project typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors anywhere in the project (confirms Tasks 1-4 compose cleanly together).

- [ ] **Step 2: Start the frontend on web**

Run: `cd frontend && npx expo start --web`
Expected: Metro bundles successfully with no "Unable to resolve module" or asset-related errors from the placeholder `.mp3` files — this is the concrete proof that empty placeholder files were sufficient and nothing needed to be stubbed out.

- [ ] **Step 3: Confirm the app loads with no console errors**

Open the app in the browser tab that `expo start --web` opens. Confirm the home/onboarding screen loads normally and the browser console shows no errors or warnings coming from `AudioContext.tsx` (e.g. no "useAudio must be used within an AudioProvider" — which would indicate the provider isn't actually wrapping the tree).

- [ ] **Step 4: Join or create a room and reach the lobby**

Follow the app's normal flow to get to `frontend/app/room/[code]/lobby.tsx`. Confirm the new mute icon button renders in the top bar, to the right of the back button, matching the back button's size/border style.

- [ ] **Step 5: Toggle mute and confirm no crash**

Tap the mute button. Confirm:
- The icon swaps between `Volume2` and `VolumeX` on each tap.
- No error appears in the console (in particular, no unhandled exception from `toggleMute` — since no BGM is playing yet in this task, `bgmPlayerRef.current` is `null` and `toggleMute` should simply flip `isMuted` and return early).

- [ ] **Step 6: Confirm mute preference persists**

With the button toggled to muted, reload the browser tab (full page reload, not just a client navigation). Confirm the mute button still shows the muted (`VolumeX`) icon after reload — proving the `AsyncStorage` persistence round-trips correctly on web.

- [ ] **Step 7: Report results**

If everything above passes, the feature is complete. If anything fails, note the exact repro steps and fix before considering this plan done — do not commit a fix without re-running the affected manual steps. Remember that `playBGM`/`playSFX` are intentionally not called from any screen yet (out of scope for this plan), so audible playback itself cannot be verified until a follow-up task wires those calls in and real MP3 files replace the placeholders.
