# FTUE Registration + Sign Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-time onboarding screen that collects a mandatory name + avatar, matches the app's cinematic dark theme, and add a local Sign Out flow that clears the saved profile and routes back to onboarding.

**Architecture:** Extend the existing `usePlayerIdentity` hook (backed by `lib/secureStorage.ts`, itself backed by `expo-secure-store` with a `localStorage` fallback on web) with a stricter "onboarded" definition and a `clearIdentity` action. Rewrite `app/onboarding.tsx`'s visuals to match the layered-gradient-plus-glow dark theme already used by `app/games/[id]/tutorial.tsx`, using the real avatar image set from `constants/avatars.ts`. `app/index.tsx` already redirects to `/onboarding` when not onboarded — no change needed there. Add a Sign Out button to `app/profile.tsx`.

**Tech Stack:** Expo Router, React Native, `expo-secure-store`, `expo-linear-gradient`, `lucide-react-native`, NativeWind/inline styles (matches existing file's own convention), TypeScript strict mode.

## Global Constraints

- No new storage library — reuse `lib/secureStorage.ts` (the spec's "AsyncStorage (or our existing local storage solution)" — this codebase's existing solution is SecureStore + localStorage-on-web).
- Never use `fontFamily: 'Courier New'` or any monospace font. Use `typography.title` / `typography.label` from `constants/design.ts`.
- Icons: `lucide-react-native` only, named imports, no raw emoji, no `@expo/vector-icons`.
- Animations: `react-native-reanimated`, worklets on the native UI thread.
- Player identity (`playerId`) is a first-class auth token — `clearIdentity` must never touch it. No login gates.
- Onboarding header text is literally "WELCOME TO" / "SIPSYNC" (confirmed with the user — not the "GUESSIT" placeholder from the original request, which was a copy-paste artifact from an unrelated template).
- The `vibe` field/storage/UI (`constants/vibes.ts`, `lobby.tsx`'s `VibeIcon` fallback, `useRoomSocket`'s `vibe` field) is untouched by this work — onboarding simply stops writing to it.
- No frontend automated test suite exists in this repo. Each task's "test" step is `npx tsc --noEmit` (run from `frontend/`) plus concrete manual verification steps.

---

## File Structure

- **Modify** `frontend/lib/secureStorage.ts` — add `removeItemAsync`, the delete counterpart to the existing `getItemAsync`/`setItemAsync`.
- **Modify** `frontend/hooks/usePlayerIdentity.ts` — stricter `isOnboarded`, new `clearIdentity()`.
- **Modify** `frontend/app/onboarding.tsx` — full visual rewrite (background, header, name input, avatar grid, CTA).
- **Modify** `frontend/app/profile.tsx` — add the Sign Out button + confirm + wiring.

`app/index.tsx` is read but not modified — its existing `isLoading` → `isOnboarded` → `<Redirect>` guard already satisfies the routing requirement once `isOnboarded` is stricter.

---

## Task 1: `removeItemAsync` in `lib/secureStorage.ts`

**Files:**
- Modify: `frontend/lib/secureStorage.ts`

**Interfaces:**
- Consumes: nothing new — `expo-secure-store`'s `SecureStore.deleteItemAsync`, already imported in this file.
- Produces: `export async function removeItemAsync(key: string): Promise<void>` — deletes `key` on native, `localStorage.removeItem(key)` on web. Task 2 calls this.

- [ ] **Step 1: Add `removeItemAsync`**

Current file (for reference, full contents):

```ts
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * expo-secure-store has no web implementation (no Keychain/Keystore
 * equivalent in a browser), so calls to it throw on web. This wrapper
 * falls back to localStorage there.
 */
export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
```

Append this function at the end of the file:

```ts
export async function removeItemAsync(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/secureStorage.ts
git commit -m "feat: add removeItemAsync to secureStorage wrapper"
```

---

## Task 2: `clearIdentity` + stricter `isOnboarded` in `usePlayerIdentity`

**Files:**
- Modify: `frontend/hooks/usePlayerIdentity.ts`

**Interfaces:**
- Consumes: `removeItemAsync` from `../lib/secureStorage` (Task 1).
- Produces:
  - `isOnboarded: boolean` — now `displayName !== null && preferredAvatar !== null` (was `displayName !== null`). Consumed by `app/index.tsx` (unchanged, already reads this field).
  - `clearIdentity: () => Promise<void>` — clears `displayName` and `preferredAvatar` from storage and state; does not touch `playerId` or `vibe`. Consumed by Task 4 (`profile.tsx`'s Sign Out button).

- [ ] **Step 1: Import `removeItemAsync`**

In `frontend/hooks/usePlayerIdentity.ts`, change:

```ts
import * as SecureStore from '../lib/secureStorage';
```

to:

```ts
import * as SecureStore from '../lib/secureStorage';
```

(No change needed here — `SecureStore.removeItemAsync` is already reachable through the existing namespace import once Task 1 lands.)

- [ ] **Step 2: Add `clearIdentity` to the `PlayerIdentity` interface**

Find:

```ts
  isOnboarded: boolean;
  setIdentity: (name: string, vibe: string | null) => Promise<void>;
  setPreferredAvatar: (avatar: string) => Promise<void>;
  isLoading: boolean;
```

Replace with:

```ts
  isOnboarded: boolean;
  setIdentity: (name: string, vibe: string | null) => Promise<void>;
  setPreferredAvatar: (avatar: string) => Promise<void>;
  clearIdentity: () => Promise<void>;
  isLoading: boolean;
```

- [ ] **Step 3: Implement `clearIdentity` and update the return value**

Find:

```ts
  const setPreferredAvatar = useCallback(async (avatar: string) => {
    await SecureStore.setItemAsync(KEY_PREFERRED_AVATAR, avatar);
    setPreferredAvatarState(avatar);
  }, []);

  return {
    playerId,
    displayName,
    vibe,
    preferredAvatar,
    isOnboarded: displayName !== null,
    setIdentity,
    setPreferredAvatar,
    isLoading,
  };
```

Replace with:

```ts
  const setPreferredAvatar = useCallback(async (avatar: string) => {
    await SecureStore.setItemAsync(KEY_PREFERRED_AVATAR, avatar);
    setPreferredAvatarState(avatar);
  }, []);

  const clearIdentity = useCallback(async () => {
    await SecureStore.removeItemAsync(KEY_DISPLAY_NAME);
    await SecureStore.removeItemAsync(KEY_PREFERRED_AVATAR);
    setDisplayNameState(null);
    setPreferredAvatarState(null);
  }, []);

  return {
    playerId,
    displayName,
    vibe,
    preferredAvatar,
    isOnboarded: displayName !== null && preferredAvatar !== null,
    setIdentity,
    setPreferredAvatar,
    clearIdentity,
    isLoading,
  };
```

- [ ] **Step 4: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no new errors. (`app/index.tsx` and `app/profile.tsx` still destructure a subset of this object's fields, so widening it is safe; Task 4 is what actually calls `clearIdentity`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/usePlayerIdentity.ts
git commit -m "feat: add clearIdentity and require avatar for isOnboarded"
```

---

## Task 3: Rewrite `app/onboarding.tsx`

**Files:**
- Modify: `frontend/app/onboarding.tsx`

**Interfaces:**
- Consumes:
  - `usePlayerIdentity()` → `{ setIdentity, setPreferredAvatar }` (Task 2's widened hook — this task uses `setIdentity(name, null)` and `setPreferredAvatar(avatar)` exactly as `profile.tsx` already does; it does not call `clearIdentity`).
  - `colors`, `typography` from `@/constants/design`.
  - `AVATAR_POOL: string[]`, `AVATAR_IMAGES: Record<string, ImageSourcePropType>`, `AVATAR_COLORS: Record<string, string>` from `@/constants/avatars`.
- Produces: nothing consumed by later tasks — this is a leaf screen.

- [ ] **Step 1: Replace the full contents of `frontend/app/onboarding.tsx`**

```tsx
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_POOL, AVATAR_IMAGES, AVATAR_COLORS } from '@/constants/avatars';

const AVATAR_SIZE = 64;
const AVATAR_GAP = 14;

export default function OnboardingScreen() {
  const { setIdentity, setPreferredAvatar } = usePlayerIdentity();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  const canContinue = name.trim().length >= 2 && avatar !== null;

  async function handleContinue() {
    if (!canContinue || saving || !avatar) return;
    setSaving(true);
    await setIdentity(name.trim(), null);
    await setPreferredAvatar(avatar);
    router.replace('/');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {/* Same layered-gradient-plus-glow technique as the tutorial screens —
          turns the flat colors.ink fill into something with atmosphere. */}
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
          backgroundColor: colors.amber,
          opacity: 0.08,
        }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 32 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={{ alignItems: 'center', marginBottom: 40 }}>
              <Text
                style={{
                  ...typography.label,
                  color: colors.fog,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                Welcome to
              </Text>
              <Text
                style={{
                  ...typography.title,
                  color: colors.amber,
                  fontSize: 40,
                }}
              >
                SipSync
              </Text>
            </View>

            {/* Name input */}
            <View style={{ alignItems: 'center', marginBottom: 40 }}>
              <TextInput
                style={{
                  color: colors.chalk,
                  fontSize: 28,
                  fontWeight: '700',
                  textAlign: 'center',
                  borderBottomWidth: 2,
                  borderBottomColor: focused ? colors.amber : colors.rim,
                  paddingBottom: 12,
                  paddingHorizontal: 12,
                  width: '100%',
                }}
                placeholder="Your name…"
                placeholderTextColor={colors.fog}
                value={name}
                onChangeText={setName}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="words"
                autoFocus
                maxLength={20}
                returnKeyType="done"
                onSubmitEditing={handleContinue}
              />
            </View>

            {/* Avatar grid */}
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  ...typography.label,
                  color: colors.fog,
                  fontSize: 11,
                  textAlign: 'center',
                  marginBottom: 16,
                }}
              >
                Pick your avatar
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: AVATAR_GAP,
                }}
              >
                {AVATAR_POOL.map((id) => {
                  const selected = avatar === id;
                  const tint = AVATAR_COLORS[id];
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setAvatar(id)}
                      style={{
                        width: AVATAR_SIZE,
                        height: AVATAR_SIZE,
                        borderRadius: AVATAR_SIZE / 2,
                        borderWidth: selected ? 3 : 1.5,
                        borderColor: selected ? colors.amber : colors.rim,
                        overflow: 'hidden',
                        transform: [{ scale: selected ? 1.12 : 1 }],
                        shadowColor: colors.amber,
                        shadowOpacity: selected ? 0.6 : 0,
                        shadowRadius: 10,
                        shadowOffset: { width: 0, height: 0 },
                        elevation: selected ? 6 : 0,
                        backgroundColor: colors.surface,
                      }}
                      className="active:opacity-80"
                    >
                      <Image
                        source={AVATAR_IMAGES[id]}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                      {!selected && (
                        <View
                          pointerEvents="none"
                          style={{
                            ...StyleSheet.absoluteFillObject,
                            backgroundColor: tint,
                            opacity: 0.06,
                          }}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {/* CTA */}
          <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
            <Pressable
              onPress={handleContinue}
              disabled={!canContinue || saving}
              style={{
                borderRadius: 16,
                paddingVertical: 20,
                alignItems: 'center',
                backgroundColor: canContinue ? colors.amber : colors.surface,
                shadowColor: colors.amber,
                shadowOpacity: canContinue ? 0.5 : 0,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 },
                elevation: canContinue ? 6 : 0,
              }}
              className="active:opacity-80"
            >
              <Text
                style={{
                  ...typography.title,
                  fontSize: 16,
                  color: canContinue ? colors.ink : colors.fog,
                }}
              >
                {saving ? 'Saving…' : "Let's Go"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run the app (`npx expo start`, press `w` for web or run on a simulator). If a profile is already saved, clear it first (see Task 4's manual verification, or manually delete the `sipsync.display_name` / `sipsync.preferred_avatar` keys via the platform's storage — e.g. on web, `localStorage.clear()` in the browser console).

- Reload the app. Confirm it lands on `/onboarding` with no flash of the Lobby first.
- Confirm the "LET'S GO" button is disabled (dim) with no name and no avatar selected.
- Type a 1-character name — button stays disabled. Type a 2+ character name — button is still disabled (no avatar yet).
- Tap an avatar — it scales up with an amber glow ring. Button becomes enabled (amber) once both name and avatar are set.
- Tap "LET'S GO" — app navigates to the Lobby (`/`), and the Lobby's "Playing as {name}" text shows the name you entered.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/onboarding.tsx
git commit -m "feat: redesign onboarding screen with cinematic theme and avatar picker"
```

---

## Task 4: Sign Out on `app/profile.tsx`

**Files:**
- Modify: `frontend/app/profile.tsx`

**Interfaces:**
- Consumes: `clearIdentity: () => Promise<void>` from `usePlayerIdentity()` (Task 2).
- Produces: nothing consumed elsewhere — leaf change.

- [ ] **Step 1: Add imports**

Find:

```tsx
import { ArrowLeft, Pencil, Sparkles } from 'lucide-react-native';
```

Replace with:

```tsx
import { ArrowLeft, LogOut, Pencil, Sparkles } from 'lucide-react-native';
```

Find:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Image } from 'react-native';
```

Replace with:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Image, Alert } from 'react-native';
```

- [ ] **Step 2: Destructure `clearIdentity` from the hook**

Find:

```tsx
  const { isLoading, displayName, vibe, preferredAvatar, setIdentity, setPreferredAvatar } = usePlayerIdentity();
```

Replace with:

```tsx
  const { isLoading, displayName, vibe, preferredAvatar, setIdentity, setPreferredAvatar, clearIdentity } = usePlayerIdentity();
```

- [ ] **Step 3: Add the sign-out handler**

Find:

```tsx
  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    await setIdentity(name.trim(), vibe);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
```

Add directly below it:

```tsx

  function handleSignOut() {
    Alert.alert(
      'Sign out?',
      "You'll need to enter your name and pick an avatar again next time.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await clearIdentity();
            router.replace('/onboarding');
          },
        },
      ],
    );
  }
```

- [ ] **Step 4: Render the button**

Find the closing of the Save `Pressable` block:

```tsx
        <Pressable
          onPress={handleSave}
          disabled={!canSave || saving || (!dirty && !saved)}
          className="bg-amber py-5 items-center rounded-none active:opacity-80 disabled:opacity-40"
        >
          {saving ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
              {saved ? 'Saved' : 'Save'}
            </Text>
          )}
        </Pressable>
      </ScrollView>
