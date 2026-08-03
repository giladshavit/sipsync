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
