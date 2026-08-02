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