```

Replace with (adds the outlined Sign Out button right after Save, still inside the `ScrollView`):

```tsx
        <Pressable
          onPress={handleSave}
          disabled={!canSave || saving || (!dirty && !saved)}
          className="bg-amber py-5 items-center rounded-none active:opacity-80 disabled:opacity-40"
        >
          {saving ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
              {saved ? 'Saved' : 'Save'}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          style={{
            marginTop: 14,
            borderWidth: 2,
            borderColor: colors.rim,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingVertical: 16,
          }}
          className="active:opacity-60"
        >
          <LogOut size={16} color={colors.dune} strokeWidth={2} />
          <Text style={{ color: colors.dune, fontSize: 13, fontWeight: '700', letterSpacing: 1.5 }} className="uppercase">
            Sign Out
          </Text>
        </Pressable>
      </ScrollView>
```

- [ ] **Step 5: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verification**

With the app running and a profile already saved (from Task 3's verification):

- Open the Lobby, tap the profile icon (top-right) to reach `/profile`.
- Confirm the outlined "Sign Out" button renders below "Save", visually secondary (outline, not filled amber).
- Tap it — confirm the native alert appears with Cancel/Sign Out options.
- Tap Cancel — nothing happens, still on `/profile`.
- Tap Sign Out again, then confirm — app navigates to `/onboarding`.
- Confirm the name field and avatar grid are both empty/unselected (storage was actually cleared, not just the screen).
- Reload the app from a cold start — confirm it stays on `/onboarding` (not the Lobby), proving the clear persisted.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/profile.tsx
git commit -m "feat: add sign out to profile screen"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1+2 cover persistence/guard; Task 3 covers the registration screen; Task 4 covers Sign Out. `app/index.tsx` needs no edits — verified its existing `isLoading`/`isOnboarded`/`<Redirect>` structure already satisfies the routing requirement once Task 2's stricter `isOnboarded` lands.
- **Type consistency:** `clearIdentity` is defined once in Task 2 and consumed with that exact name in Task 4. `setIdentity`/`setPreferredAvatar` signatures are unchanged from the existing hook, used identically in Task 3.
- **No placeholders:** every step has literal code; manual verification steps list concrete taps and expected results rather than "test it works."
