import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/constants/design';

const RED_MS = 2_000;
const TAP_OFFSET_MS = 500;

export function ReflexTutorial(): React.ReactElement {
  const bgProgress = useSharedValue(0); // 0 = RED, 1 = GREEN
  const fingerScale = useSharedValue(1);
  const fingerOpacity = useSharedValue(0);
  const fingerTranslateY = useSharedValue(160);
  const [isGreen, setIsGreen] = useState(false);
  const [isTapped, setIsTapped] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    function startCycle() {
      setIsGreen(false);
      setIsTapped(false);
      bgProgress.value = withTiming(0, { duration: 120 });
      fingerOpacity.value = 0;
      fingerScale.value = 1;
      fingerTranslateY.value = 160;

      // t = 1.6 s → finger glides up into hover position 400 ms before green
      timers.push(
        setTimeout(() => {
          fingerOpacity.value = withTiming(1, { duration: 300 });
          fingerTranslateY.value = withTiming(80, {
            duration: 400,
            easing: Easing.out(Easing.quad),
          });
        }, RED_MS - 400),
      );

      // t = 2 s → go GREEN (finger already arriving at hover position)
      timers.push(
        setTimeout(() => {
          setIsGreen(true);
          bgProgress.value = withTiming(1, {
            duration: 150,
            easing: Easing.out(Easing.quad),
          });
        }, RED_MS),
      );

      // t = 2.5 s → press animation + update label
      timers.push(
        setTimeout(() => {
          setIsTapped(true);
          fingerScale.value = withSequence(
            withTiming(0.78, { duration: 120, easing: Easing.in(Easing.quad) }),
            withTiming(1.0, { duration: 220, easing: Easing.out(Easing.quad) }),
          );
        }, RED_MS + TAP_OFFSET_MS),
      );

    }

    startCycle();

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(bgProgress);
      cancelAnimation(fingerScale);
      cancelAnimation(fingerOpacity);
      cancelAnimation(fingerTranslateY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const screenBgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      bgProgress.value,
      [0, 1],
      [colors.stop, colors.go],
    ),
  }));

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [
      { translateY: fingerTranslateY.value },
      { scale: fingerScale.value },
    ],
  }));

  const label = isTapped ? 'Tapped!' : isGreen ? 'TAP!' : 'WAIT...';

  return (
    <View className="items-center">
      {/* Instructional text */}
      <Text
        className="text-chalk text-base font-bold text-center mb-5"
        style={{ maxWidth: 280 }}
      >
        {'When the screen turns '}
        <Text className="text-go">GREEN</Text>
        {' — tap as fast as you can!'}
      </Text>

      {/* Phone-in-phone container — w-72 × 450 px */}
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
        <Animated.View
          style={[
            {
              flex: 1,
              width: '100%',
              alignItems: 'center',
              justifyContent: 'center',
            },
            screenBgStyle,
          ]}
        >
          {/* WAIT... / TAP! / Tapped! label */}
          <Text
            style={{
              color: '#FFFFFF',
              fontSize: 38,
              fontWeight: '900',
              letterSpacing: 4,
              textAlign: 'center',
            }}
          >
            {label}
          </Text>

          {/* Tap image: absolutely centered, visible only after GREEN */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
              },
              fingerStyle,
            ]}
          >
            <View
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.5,
                shadowRadius: 16,
                elevation: 12,
              }}
            >
              <Image
                source={require('@/assets/images/tap-gesture.png')}
                style={{ width: 72, height: 72 }}
              />
            </View>
          </Animated.View>
        </Animated.View>

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
