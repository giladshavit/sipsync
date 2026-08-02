# Global Audio System — Design

## Summary

Add a global audio system for looping background music (BGM) and one-shot sound effects (SFX) that persists across screen navigation, plus a mute toggle. Built as a React Context provider wrapping the whole app, using `expo-audio` (not the deprecated `expo-av`). This task builds the provider, the asset scaffolding, and a mute button in the lobby — it does not wire `playBGM`/`playSFX` into any actual game screens yet.

## Scope

- New `AudioProvider`/`useAudio()` exposing `isMuted`, `toggleMute()`, `playBGM(track)`, `playSFX(name)`.
- Empty placeholder `.mp3` assets at 5 fixed filenames so `require()` resolves and Metro bundles cleanly with no real audio yet.
- Wrap `frontend/app/_layout.tsx`'s `<Stack>` in `<AudioProvider>`.
- Mute icon button added to the existing lobby top bar.
- Out of scope: calling `playBGM`/`playSFX` from lobby/podium/gameplay screens (separate follow-up once exact trigger moments are decided), crossfading between BGM tracks, a new shared Header component (none exists today — each screen builds its own top bar inline), real audio content (placeholders only; user drops in real files later).

## Library choice

`expo-audio`, not `expo-av`. The app is on Expo SDK 52, where `expo-av` is deprecated and slated for removal in SDK 53. Since this is new code, targeting `expo-audio`'s imperative `createAudioPlayer()` API avoids writing against something already being phased out.

## New files

### `frontend/constants/sounds.ts`

Follows the existing `constants/games.ts` / `constants/vibes.ts` pattern (typed lookup tables, no logic):

```ts
export type BGMTrack = 'lobby' | 'gameplay';
export type SFXName = 'podium' | 'chaser' | 'start';

// Drop real audio files at these exact paths/names — placeholders are
// empty stubs today so Metro can resolve the require() calls below.
export const BGM_TRACKS: Record<BGMTrack, number> = {
  lobby: require('../assets/sounds/lobby-bgm.mp3'),
  gameplay: require('../assets/sounds/game-bgm.mp3'),
};

export const SFX_SOURCES: Record<SFXName, number> = {
  podium: require('../assets/sounds/podium-sfx.mp3'),
  chaser: require('../assets/sounds/chaser-sfx.mp3'),
  start: require('../assets/sounds/start-sfx.mp3'),
};
```

### `frontend/assets/sounds/*.mp3` (new, empty placeholder files)

`lobby-bgm.mp3`, `game-bgm.mp3`, `podium-sfx.mp3`, `chaser-sfx.mp3`, `start-sfx.mp3` — zero-byte files. Metro's asset pipeline only needs the file to exist on disk to resolve `require()`; it doesn't validate audio content. These won't produce sound until replaced with real MP3s.

### `frontend/contexts/AudioContext.tsx`

```ts
interface AudioContextValue {
  isMuted: boolean;
  toggleMute: () => void;
  playBGM: (track: BGMTrack) => void;
  playSFX: (name: SFXName) => void;
}
```

- **BGM**: one `AudioPlayer` held in a ref (`createAudioPlayer`, not the `useAudioPlayer` hook — the provider needs an instance stable across renders and independent of any single component's lifecycle). Tracks which `BGMTrack` is currently loaded in a second ref.
  - `playBGM(track)`: no-op if `track` already loaded. Otherwise: `.remove()` the old player if present, `createAudioPlayer(BGM_TRACKS[track])`, set `.loop = true`, then attempt `.play()` through the shared autoplay-safe helper below (skips actually playing if `isMuted`).
- **SFX**: `playSFX(name)` no-ops if `isMuted`. Otherwise creates a fresh, independent `createAudioPlayer(SFX_SOURCES[name])`, plays it immediately, and removes it via `.remove()` once its `playbackStatusUpdate` listener reports `didJustFinish`. Each call gets its own player instance — this is what lets SFX overlap each other and play over BGM without either interrupting the other, since nothing is ever paused or reused.
- **Mute**: `toggleMute()` flips `isMuted`, persists the new value to `AsyncStorage` (key `sipsync.audio_muted`), and either `.pause()`s the BGM player (muting) or attempts `.play()` on it again (unmuting) via the same autoplay-safe helper.
- **Autoplay-safe play helper**: wraps every `.play()` call (from `playBGM` and from unmuting) in try/catch. On web, a blocked autoplay throws or rejects with a `DOMException`; when caught, `isMuted` is forced back to `true` (and persisted) instead of crashing or leaving playback in an inconsistent state. On native this branch is not expected to trigger.
- **Startup**: on mount, read `sipsync.audio_muted` from `AsyncStorage` (default `false`/unmuted if never set) into `isMuted`. No BGM auto-plays on mount — nothing has called `playBGM` yet since no screen wires it in this task.
- **Cleanup**: provider unmount (in practice, never — it wraps the root `<Stack>`) removes both the BGM player and clears any live SFX players via a cleanup effect.

## `frontend/app/_layout.tsx`

Wrap the existing `<Stack>` in `<AudioProvider>`, inside `SafeAreaProvider`/`GestureHandlerRootView`, no other changes to the existing screen options.

## Mute button — `frontend/app/room/[code]/lobby.tsx`

Add a `Volume2`/`VolumeX` (`lucide-react-native`) icon button into the existing top bar row (next to the back button, ~line 140-160 today), calling `toggleMute()` from `useAudio()`. Icon and hit-target sized/styled consistent with the existing back button (`size={20}`, `colors.ink`). No new shared Header component — matches the codebase's existing pattern of each screen owning its own top bar.

## Dependencies

- `expo-audio` — installed via `npx expo install expo-audio` (resolves the SDK-52-compatible version).
- `@react-native-async-storage/async-storage` — not currently a dependency; installed via `npx expo install @react-native-async-storage/async-storage`.

## Testing

No automated frontend test suite exists in this repo (manually-verified RN/Expo UI throughout). Verification: run `expo start --web`, confirm the bundle builds with no Metro resolution errors from the placeholder assets, open the lobby, and click the mute button repeatedly to confirm `isMuted` toggles with no console errors or crashes (BGM/SFX playback itself can't be meaningfully verified yet since no screen calls `playBGM`/`playSFX` and the placeholder assets are silent).
