# FTUE Registration + Sign Out — Design

## Problem

New players land straight on the Lobby with no name/avatar set. Onboarding
exists (`app/onboarding.tsx`) but is visually plain (flat `colors.ink`, no
gradient/glow), collects an optional lucide "vibe" icon instead of a real
avatar, and there's no way to sign out and re-onboard as someone else.

## Persistence & guard

No new storage library — reuse `hooks/usePlayerIdentity.ts` and
`lib/secureStorage.ts` (SecureStore, with a `localStorage` fallback on web).

- `isOnboarded` changes from `displayName !== null` to
  `displayName !== null && preferredAvatar !== null`. Avatar becomes a
  mandatory part of a complete profile, not the optional, later-set field it
  is today.
- `app/index.tsx` already gates on `isOnboarded`: it shows a spinner while
  `isLoading`, then either renders the Lobby or `<Redirect href="/onboarding" />`.
  That satisfies the "seamless, no flicker" requirement as-is — the only
  change needed is the stricter `isOnboarded` definition above.
- Add `clearIdentity()` to `usePlayerIdentity`: clears `displayName` and
  `preferredAvatar` from storage and state.
  - `playerId` (the auth UUID, per CLAUDE.md's Authentication section) is
    **never** touched — it's the player's permanent identity.
  - `vibe` is **never** touched — it remains available as the in-room
    fallback icon (`lobby.tsx`'s `VibeIcon`) even after a sign-out/re-onboard.
- Add `removeItemAsync` to `lib/secureStorage.ts`, mirroring the existing
  `getItemAsync`/`setItemAsync` web-fallback pattern (`SecureStore.deleteItemAsync`
  natively, `localStorage.removeItem` on web).

## `app/onboarding.tsx` — full visual rewrite

Same layered-background technique already used by
`app/games/[id]/tutorial.tsx` and `app/room/[code]/tutorial.tsx`: a
`colors.ink` base, a `LinearGradient([colors.surface, colors.ink], locations=[0, 0.65])`
absolute-fill, and a soft amber glow circle bleeding from the top. Wrapped in
`SafeAreaView` + `KeyboardAvoidingView` (`behavior: 'padding'` on iOS).

- **Header**: "WELCOME TO" in `typography.label` / `colors.fog`, then
  "SIPSYNC" in `typography.title` / `colors.amber`, large and center-aligned.
- **Name**: a large, centered `TextInput`. Underline/border sits at
  `colors.rim` at rest and lights up to `colors.amber` on focus. Minimum 2
  trimmed characters — matches the existing validation in `profile.tsx`.
- **Avatar**: an inline wrapped grid (not a modal sheet) built from the real
  `AVATAR_POOL` / `AVATAR_IMAGES` / `AVATAR_COLORS` in `constants/avatars.ts`
  — the same asset set `profile.tsx`'s avatar picker already uses. No lucide
  vibe icons anywhere on this screen. The selected avatar scales up slightly
  with an amber glow ring, echoing `AvatarHero` in `profile.tsx`.
- **CTA**: a bottom-anchored "LET'S GO" block button, amber background,
  bold/uppercase, tactile `active:opacity` press state — matching the
  primary buttons on `index.tsx`/`profile.tsx`. Disabled (dim / `colors.rim`
  background) until the name is valid *and* an avatar is selected.
- **Submit**: `setIdentity(name, null)` then `setPreferredAvatar(avatar)` —
  reusing the two existing setters exactly as `profile.tsx` already does —
  then `router.replace('/')`.

The onboarding "vibe" step is dropped entirely. `vibe` storage, the
`VIBE_ICONS`/`VIBE_KEYS` constants, `lobby.tsx`'s fallback rendering, and
`useRoomSocket`'s `vibe` field are untouched — they just never get written
during onboarding anymore, so a player who hasn't picked one simply has
`vibe: null`, a state those call sites already handle.

## Sign Out — `app/profile.tsx`

A secondary outlined button (with a `LogOut` lucide icon) below the existing
Save button. On press: a native `Alert.alert` confirm (it's a destructive
local action — losing a saved profile is mildly costly to redo), then on
confirm: `clearIdentity()` → `router.replace('/onboarding')`.

## Error handling

Consistent with existing behavior in this hook (`init()`'s SecureStore reads
already tolerate failure by falling back to an ephemeral id; `setIdentity`/
`setPreferredAvatar` writes are not separately guarded today). `clearIdentity`
follows the same existing convention — no new error-handling pattern
introduced.

## Testing

No frontend automated test suite exists in this repo. Verification is
manual, via the `run` skill: clear local storage → confirm forced redirect
to `/onboarding` → fill name + avatar → confirm CTA enables only once both
are set → submit → land on Lobby → open Profile → Sign Out → confirm redirect
back to `/onboarding` and that storage was actually cleared.
