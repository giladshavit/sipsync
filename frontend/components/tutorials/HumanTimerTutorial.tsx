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

// Demo scenario: target 10 s, the demo player taps at 7.8 s → 2.2 s off.
// Each stage is a still replica of the real game screen, held long enough
// to read; only the finger and the stage switches move.
const DEMO_TARGET_S = 10;
const DEMO_TAP_S = 7.8;

const TARGET_STAGE_MS = 1_800;   // "your target is 10s"
const COUNTING_STAGE_MS = 1_900; // the silent counting screen

type DemoStage = 'target' | 'counting' | 'result';

export function HumanTimerTutorial(): React.ReactElement {
  const [stage, setStage] = useState<DemoStage>('target');

  const fingerScale = useSharedValue(1);
  const fingerOpacity = useSharedValue(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    function startCycle() {
      setStage('target');
      fingerOpacity.value = 0;
      fingerScale.value = 1;

      // Stage 2: the counting screen, exactly as it looks in the game
      timers.push(
        setTimeout(() => setStage('counting'), TARGET_STAGE_MS),
      );

      const tapAt = TARGET_STAGE_MS + COUNTING_STAGE_MS;

      // Finger glides in shortly before the tap
      timers.push(
        setTimeout(() => {
          fingerOpacity.value = withTiming(1, { duration: 300 });
        }, tapAt - 500),
      );

      // The tap → result screen
      timers.push(
        setTimeout(() => {
          fingerScale.value = withSequence(
            withTiming(0.78, { duration: 120, easing: Easing.in(Easing.quad) }),
            withTiming(1.0, { duration: 200, easing: Easing.out(Easing.quad) }),
          );
          setStage('result');
        }, tapAt),
      );

      timers.push(
        setTimeout(() => {
          fingerOpacity.value = withTiming(0, { duration: 250 });
        }, tapAt + 500),
      );

      // Runs once and holds on the result — replay button re-triggers it
    }

    startCycle();

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(fingerScale);
      cancelAnimation(fingerOpacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [{ scale: fingerScale.value }],
  }));

  return (
    <View className="items-center">
      {/* Phone-in-phone container — matches the other tutorials' frame */}
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
            backgroundColor: stage === 'result' ? colors.tapped : colors.ink,
          }}
        >
          {stage === 'target' && (
            <>
              <Text
                style={{
                  color: colors.fog,
                  ...typography.label,
                  fontSize: 10,
                  letterSpacing: 4,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                Your target
              </Text>
              <Text style={{ color: colors.amber, fontSize: 76, fontWeight: '900', letterSpacing: -3 }}>
                {DEMO_TARGET_S}
                <Text style={{ fontSize: 32, fontWeight: '200' }}>s</Text>
              </Text>
              <Text
                style={{
                  color: colors.chalk,
                  fontSize: 12,
                  marginTop: 12,
                  textAlign: 'center',
                  maxWidth: 200,
                  lineHeight: 17,
                }}
              >
                Tap when exactly {DEMO_TARGET_S} seconds have passed
              </Text>
            </>
          )}

          {stage === 'counting' && (
            <>
              <Text
                style={{
                  color: colors.fog,
                  ...typography.label,
                  fontSize: 11,
                  letterSpacing: 5,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                Count…
              </Text>
              <Text style={{ color: colors.chalk, fontSize: 64, fontWeight: '900', letterSpacing: -2 }}>
                {DEMO_TARGET_S}
                <Text style={{ fontSize: 26, fontWeight: '200' }}>s</Text>
              </Text>
              <Text style={{ color: colors.fog, fontSize: 11, marginTop: 10 }}>
                …no clock, just your gut
              </Text>
            </>
          )}

          {stage === 'result' && (
            <>
              <Text
                style={{
                  color: 'rgba(255,255,255,0.65)',
                  ...typography.label,
                  fontSize: 10,
                  letterSpacing: 4,
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Tapped at
              </Text>
              <Text style={{ color: '#FFFFFF', fontSize: 54, fontWeight: '900', letterSpacing: -2 }}>
                {DEMO_TAP_S}s
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 10 }}>
                {(DEMO_TARGET_S - DEMO_TAP_S).toFixed(1)}s off the target
              </Text>
            </>
          )}

          {/* Tapping finger */}
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
