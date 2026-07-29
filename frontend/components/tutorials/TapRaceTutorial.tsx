import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';

const TAP_INTERVAL_MS = 380;
const TAPS_PER_CYCLE = 9;

export function TapRaceTutorial(): React.ReactElement {
  const fingerScale = useSharedValue(1);
  const fingerOpacity = useSharedValue(0);
  const counterPulse = useSharedValue(1);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    function startCycle() {
      setCount(0);
      fingerOpacity.value = withTiming(1, { duration: 250 });

      for (let i = 0; i < TAPS_PER_CYCLE; i++) {
        timers.push(
          setTimeout(() => {
            setCount(i + 1);
            fingerScale.value = withSequence(
              withTiming(0.8, { duration: 90, easing: Easing.in(Easing.quad) }),
              withTiming(1.0, { duration: 140, easing: Easing.out(Easing.quad) }),
            );
            counterPulse.value = withSequence(
              withTiming(1.12, { duration: 60 }),
              withTiming(1, { duration: 110 }),
            );
          }, 400 + i * TAP_INTERVAL_MS),
        );
      }

      // Runs once and holds on the final count — replay button re-triggers it
      timers.push(
        setTimeout(() => {
          fingerOpacity.value = withTiming(0, { duration: 200 });
        }, 400 + TAPS_PER_CYCLE * TAP_INTERVAL_MS),
      );
    }

    startCycle();

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(fingerScale);
      cancelAnimation(fingerOpacity);
      cancelAnimation(counterPulse);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [{ scale: fingerScale.value }],
  }));

  const counterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: counterPulse.value }],
  }));

  return (
    <View className="items-center">
      {/* Phone-in-phone container — matches ReflexTutorial's frame */}
      <View
        className="items-center overflow-hidden"
        style={{
          width: 288,
          height: 450,
          backgroundColor: colors.surface,
          borderRadius: 34,
          borderWidth: 2,
          borderColor: colors.rim,
        }}
      >
        {/* Speaker grill */}
        <View
          style={{
            width: 80,
            height: 5,
            backgroundColor: colors.rim,
            borderRadius: 2,
            marginTop: 18,
            marginBottom: 14,
          }}
        />

        {/* Simulated game screen */}
        <View
          style={{
            flex: 1,
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.amber,
          }}
        >
          {/* Live counter — climbs with every press */}
          <Animated.Text
            style={[
              {
                color: colors.ink,
                fontSize: 84,
                lineHeight: 92,
                fontWeight: '900',
                letterSpacing: -3,
              },
              counterStyle,
            ]}
          >
            {count}
          </Animated.Text>
          <Text
            style={{
              color: 'rgba(10,10,15,0.65)',
              ...typography.label,
              fontSize: 11,
              letterSpacing: 4,
              textTransform: 'uppercase',
            }}
          >
            taps
          </Text>

          {/* Tapping finger — sits below the counter, pressing rapidly */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                bottom: 60,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.5,
                shadowRadius: 16,
                elevation: 12,
              },
              fingerStyle,
            ]}
          >
            <Image
              source={require('@/assets/images/tap-gesture.png')}
              style={{ width: 72, height: 72 }}
            />
          </Animated.View>
        </View>

        {/* Home bar */}
        <View
          style={{
            width: 90,
            height: 5,
            backgroundColor: colors.fog,
            borderRadius: 2,
            marginVertical: 14,
            opacity: 0.35,
          }}
        />
      </View>
    </View>
  );
}
