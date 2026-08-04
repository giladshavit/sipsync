import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { usePracticeExit } from '@/hooks/usePracticeExit';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { PracticeExitButton } from '@/components/PracticeExitButton';
import { RoundLoader } from '@/components/RoundLoader';

// Minimal glue screen for practice-vs-bots rooms — there's no one to invite,
// so this skips the real lobby.tsx (its player-count gating, share/invite
// chrome, and admin controls don't apply here) and auto-fires ADMIN_START
// the moment the room's own HANDSHAKE snapshot confirms we're the admin in
// an unstarted LOBBY. The in-room tutorial beat is skipped too — the rules
// screen's own preview video already covers the mechanics, so there's no
// need to sit through it again here — this screen immediately confirms
// TUTORIAL_DONE itself (never rendering tutorial.tsx) and hands off
// straight to the live game screen once the FSM reaches PLAYING.
export default function PracticeStartScreen() {
  useWebPageBackground('#0A0A0F');
  const { code, gameId } = useLocalSearchParams<{ code: string; gameId: string }>();
  const { playerId } = usePlayerIdentity();
  const { snapshot, send } = useRoomSocket(code);
  const startedRef = useRef(false);
  const tutorialDoneRef = useRef(false);
  const exitPractice = usePracticeExit(send, gameId);

  useEffect(() => {
    if (startedRef.current) return;
    if (snapshot?.state === 'LOBBY' && playerId && snapshot.admin_id === playerId) {
      startedRef.current = true;
      send({ type: 'ADMIN_START' });
    }
  }, [snapshot?.state, snapshot?.admin_id, playerId, send]);

  useEffect(() => {
    if (tutorialDoneRef.current) return;
    if (snapshot?.state === 'TUTORIAL') {
      tutorialDoneRef.current = true;
      send({ type: 'TUTORIAL_DONE' });
    }
  }, [snapshot?.state, send]);

  useEffect(() => {
    if (snapshot?.state === 'PLAYING') {
      router.replace({ pathname: '/room/[code]/game', params: { code } });
    }
  }, [snapshot?.state, code]);

  return (
    <View style={{ flex: 1 }}>
      <PracticeExitButton onPress={exitPractice} />
      <RoundLoader label="Setting up your practice round" />
    </View>
  );
}
