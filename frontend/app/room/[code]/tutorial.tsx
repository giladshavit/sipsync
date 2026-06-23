import { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { colors } from '@/constants/design';

const DURATION_MS = 5_000;

const TUTORIAL_TEXT: Record<string, string> = {
  'tutorial.red_light_green_light':
    'When the screen turns GREEN — tap as fast as you can.\nTap during RED and you drink immediately.',
};

export default function TutorialScreen() {
  const { code, tutorialType: _tutorialType, tutorialAsset } = useLocalSearchParams<{
    code: string;
    tutorialType: string;
    tutorialAsset: string;
  }>();

  const { snapshot, send } = useRoomSocket(code);

  // Stable ref so the setTimeout closure always calls the latest send
  const sendRef = useRef(send);
  sendRef.current = send;

  // Animated countdown bar: 1 → 0 over DURATION_MS on the native UI thread
  const progress = useSharedValue(1);
  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as `${number}%`,
  }));

  // Start countdown on mount — no skip possible
  useEffect(() => {
    progress.value = withTiming(0, { duration: DURATION_MS, easing: Easing.linear });

    const timer = setTimeout(() => {
      // Everyone sends; server silently ignores non-admin senders
      sendRef.current({ type: 'TUTORIAL_DONE' });
    }, DURATION_MS);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigate when server confirms PLAYING
  useEffect(() => {
    if (snapshot?.state === 'PLAYING') {
      router.replace({ pathname: '/room/[code]/game', params: { code } });
    }
  }, [snapshot?.state, code]);

  const text =
    TUTORIAL_TEXT[tutorialAsset] ??
    'Get ready for the next round!';

  return (
    <View className="flex-1 bg-ink px-6 pt-20">
      <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-4">
        How to play
      </Text>

      <Text className="text-chalk text-2xl font-bold leading-snug mb-12">
        {text}
      </Text>

      {/* Countdown bar — mandatory, no skip */}
      <View
        style={{
          height: 6,
          backgroundColor: colors.surface,
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[
            { height: '100%', backgroundColor: colors.amber, borderRadius: 3 },
            barStyle,
          ]}
        />
      </View>

      <Text className="text-fog text-xs mt-3 text-center">
        Starting in 5 seconds…
      </Text>
    </View>
  );
}
