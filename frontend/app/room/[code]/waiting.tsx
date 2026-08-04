import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { ArrowLeft, Hourglass } from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { colors, typography } from '@/constants/design';
import { AvatarCircle } from '@/components/games/SharedChaserDistributor';

// Late Join: this screen holds a mid-round arrival until the round they
// missed actually finishes. The server clears `waiting_for_next_game` (and
// broadcasts it) once it does, but the more immediate, reliable signal is
// the FSM itself moving past PLAYING — no need to wait on the player-record
// round trip when the state transition already says the round is over.
export default function WaitingRoomScreen() {
  useWebPageBackground(colors.ink);
  const { code } = useLocalSearchParams<{ code: string }>();
  const { playerId } = usePlayerIdentity();
  const { snapshot, send, leave, dissolved } = useRoomSocket(code);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  useEffect(() => {
    if (dissolved) router.replace('/');
  }, [dissolved]);

  useEffect(() => {
    if (snapshot?.state === 'PERSONAL_SUMMARY' || snapshot?.state === 'PODIUM') {
      router.replace({ pathname: '/room/[code]/podium', params: { code } });
    }
  }, [snapshot?.state, code]);

  // Gentle breathing scale on the hourglass — ambient, not attention-grabbing;
  // the whole point of this screen is "nothing to do right now."
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  function handleLeave() {
    leave();
    router.replace('/');
  }

  const roster = Object.entries(snapshot?.players ?? {}).filter(([pid]) => pid !== playerId);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }} className="px-6 pt-16 pb-10">
      <Pressable
        onPress={() => setConfirmingLeave(true)}
        style={{
          width: 42,
          height: 42,
          borderWidth: 2,
          borderColor: colors.fog,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
        className="active:opacity-60"
      >
        <ArrowLeft size={20} color={colors.chalk} />
      </Pressable>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <Animated.View entering={FadeInDown.duration(400)} style={pulseStyle}>
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              borderWidth: 2,
              borderColor: colors.amber,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Hourglass size={34} color={colors.amber} strokeWidth={2} />
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80).duration(400)} style={{ alignItems: 'center' }}>
          <Text
            style={{
              color: colors.amber,
              ...typography.label,
              fontSize: 11,
              letterSpacing: 4,
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            Round in progress
          </Text>
          <Text
            style={{ fontWeight: '200', color: colors.chalk, fontSize: 34, lineHeight: 38, letterSpacing: -1.5, textAlign: 'center' }}
          >
            Round&apos;s
          </Text>
          <Text
            style={{ fontWeight: '900', color: colors.amber, fontSize: 34, lineHeight: 38, letterSpacing: -1.5, textAlign: 'center' }}
          >
            already live
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(140).duration(400)}>
          <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 260 }}>
            You&apos;ll jump in the moment this one wraps up — no need to do anything.
          </Text>
        </Animated.View>

        {roster.length > 0 && (
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginTop: 8, width: '100%' }}>
            <Text
              style={{
                color: colors.fog,
                ...typography.label,
                fontSize: 9,
                letterSpacing: 2.5,
                textAlign: 'center',
                marginBottom: 10,
              }}
            >
              Already playing
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 14, paddingHorizontal: 12, justifyContent: 'center', flexGrow: 1 }}
            >
              {roster.map(([pid, p]) => (
                <View key={pid} style={{ alignItems: 'center', width: 52, opacity: p.connected === false ? 0.4 : 1 }}>
                  <AvatarCircle name={p.display_name} avatar={p.avatar} size={44} ringColor={colors.rim} />
                  <Text numberOfLines={1} style={{ color: colors.fog, fontSize: 10, marginTop: 5, maxWidth: 52 }}>
                    {p.display_name}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        )}
      </View>

      {confirmingLeave && (
        <Animated.View
          entering={FadeIn.duration(150)}
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              alignSelf: 'stretch',
              backgroundColor: colors.surface,
              borderWidth: 2,
              borderColor: colors.rim,
              padding: 24,
            }}
          >
            <Text style={{ fontWeight: '900', color: colors.chalk, fontSize: 24, letterSpacing: -0.5, marginBottom: 8 }}>
              Leave the room?
            </Text>
            <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
              You can rejoin anytime with the code.
            </Text>
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => setConfirmingLeave(false)}
                className="bg-amber py-4 items-center rounded-none active:opacity-80"
              >
                <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                  Stay
                </Text>
              </Pressable>
              <Pressable
                onPress={handleLeave}
                style={{ borderWidth: 2, borderColor: colors.stop }}
                className="py-4 items-center rounded-none active:opacity-60"
              >
                <Text style={{ color: colors.stop }} className="text-sm font-bold tracking-[0.18em] uppercase">
                  Leave room
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}
