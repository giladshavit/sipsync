import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, router } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { colors } from '@/constants/design';
import type { PlayerOutcome } from '@/hooks/useRoomSocket';

const LOCK_MS = 6_000;

export default function SummaryScreen() {
  const { code, outcomeJson } = useLocalSearchParams<{
    code: string;
    outcomeJson: string;
  }>();

  const { playerId } = usePlayerIdentity();
  const { snapshot, send } = useRoomSocket(code);
  const navigation = useNavigation();

  const outcome: PlayerOutcome | null = (() => {
    try { return outcomeJson ? JSON.parse(outcomeJson) : null; } catch { return null; }
  })();

  const [lockExpired, setLockExpired] = useState(false);
  const lockExpiredRef = useRef(false);

  const isAdmin = !!snapshot && snapshot.admin_id === playerId;
  const displayName =
    (playerId && snapshot?.players[playerId]?.display_name) ?? 'You';

  // ── Reanimated countdown bar: 1 → 0 over LOCK_MS ──────────────────────────
  const progress = useSharedValue(1);
  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as `${number}%`,
  }));

  // ── LOSE flash: brief white-overlay pulse on mount ─────────────────────────
  const flashOpacity = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  useEffect(() => {
    progress.value = withTiming(0, { duration: LOCK_MS, easing: Easing.linear });

    if (outcome?.result === 'LOSE') {
      flashOpacity.value = withSequence(
        withTiming(0.35, { duration: 80 }),
        withTiming(0, { duration: 200 }),
        withTiming(0.25, { duration: 80 }),
        withTiming(0, { duration: 300 }),
      );
    }

    const timer = setTimeout(() => {
      lockExpiredRef.current = true;
      setLockExpired(true);
    }, LOCK_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Block all back navigation for the full 6 s ────────────────────────────
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!lockExpiredRef.current) e.preventDefault();
    });
    return unsubscribe;
  }, [navigation]);

  // ── Navigate on FSM transitions ───────────────────────────────────────────
  useEffect(() => {
    if (snapshot?.state === 'LOBBY') {
      router.replace(`/room/${code}/lobby`);
    }
    if (snapshot?.state === 'PODIUM') {
      router.replace({
        pathname: `/room/${code}/podium`,
        params: { outcomeJson: outcomeJson ?? '' },
      });
    }
  }, [snapshot?.state, code, outcomeJson]);

  function handleNextRound() { send({ type: 'NEXT_ROUND' }); }
  function handleEndGame()   { send({ type: 'GOTO_PODIUM' }); }

  // ── Derived display values ─────────────────────────────────────────────────
  const result = outcome?.result ?? 'SAFE';
  const bgColor =
    result === 'WIN'  ? colors.go :
    result === 'LOSE' ? colors.stop :
    colors.surface;

  const headlineText =
    result === 'WIN'  ? 'WIN' :
    result === 'LOSE' ? 'DRINK' :
    'SAFE';

  const deltaLine =
    result === 'WIN'  ? `+${outcome?.score_delta ?? 0} pts` :
    result === 'LOSE' ? `−${outcome?.score_delta ?? 0} pts` :
    null;

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />

      <View className="flex-1" style={{ backgroundColor: bgColor }}>
        {result === 'LOSE' && (
          <Animated.View
            className="absolute inset-0 bg-white"
            style={flashStyle}
            pointerEvents="none"
          />
        )}

        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white/70 text-sm font-mono tracking-widest uppercase mb-2">
            {displayName}
          </Text>

          <Text
            className="text-white font-bold text-center"
            style={{ fontSize: 72, lineHeight: 80, letterSpacing: -2 }}
          >
            {headlineText}
          </Text>

          {result === 'LOSE' && outcome && (
            <Text className="text-white text-3xl font-semibold mt-3">
              {outcome.chasers} {outcome.chasers === 1 ? 'chaser' : 'chasers'} 🥃
            </Text>
          )}

          {deltaLine && (
            <Text className="text-white/80 text-xl mt-2">{deltaLine}</Text>
          )}

          <Text className="text-white/50 text-base mt-3">
            Total: {outcome?.total_score ?? '—'} pts
          </Text>
        </View>

        <View className="px-6 pb-4">
          <View
            style={{
              height: 4,
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <Animated.View
              style={[
                { height: '100%', backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 2 },
                barStyle,
              ]}
            />
          </View>

          <View className="mt-6 min-h-[52px] items-center justify-center">
            {lockExpired ? (
              isAdmin ? (
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={handleNextRound}
                    className="flex-1 bg-white/20 border border-white/40 rounded-2xl py-4 items-center active:opacity-70"
                  >
                    <Text className="text-white text-base font-bold">Next Round</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleEndGame}
                    className="flex-1 bg-white/10 border border-white/20 rounded-2xl py-4 items-center active:opacity-70"
                  >
                    <Text className="text-white/70 text-base font-semibold">End Game</Text>
                  </Pressable>
                </View>
              ) : (
                <Text className="text-white/50 text-sm">Waiting for host…</Text>
              )
            ) : (
              <Text className="text-white/40 text-xs font-mono tracking-widest">
                MANDATORY WINDOW
              </Text>
            )}
          </View>
        </View>
      </View>
    </>
  );
}
