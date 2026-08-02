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
