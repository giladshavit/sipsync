import React, { useEffect, useRef } from 'react';
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
import { ReflexTutorial } from '@/components/tutorials/ReflexTutorial';

const DURATION_MS = 5_000;

const TUTORIAL_COMPONENTS: Record<string, React.FC> = {
  'tutorial.reflex': ReflexTutorial,
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

  const TutorialComponent = tutorialAsset ? (TUTORIAL_COMPONENTS[tutorialAsset] ?? null) : null;

  return (
    <View className="flex-1 bg-ink px-6 pt-20 pb-6">
      <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-4">
        How to play
      </Text>

      {TutorialComponent ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <TutorialComponent />
        </View>
      ) : (
        <Text className="text-chalk text-2xl font-bold leading-snug mb-12">
          Get ready for the next round!
        </Text>
      )}

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
