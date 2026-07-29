import type { LucideIcon } from 'lucide-react-native';
import {
  Beer,
  Wine,
  Martini,
  Target,
  Flame,
  Skull,
  PartyPopper,
  Dices,
} from 'lucide-react-native';

// A player's "vibe" — the Lucide icon they pick at onboarding.
// The key is what travels through the WebSocket handshake, so it must stay
// stable across app versions; the icon component is a client-side mapping.
export const VIBE_ICONS: Record<string, LucideIcon> = {
  beer: Beer,
  wine: Wine,
  martini: Martini,
  target: Target,
  flame: Flame,
  skull: Skull,
  party: PartyPopper,
  dice: Dices,
};

export type VibeKey = keyof typeof VIBE_ICONS;

export const VIBE_KEYS = Object.keys(VIBE_ICONS) as VibeKey[];
