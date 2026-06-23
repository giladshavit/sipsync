import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { colors } from '@/constants/design';
import type { PlayerOutcome } from '@/hooks/useRoomSocket';

export default function PodiumScreen() {
  const { code, outcomeJson } = useLocalSearchParams<{
    code: string;
    outcomeJson: string;
  }>();

  const { playerId } = usePlayerIdentity();
  const { snapshot, send, dissolved } = useRoomSocket(code);

  const myOutcome: PlayerOutcome | null = (() => {
    try { return outcomeJson ? JSON.parse(outcomeJson) : null; } catch { return null; }
  })();

  const isAdmin = !!snapshot && snapshot.admin_id === playerId;

  // Rank by cumulative score ascending (fewest chasers = best)
  const ranked = Object.entries(snapshot?.players ?? {})
    .map(([pid, p]) => ({ pid, ...p }))
    .sort((a, b) => a.score - b.score);

  // Navigate when room is dissolved (End Night)
  useEffect(() => {
    if (dissolved) router.replace('/');
  }, [dissolved]);

  // Navigate when admin starts another session (Play Again → LOBBY)
  useEffect(() => {
    if (snapshot?.state === 'LOBBY') {
      router.replace({ pathname: '/room/[code]/lobby', params: { code } });
    }
  }, [snapshot?.state, code]);

  function handlePlayAgain() { send({ type: 'ADMIN_NEXT' }); }
  function handleEndNight()  { send({ type: 'END_NIGHT' }); }

  return (
    <View className="flex-1 bg-ink">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 72, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-1">
            Final scores
          </Text>
          <Text className="text-chalk text-4xl font-bold mb-8">
            Leaderboard
          </Text>
        </Animated.View>

        {/* Ranked rows */}
        {ranked.map((player, index) => {
          const isFirst = index === 0;
          const isLast  = index === ranked.length - 1 && ranked.length > 1;
          const isMe    = player.pid === playerId;

          const medal =
            isFirst ? '👑' :
            isLast  ? '💀' :
            `${index + 1}.`;

          // Last-round delta — only available for the current player
          const delta = isMe && myOutcome ? myOutcome.score_delta : null;
          const deltaLabel =
            delta != null
              ? myOutcome?.result === 'LOSE'
                ? `−${delta} 🥃`
                : `+${delta} ✓`
              : null;

          return (
            <Animated.View
              key={player.pid}
              entering={FadeInDown.delay(index * 80).duration(350)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 14,
                paddingHorizontal: 16,
                marginBottom: 10,
                borderRadius: 16,
                backgroundColor: isMe ? colors.rim : colors.surface,
                borderWidth: 1,
                borderColor: isFirst ? colors.amber : colors.rim,
              }}
            >
              {/* Medal / rank */}
              <Text style={{ fontSize: 22, width: 40 }}>{medal}</Text>

              {/* Name */}
              <Text
                className="flex-1 text-chalk text-base font-semibold"
                numberOfLines={1}
              >
                {player.display_name}
                {isMe ? ' (you)' : ''}
              </Text>

              {/* Last-round delta for current player */}
              {deltaLabel && (
                <Text className="text-fog text-sm mr-3">{deltaLabel}</Text>
              )}

              {/* Total score */}
              <Text
                style={{
                  color: isFirst ? colors.amber : colors.fog,
                  fontWeight: isFirst ? '700' : '400',
                  fontSize: 16,
                }}
              >
                {player.score} pts
              </Text>
            </Animated.View>
          );
        })}

        {/* Admin actions / non-admin waiting */}
        <Animated.View
          entering={FadeInDown.delay(ranked.length * 80 + 100).duration(350)}
          style={{ marginTop: 24 }}
        >
          {isAdmin ? (
            <View style={{ gap: 12 }}>
              <Pressable
                onPress={handlePlayAgain}
                style={{
                  backgroundColor: colors.amber,
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: 'center',
                }}
                className="active:opacity-80"
              >
                <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>
                  Play Again
                </Text>
              </Pressable>

              <Pressable
                onPress={handleEndNight}
                style={{
                  borderWidth: 1,
                  borderColor: colors.rim,
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: 'center',
                }}
                className="active:opacity-70"
              >
                <Text style={{ color: colors.fog, fontSize: 16 }}>
                  End Night
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text className="text-fog text-sm text-center">
              Waiting for host…
            </Text>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
