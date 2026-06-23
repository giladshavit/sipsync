import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import type { MiniGameProps } from '../ActiveGameScreen';
import { colors } from '@/constants/design';

export const ReflexGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const [tapped, setTapped] = useState(false);
  const [phase, setPhase] = useState<'red' | 'green'>('red');
  // Ref so the tap handler always reads the latest phase without stale closure
  const isGreenRef = useRef(false);

  // Drives the RED → GREEN background transition on the native UI thread
  const progress = useSharedValue(0);
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.stop, colors.go],
    ),
  }));

  const executeAt =
    typeof gameState.execute_at === 'number' ? gameState.execute_at : 0;

  useEffect(() => {
    if (!executeAt) return;

    // execute_at is server UTC ms; adjust by our clock offset so the transition
    // fires at the correct physical moment regardless of clock skew
    const delay = Math.max(0, executeAt - clockOffset - Date.now());

    const timer = setTimeout(() => {
      isGreenRef.current = true;
      setPhase('green');
      // Color transition on native UI thread — no JS jank
      progress.value = withTiming(1, {
        duration: 150,
        easing: Easing.out(Easing.quad),
      });
    }, delay);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeAt, clockOffset]);

  function handleTap() {
    if (tapped) return; // block re-tapping
    setTapped(true);
    onAction('tap', { local_ts: Date.now() });
  }

  const isEarlyTap = tapped && !isGreenRef.current;

  const label = tapped
    ? isEarlyTap
      ? 'Too early!'
      : 'Tapped!'
    : phase === 'green'
      ? 'TAP!'
      : 'Wait…';

  return (
    <Pressable className="flex-1" onPress={handleTap}>
      <Animated.View className="flex-1 items-center justify-center" style={bgStyle}>
        <Text
          className="text-white text-5xl font-bold"
          style={{ letterSpacing: 4 }}
        >
          {label}
        </Text>
        {isEarlyTap && (
          <Text className="text-white text-base mt-6 opacity-80">
            You drank during RED
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
};
