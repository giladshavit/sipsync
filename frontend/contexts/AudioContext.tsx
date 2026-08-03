import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AudioPlayer } from 'expo-audio';
import { BGM_TRACKS, SFX_SOURCES, type BGMTrack, type SFXName } from '@/constants/sounds';

const MUTE_STORAGE_KEY = 'sipsync.audio_muted';

// expo-audio's native module is evaluated eagerly the moment anything imports
// it (AudioModule.js calls requireNativeModule at module scope), and it isn't
// bundled into Expo Go (still-beta package — see expo/expo#32982). A static
// `import { createAudioPlayer } from 'expo-audio'` would crash that eager
// evaluation before this file even finishes loading, taking down every route
// that (transitively) imports AudioProvider/useAudio with it. Routing it
// through `require` inside a try/catch defers evaluation to here, where the
// failure can be caught — audio then simply no-ops in Expo Go instead of
// crashing the app. Works fine on web/dev-client too, where the module loads
// normally and this just resolves the real function.
let createAudioPlayer: typeof import('expo-audio').createAudioPlayer | null = null;
try {
  createAudioPlayer = (require('expo-audio') as typeof import('expo-audio')).createAudioPlayer;
} catch {
  createAudioPlayer = null;
}

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

/** Browsers block .play() before a user gesture by rejecting/throwing a
 * `DOMException` named `NotAllowedError`. DOMException isn't guaranteed
 * to exist as a global on native (Hermes), so it's guarded rather than
 * referenced directly. This is narrowed to that specific error name
 * (not just "any DOMException") because other, unrelated DOMExceptions
 * can occur here too and must NOT be treated as an autoplay block: the
 * placeholder zero-byte SFX/BGM assets make `HTMLMediaElement.play()`
 * reject with `NotSupportedError`, and a failed `AsyncStorage`/
 * `localStorage` write can reject with `QuotaExceededError` — both are
 * also `DOMException`s. This is the single source of truth for "is this
 * the autoplay-block signal" — reused both by `playSafely`'s defensive
 * branches below and by the `unhandledrejection` listener in
 * `AudioProvider`, which is the mechanism that actually catches this on
 * the installed expo-audio web build (see note on `playSafely`). */
function isBlockedAutoplayError(error: unknown): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'NotAllowedError'
  );
}

/** Wraps AudioPlayer#play() so that IF a blocked playback attempt were
 * ever surfaced through the call itself — either thrown synchronously or
 * via a returned promise's rejection — it can't crash or leave playback
 * in an inconsistent state; it would fall back to `onBlocked` (which the
 * callers below use to force isMuted back on).
 *
 * On the currently-installed expo-audio web build (0.3.5), this never
 * actually fires: `AudioPlayerWeb.play()` is declared to return `void`
 * and internally calls `HTMLMediaElement.play()` without awaiting,
 * catching, or otherwise propagating the promise it returns, so a
 * blocked-autoplay rejection is never thrown synchronously and never
 * observable through this function's return value — `result` here is
 * always `undefined`, and the try/catch never sees the rejection. That
 * rejection instead escapes as a browser-level `unhandledrejection`
 * event, which is the actual, currently-effective detection mechanism —
 * see the `unhandledrejection` listener registered in `AudioProvider`.
 * This function's try/catch and `.catch()` branches are kept as
 * defensive-only dead code for this library version: harmless, and
 * would matter if a future expo-audio version or another platform ever
 * does throw/reject through the return value instead. */
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
    AsyncStorage.getItem(MUTE_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && stored != null) {
          setIsMuted(stored === 'true');
        }
      })
      .catch(() => {});
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

  // Web-only: catch blocked-autoplay rejections at the browser level.
  // The installed expo-audio web build never awaits or catches the
  // underlying HTMLMediaElement.play() promise it creates internally
  // (see the note on `playSafely` above), so a blocked play() surfaces
  // only as an unhandled promise rejection, not through any expo-audio
  // return value or event. This listener is the only place this library
  // version exposes the failure at all. It's coarse-grained by design —
  // it can't tell which in-flight play() call was blocked — so on a hit
  // it force-mutes globally (in-memory only, see below) and sweeps every
  // currently-tracked SFX player, since any SFX player mid-play() when
  // autoplay got blocked will never fire `didJustFinish` and would
  // otherwise leak forever. The BGM player is deliberately left alone
  // here: it's a persistent, reused instance, not something to remove.
  //
  // Deliberately NOT persisted to AsyncStorage: a blocked autoplay is a
  // transient, per-page-load browser condition, not a choice the user
  // made. Persisting it would silently mute the app across every future
  // session until the user manually unmutes again, with no visible
  // cause. Only `toggleMute`'s user-initiated path persists.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isBlockedAutoplayError(event.reason)) return;
      event.preventDefault();
      setIsMuted(true);
      activeSfxRef.current.forEach((player) => player.remove());
      activeSfxRef.current.clear();
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const playBGM = (track: BGMTrack) => {
    if (!createAudioPlayer) return;
    if (bgmTrackRef.current === track && bgmPlayerRef.current) {
      return;
    }
    bgmPlayerRef.current?.remove();
    const player = createAudioPlayer(BGM_TRACKS[track]);
    player.loop = true;
    bgmPlayerRef.current = player;
    bgmTrackRef.current = track;
    if (!isMuted) {
      // Force-mute in-memory only on a blocked autoplay — see the
      // `unhandledrejection` listener's comment above for why this
      // isn't persisted.
      playSafely(player, () => setIsMuted(true));
    }
  };

  const playSFX = (name: SFXName) => {
    if (isMuted || !createAudioPlayer) return;
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
    // User-initiated: this is the one path that persists, since it's an
    // actual choice the user made (as opposed to the blocked-autoplay
    // fallback below, which is a transient session-local override —
    // see the `unhandledrejection` listener's comment above).
    const next = !isMuted;
    setIsMuted(next);
    AsyncStorage.setItem(MUTE_STORAGE_KEY, String(next)).catch(() => {});
    const bgm = bgmPlayerRef.current;
    if (!bgm) return;
    if (next) {
      bgm.pause();
    } else {
      playSafely(bgm, () => setIsMuted(true));
    }
  };

  const value = useMemo<AudioContextValue>(
    () => ({ isMuted, toggleMute, playBGM, playSFX }),
    [isMuted],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}
