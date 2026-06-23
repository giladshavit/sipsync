import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

const KEY_PLAYER_ID = 'sipsync.player_id';
const KEY_DISPLAY_NAME = 'sipsync.display_name';

interface PlayerIdentity {
  playerId: string | null;
  displayName: string | null;
  isOnboarded: boolean;
  setDisplayName: (name: string) => Promise<void>;
  isLoading: boolean;
}

export function usePlayerIdentity(): PlayerIdentity {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      let id = await SecureStore.getItemAsync(KEY_PLAYER_ID);
      if (!id) {
        id = crypto.randomUUID();
        await SecureStore.setItemAsync(KEY_PLAYER_ID, id);
      }
      const name = await SecureStore.getItemAsync(KEY_DISPLAY_NAME);
      setPlayerId(id);
      setDisplayNameState(name);
      setIsLoading(false);
    }
    init();
  }, []);

  const setDisplayName = useCallback(async (name: string) => {
    await SecureStore.setItemAsync(KEY_DISPLAY_NAME, name);
    setDisplayNameState(name);
  }, []);

  return {
    playerId,
    displayName,
    isOnboarded: displayName !== null,
    setDisplayName,
    isLoading,
  };
}
