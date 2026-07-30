import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { usePracticeExit } from '@/hooks/usePracticeExit';
import { PracticeExitButton } from '@/components/PracticeExitButton';
import { ActiveGameScreen, getEndHoldMs, TIE_END_HOLD_MS } from '@/components/ActiveGameScreen';

// Generous grace window between this client seeing its own round resolve
// (gameState.status === 'DONE') and the room-level FSM_TRANSITION to
// PERSONAL_SUMMARY that should follow within a beat — both broadcasts fire
// back-to-back server-side, so a multi-second gap means something didn't
// arrive (dropped packet, a stale pub/sub forwarder — see
// room_service._pubsub_listener's own docstring on this exact failure mode),
// not that the room is still legitimately playing.
const DONE_SELF_HEAL_MS = 5_000;

export default function GameScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { playerId } = usePlayerIdentity();
  const { snapshot, send, outcomesRef, reconnect } = useRoomSocket(code);
  const insets = useSafeAreaInsets();
  const [showContinue, setShowContinue] = useState(false);
  const exitPractice = usePracticeExit(send, snapshot?.activeGameId);

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
      // Let end-of-game animations play out before leaving the game screen —
      // a majority/minority tie runs its own much longer coin-flip reveal.
      const isTie = !!(snapshot.gameState as { tie?: boolean } | undefined)?.tie;
      const hold = isTie
        ? TIE_END_HOLD_MS
        : getEndHoldMs(snapshot.activeGameId, snapshot.gameState as Record<string, unknown>, snapshot.isPractice, playerId);
      const timer = setTimeout(() => {
        router.replace({
          pathname: '/room/[code]/summary',
          params: {
            code,
            outcomeJson: myOutcome ? JSON.stringify(myOutcome) : '',
            allOutcomesJson: JSON.stringify(outcomesRef.current),
          },
        });
      }, hold);
      return () => clearTimeout(timer);
    }
  }, [snapshot?.state, code, playerId]);

  // Self-heal: our own gameState already says the round is over, but the
  // room never followed up with PERSONAL_SUMMARY. Force a fresh connection
  // (re-fetches ROOM_STATE, carrying the room's real current state); if that
  // still hasn't resolved things after the same grace window, surface a
  // manual escape hatch instead of leaving the player stuck with nothing to
  // press — same pattern as summary.tsx's own GOTO_PODIUM self-heal.
  useEffect(() => {
    const status = (snapshot?.gameState as { status?: string } | undefined)?.status;
    if (status !== 'DONE' || snapshot?.state === 'PERSONAL_SUMMARY') {
      setShowContinue(false);
      return;
    }
    const healTimer = setTimeout(reconnect, DONE_SELF_HEAL_MS);
    const buttonTimer = setTimeout(() => setShowContinue(true), DONE_SELF_HEAL_MS);
    return () => {
      clearTimeout(healTimer);
      clearTimeout(buttonTimer);
    };
  }, [snapshot?.gameState, snapshot?.state, reconnect]);

  return (
    <View className="flex-1">
      {snapshot?.isPractice && <PracticeExitButton onPress={exitPractice} />}
      <ActiveGameScreen
        gameId={snapshot?.activeGameId ?? null}
        gameState={snapshot?.gameState}
        onAction={onAction}
        clockOffset={clockOffset}
      />

      {showContinue && (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 24, alignItems: 'center' }}
        >
          <Pressable
            onPress={reconnect}
            style={{
              backgroundColor: '#0A0A0F',
              borderWidth: 1.5,
              borderColor: 'rgba(255,255,255,0.6)',
              paddingVertical: 12,
              paddingHorizontal: 22,
            }}
            className="active:opacity-70"
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12, letterSpacing: 1 }}>
              CONTINUE
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
