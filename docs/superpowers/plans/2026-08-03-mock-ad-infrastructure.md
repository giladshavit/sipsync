# Mock Ad Infrastructure (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build flag-gated mock ad infrastructure for SipSync's Web build (a full-screen "TEST AD PLACEMENT" overlay shown once per room in the Lobby and once per round on the Podium) so we can validate ad UX/timing before wiring in real Google AdSense.

**Architecture:** Three new files (`config/ads.ts` feature flags, `hooks/useMockAd.ts` gating logic, `components/MockAdOverlay.tsx` the visual overlay) plumbed into two existing screens (`lobby.tsx`, `podium.tsx`) with a two-line hook-call + conditional-render each. No new dependencies, no backend changes, no real ad network calls.

**Tech Stack:** Expo Router / React Native Web, TypeScript strict mode, `react-native-reanimated` for the overlay's entrance animation, `lucide-react-native` for the close icon.

## Global Constraints

- Backend is untouched by this feature — no changes there.
- Frontend: no `any` types.
- No `fontFamily: 'Courier New'` — use `typography.title` / `typography.label` from `constants/design.ts` for all tracked-caps text (per CLAUDE.md's Typography section).
- No raw emoji in UI — any icon comes from `lucide-react-native`.
- Animations that move things on screen use `react-native-reanimated` worklets, not JS-thread state loops.
- This codebase has no unit test runner (no Jest, no test files anywhere in `frontend/`). Verification is `npx tsc --noEmit` (strict-mode type check) plus manual verification in a running `expo start --web` session, per CLAUDE.md's UI-change guidance. Do not invent a test framework or fabricate test files that don't fit the codebase's actual conventions.
- Mock ads are Web-only: every gating check includes `Platform.OS === 'web'` in addition to the feature flags.

---

### Task 1: Ad feature flags config

**Files:**
- Create: `frontend/config/ads.ts`

**Interfaces:**
- Produces: `ENABLE_ALL_ADS: boolean`, `ENABLE_LOBBY_AD: boolean`, `ENABLE_PODIUM_AD: boolean`, `shouldShowAd(specificFlag: boolean): boolean`.

- [ ] **Step 1: Create the config directory and file**

```ts
// frontend/config/ads.ts

// Mock-ad feature flags — Web build only (see hooks/useMockAd.ts, which
// also gates on Platform.OS). Flip these to test ad placement/timing
// without touching a real ad network. An ad only shows if ENABLE_ALL_ADS
// AND its own specific flag are both true.
export const ENABLE_ALL_ADS = true;
export const ENABLE_LOBBY_AD = true;
export const ENABLE_PODIUM_AD = true;

export function shouldShowAd(specificFlag: boolean): boolean {
  return ENABLE_ALL_ADS && specificFlag;
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors mentioning `config/ads.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/config/ads.ts
git commit -m "feat: add mock ad feature flag config"
```

---

### Task 2: Mock ad gating hooks

**Files:**
- Create: `frontend/hooks/useMockAd.ts`

**Interfaces:**
- Consumes: `ENABLE_ALL_ADS`, `ENABLE_LOBBY_AD`, `ENABLE_PODIUM_AD`, `shouldShowAd` from `@/config/ads` (Task 1).
- Produces: `useLobbyAd(code: string | undefined): { visible: boolean; dismiss: () => void }`, `usePodiumAd(): { visible: boolean; dismiss: () => void }`.

- [ ] **Step 1: Write the hooks**

```ts
// frontend/hooks/useMockAd.ts
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ENABLE_LOBBY_AD, ENABLE_PODIUM_AD, shouldShowAd } from '@/config/ads';

// Module-level (not component state) so it survives across LobbyScreen
// remounts for the same room within this browser session — a player
// bouncing back to the Lobby from the Games sheet, or the FSM resetting
// the room to LOBBY after End Night, won't re-trigger the ad they've
// already seen for this room code.
const seenLobbyAdForRoom = new Set<string>();

export function useLobbyAd(code: string | undefined): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!code) return;
    if (Platform.OS !== 'web') return;
    if (!shouldShowAd(ENABLE_LOBBY_AD)) return;
    if (seenLobbyAdForRoom.has(code)) return;
    seenLobbyAdForRoom.add(code);
    setVisible(true);
  }, [code]);

  return { visible, dismiss: () => setVisible(false) };
}

