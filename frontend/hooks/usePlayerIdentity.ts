import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from '../lib/secureStorage';

function uuidv4(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      id += '-';
    } else if (i === 14) {
      id += '4';
    } else if (i === 19) {
      id += hex[(Math.random() * 4 | 0) + 8];
    } else {
      id += hex[Math.random() * 16 | 0];
    }
  }
  return id;
}

const KEY_PLAYER_ID = 'sipsync.player_id';
const KEY_DISPLAY_NAME = 'sipsync.display_name';
const KEY_VIBE = 'sipsync.vibe';

interface PlayerIdentity {
  playerId: string | null;
  displayName: string | null;
  /** Key into VIBE_ICONS — the player's chosen icon, picked at onboarding. */
  vibe: string | null;
  isOnboarded: boolean;
  setIdentity: (name: string, vibe: string | null) => Promise<void>;
  isLoading: boolean;
}

export function usePlayerIdentity(): PlayerIdentity {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [vibe, setVibeState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        let id = await SecureStore.getItemAsync(KEY_PLAYER_ID);
        if (!id) {
          id = uuidv4();
          await SecureStore.setItemAsync(KEY_PLAYER_ID, id);
        }
        const name = await SecureStore.getItemAsync(KEY_DISPLAY_NAME);
        const storedVibe = await SecureStore.getItemAsync(KEY_VIBE);
        setPlayerId(id);
        setDisplayNameState(name);
        setVibeState(storedVibe);
      } catch (e) {
        // Fallback: generate an ephemeral ID so the app still works
        setPlayerId(uuidv4());
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const setIdentity = useCallback(async (name: string, newVibe: string | null) => {
    await SecureStore.setItemAsync(KEY_DISPLAY_NAME, name);
    if (newVibe) {
      await SecureStore.setItemAsync(KEY_VIBE, newVibe);
    }
    setDisplayNameState(name);
    setVibeState(newVibe);
  }, []);

  return {
    playerId,
    displayName,
    vibe,
    isOnboarded: displayName !== null,
    setIdentity,
    isLoading,
  };
}
