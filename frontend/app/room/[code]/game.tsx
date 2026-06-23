import { useEffect } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { ActiveGameScreen } from '@/components/ActiveGameScreen';

export default function GameScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { playerId } = usePlayerIdentity();
  const { snapshot, send, outcomesRef } = useRoomSocket(code);

  // Our clock offset is stored server-side and echoed back in ROOM_STATE players
  const clockOffset =
    playerId && snapshot?.players[playerId]
      ? snapshot.players[playerId].clock_offset
      : 0;

  function onAction(action: string, payload?: Record<string, unknown>) {
    send({ type: 'GAME_ACTION', payload: { action, ...payload } });
  }

  useEffect(() => {
    if (snapshot?.state === 'PERSONAL_SUMMARY' && playerId) {
      const myOutcome = outcomesRef.current[playerId];
      router.replace({
        pathname: '/room/[code]/summary',
        params: { code, outcomeJson: myOutcome ? JSON.stringify(myOutcome) : '' },
      });
    }
  }, [snapshot?.state, code, playerId]);

  return (
    <View className="flex-1">
      <ActiveGameScreen
        gameId={snapshot?.activeGameId ?? null}
        gameState={snapshot?.gameState}
        onAction={onAction}
        clockOffset={clockOffset}
      />
    </View>
  );
}
