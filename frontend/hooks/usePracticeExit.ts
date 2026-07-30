import { useCallback } from 'react';
import { router } from 'expo-router';

type SendFn = (msg: Record<string, unknown>) => void;

// Shared by every screen in the practice-vs-bots flow (practice-start, game,
// summary): tears the practice room down server-side (END_NIGHT — always
// authorized here since the practice player is always admin_id) and sends
// this client straight back to the rules screen it started from, so the
// simulation can be stopped at any moment instead of only at its natural
// end.
export function usePracticeExit(send: SendFn, gameId?: string | null) {
  return useCallback(() => {
    send({ type: 'END_NIGHT' });
    if (gameId) {
      router.replace({ pathname: '/games/[id]', params: { id: gameId } });
    } else {
      router.replace('/');
    }
  }, [send, gameId]);
}
