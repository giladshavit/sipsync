// Meta Pixel events for the web build. The pixel itself is loaded by the
// static HTML shell (app/+html.tsx) only when EXPO_PUBLIC_META_PIXEL_ID is set
// at build time, so on native — and on a web build without an id — this is a
// no-op. Two custom events are what the ad campaign optimises on: a room
// being created (the host — the conversion we pay for) and a room being
// joined (the multiplier every room brings with it).
import { Platform } from 'react-native';

type Fbq = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
  }
}

export type PixelEvent = 'room_created' | 'room_joined';

export function trackPixelEvent(name: PixelEvent, params?: Record<string, string>): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.fbq) return;
  window.fbq('trackCustom', name, params);
}
