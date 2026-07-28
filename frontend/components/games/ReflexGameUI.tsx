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
  const [reactionMs, setReactionMs] = useState<number | null>(null);
  // Ref so the tap handler always reads the latest phase without stale closure
  const isGreenRef = useRef(false);
  // Local device timestamp of the moment the screen actually turned green,
  // used to measure reaction time independent of the color animation duration
  const greenStartRef = useRef<number | null>(null);

  // Drives the RED → GREEN background transition on the native UI thread
  const progress = useSharedValue(0);
  // Drives the transition to blue once tapped, as a clearer confirmation than
  // staying green
  const tapProgress = useSharedValue(0);
  const bgStyle = useAnimatedStyle(() => {
    const baseColor = interpolateColor(
      progress.value,
      [0, 1],
      [colors.stop, colors.go],
    );
    return {
      backgroundColor: interpolateColor(
        tapProgress.value,
        [0, 1],
        [baseColor, colors.tapped],
      ),
    };
  });

  const executeAt =
    typeof gameState.execute_at === 'number' ? gameState.execute_at : 0;

  useEffect(() => {
    if (!executeAt) return;

    // execute_at is server UTC ms; adjust by our clock offset so the transition
    // fires at the correct physical moment regardless of clock skew
    const delay = Math.max(0, executeAt - clockOffset - Date.now());

    const timer = setTimeout(() => {
      isGreenRef.current = true;
      greenStartRef.current = Date.now();
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
    const now = Date.now();
    setTapped(true);
    if (isGreenRef.current && greenStartRef.current !== null) {
      setReactionMs(now - greenStartRef.current);
    }
    tapProgress.value = withTiming(1, {
      duration: 150,
      easing: Easing.out(Easing.quad),
    });
    onAction('tap', { local_ts: now });
  }

  const isEarlyTap = tapped && !isGreenRef.current;

  const label = tapped
    ? isEarlyTap
      ? 'Too early!'
      : 'Tapped!'
    : phase === 'green'
      ? 'TAP!'
      : 'Wait…';

  const reactionLabel =
    reactionMs !== null ? `${(reactionMs / 1000).toFixed(2)}s` : null;

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
        {reactionLabel && (
          <Text className="text-white text-2xl mt-6 opacity-90">
            {reactionLabel}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
};