export function usePodiumAd(): { visible: boolean; dismiss: () => void } {
  // PodiumScreen remounts fresh every round (router.replace), so lazily
  // initializing to "on" here naturally means "fires once per round."
  const [visible, setVisible] = useState(() => Platform.OS === 'web' && shouldShowAd(ENABLE_PODIUM_AD));

  return { visible, dismiss: () => setVisible(false) };
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors mentioning `hooks/useMockAd.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/useMockAd.ts
git commit -m "feat: add mock ad gating hooks (useLobbyAd, usePodiumAd)"
```

---

### Task 3: MockAdOverlay component

**Files:**
- Create: `frontend/components/MockAdOverlay.tsx`

**Interfaces:**
- Consumes: `colors`, `typography` from `@/constants/design` (existing).
- Produces: `MockAdOverlay({ type, onClose }: { type: 'lobby' | 'podium'; onClose: () => void })` — default export, a React component.

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/MockAdOverlay.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { X } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';

const LOBBY_AD_SECONDS = 5;

export default function MockAdOverlay({
  type,
  onClose,
}: {
  type: 'lobby' | 'podium';
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(type === 'lobby' ? LOBBY_AD_SECONDS : 0);

  useEffect(() => {
    if (type !== 'lobby' || secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [type, secondsLeft]);

  const canSkip = type === 'podium' || secondsLeft <= 0;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: colors.ink,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
      }}
    >
      {/* "AD" pill badge */}
      <View
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          backgroundColor: colors.amber,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        <Text style={{ ...typography.label, fontSize: 10, letterSpacing: 2, color: colors.ink }}>
          Ad
        </Text>
      </View>

      {/* Podium: immediate close button. Lobby: no close button renders
          here at all until the countdown reaches zero (see the Skip Ad
          button below) — there is deliberately no early-exit affordance. */}
      {type === 'podium' && (
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: 'rgba(240,240,232,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-70"
        >
          <X size={18} color={colors.chalk} strokeWidth={2.5} />
        </Pressable>
      )}

      <Text
        style={{
          ...typography.title,
          fontSize: 32,
          color: colors.chalk,
          textAlign: 'center',
          marginBottom: 10,
          paddingHorizontal: 24,
        }}
      >
        Test Ad Placement
      </Text>
      <Text
        style={{
          color: colors.fog,
          fontSize: 13,
          textAlign: 'center',
          paddingHorizontal: 40,
        }}
      >
        Mock inventory — real ads plug in here later.
      </Text>

      {type === 'lobby' && (
        <View style={{ marginTop: 32, alignItems: 'center' }}>
          {canSkip ? (
            <Pressable
              onPress={onClose}
              style={{ backgroundColor: colors.amber, paddingVertical: 14, paddingHorizontal: 28 }}
              className="active:opacity-80"
            >
              <Text style={{ ...typography.label, fontSize: 13, color: colors.ink }}>
                Skip Ad
              </Text>
            </Pressable>
          ) : (
            <Text style={{ ...typography.label, fontSize: 13, letterSpacing: 2, color: colors.fog }}>
              Skip in {secondsLeft}s
            </Text>
          )}
        </View>
      )}
    </Animated.View>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors mentioning `components/MockAdOverlay.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/MockAdOverlay.tsx
git commit -m "feat: add MockAdOverlay component"
```

---

### Task 4: Wire the Lobby ad into `lobby.tsx`

**Files:**
- Modify: `frontend/app/room/[code]/lobby.tsx:1-15` (imports), `frontend/app/room/[code]/lobby.tsx:21-31` (component body, add hook call), `frontend/app/room/[code]/lobby.tsx:610-626` (JSX, add overlay render before the closing root `</View>`)

**Interfaces:**
- Consumes: `useLobbyAd` from `@/hooks/useMockAd` (Task 2), `MockAdOverlay` default export from `@/components/MockAdOverlay` (Task 3).

- [ ] **Step 1: Add the imports**

In `frontend/app/room/[code]/lobby.tsx`, add these two lines to the existing import block (after the `AvatarPickerSheet` import on line 15):

```ts
import { useLobbyAd } from '@/hooks/useMockAd';
import MockAdOverlay from '@/components/MockAdOverlay';
```

- [ ] **Step 2: Call the hook in the component body**

In the same file, right after the existing `const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);` line (line 29), add:

```ts
  const { visible: lobbyAdVisible, dismiss: dismissLobbyAd } = useLobbyAd(code);
```

- [ ] **Step 3: Render the overlay**

Find the closing of the `AvatarPickerSheet` conditional block near the end of the returned JSX:

```tsx
      {avatarPickerOpen && (
        <AvatarPickerSheet
          currentAvatar={myAvatar}
          takenAvatars={takenAvatars}
          onSelect={(avatar) => {
            send({ type: 'SET_AVATAR', avatar });
          }}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </View>
  );
}
```

Add the `MockAdOverlay` render right after that block, still inside the root `View`:

```tsx
      {avatarPickerOpen && (
        <AvatarPickerSheet
          currentAvatar={myAvatar}
          takenAvatars={takenAvatars}
          onSelect={(avatar) => {
            send({ type: 'SET_AVATAR', avatar });
          }}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}

      {lobbyAdVisible && <MockAdOverlay type="lobby" onClose={dismissLobbyAd} />}
    </View>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors mentioning `lobby.tsx`.

- [ ] **Step 5: Manual browser verification**

Use the `run` skill (or manually: `cd frontend && npm run web`) to start the Expo web dev server, then:
1. On the home screen, tap "Create Room" (or your build's equivalent create action).
2. Confirm you land on the Lobby and the full-screen "Test Ad Placement" overlay appears immediately, with the "Ad" badge top-left and "Skip in 5s" (counting down) at the bottom — no Skip button yet.
3. Confirm tapping anywhere on the overlay (not on a button) does nothing to the Lobby underneath — it's fully blocked.
4. Wait for the countdown to reach 0; confirm the amber "Skip Ad" button appears and tapping it dismisses the overlay, revealing the normal Lobby.
5. Refresh reasoning check (no action needed against a live server, just confirm from the code): trigger a re-mount of the Lobby for the *same* room code (e.g. open the Games sheet and close it, or use the browser back/forward within the room) and confirm the ad does not reappear, since `code` is already recorded in `seenLobbyAdForRoom`.
6. Take a screenshot for the record: `node scripts/screenshot.mjs http://localhost:8081 /tmp/lobby-ad.png` (adjust port/path to match the actual dev server URL and route) and inspect it.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/room/[code]/lobby.tsx
git commit -m "feat: show mock ad on Lobby entry"
```

---

### Task 5: Wire the Podium ad into `podium.tsx`

**Files:**
- Modify: `frontend/app/room/[code]/podium.tsx:1-27` (imports), `frontend/app/room/[code]/podium.tsx:909-922` (component body, add hook call), `frontend/app/room/[code]/podium.tsx:1374-1380` (JSX, add overlay render alongside the other conditional overlays)

**Interfaces:**
- Consumes: `usePodiumAd` from `@/hooks/useMockAd` (Task 2), `MockAdOverlay` default export from `@/components/MockAdOverlay` (Task 3).

- [ ] **Step 1: Add the imports**

In `frontend/app/room/[code]/podium.tsx`, add these two lines to the existing import block (after the `import type { PlayerOutcome } from '@/hooks/useRoomSocket';` line):

```ts
import { usePodiumAd } from '@/hooks/useMockAd';
import MockAdOverlay from '@/components/MockAdOverlay';
```

- [ ] **Step 2: Call the hook in the component body**

Right after `const isAdmin = !!snapshot && snapshot.admin_id === playerId;` near the top of `PodiumScreen`, add:

```ts
  const { visible: podiumAdVisible, dismiss: dismissPodiumAd } = usePodiumAd();
```

- [ ] **Step 3: Render the overlay**

Find this existing block in the returned JSX:

```tsx
      {showSharePopup && (
        <SharePopup code={code ?? ''} onDismiss={() => setShowSharePopup(false)} />
      )}
```

Add the `MockAdOverlay` render immediately after it:

```tsx
      {showSharePopup && (
        <SharePopup code={code ?? ''} onDismiss={() => setShowSharePopup(false)} />
      )}

      {podiumAdVisible && <MockAdOverlay type="podium" onClose={dismissPodiumAd} />}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors mentioning `podium.tsx`.

- [ ] **Step 5: Manual browser verification**

This screen requires an actual completed round to reach naturally (2 connected players, play through one mini-game). Using the `run` skill (or two browser tabs against `npm run web`):
1. Create a room in tab A, join it from tab B with the room code, start the game once both are connected, and play through one round to reach the Podium.
2. Confirm the full-screen "Test Ad Placement" overlay appears immediately on the Podium screen in both tabs, with the "Ad" badge top-left and an X close button top-right active immediately (no countdown).
3. Confirm tapping the X dismisses the overlay and reveals the normal Podium screen underneath.
4. Trigger "Next Round" and confirm the ad overlay reappears on the newly mounted Podium after the following round (since `usePodiumAd` re-initializes fresh on every mount).
5. If a full 2-player round is impractical to drive end-to-end in this session, state explicitly that this step was verified only via type-check and code review, not a live browser pass — per CLAUDE.md's guidance not to claim UI verification that wasn't actually done.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/room/[code]/podium.tsx
git commit -m "feat: show mock ad on Podium mount"
```

---

## Self-Review Notes

- **Spec coverage:** Feature flags (Task 1) ✅, MockAdOverlay component with both lobby/podium behaviors (Task 3) ✅, Lobby wiring (Task 4) ✅, Podium wiring (Task 5) ✅, styling from `constants/design.ts` / z-index / full-screen block (Task 3) ✅, Platform + once-per-room gating (Task 2) ✅.
- **Placeholder scan:** No TBD/TODO; every step has literal code or literal manual verification instructions.
- **Type consistency:** `useLobbyAd(code: string | undefined)`, `usePodiumAd()`, and `MockAdOverlay({ type, onClose })` are defined once (Tasks 2–3) and consumed with matching names/shapes in Tasks 4–5.
