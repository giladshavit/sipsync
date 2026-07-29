import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/constants/design';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// As time runs out the ring creeps inward on top of the arc depleting and
// the color drifting toward red — three cues instead of one static bar
const MIN_SCALE = 0.9;

interface Props {
  /** Server epoch ms the countdown ends at. Falsy → ring stays full and static. */
  deadlineAt: number;
  /** This device's correction from server time (see useRoomSocket). */
  clockOffset: number;
  totalMs: number;
  /** False freezes the ring and digits at their current value instead of
   * letting an in-flight animation keep winding down past round-end. */
  active?: boolean;
  size?: number;
  strokeWidth?: number;
  /** Unfilled track color — defaults suit a dark screen; pass a light-theme
   * value (e.g. sand) when the ring sits on a light background. */
  trackColor?: string;
  /** Digit readout color. */
  textColor?: string;
  /** Arc color at zero time left — also the "danger" color once
   * lowTimeThresholdMs is crossed, when that prop is set. */
  lowTimeColor?: string;
  /** Arc color at full time left. */
  highTimeColor?: string;
  /**
   * When set, the ring stays highTimeColor for the whole countdown and
   * then switches (with a brief tween, not a gradient) to lowTimeColor
   * once this many ms remain — a discrete "danger zone" cue instead of
   * continuously blending color across the entire duration. Omit for the
   * original smooth full-duration blend (Sacrifice's look, unchanged).
   */
  lowTimeThresholdMs?: number;
  /** 'hundredths' (default, e.g. "12.34") matches Sacrifice's dramatic
   * final-countdown reveal. 'seconds' (e.g. "12") suits a longer, calmer
   * countdown where a ticking hundredths digit would be visual noise. */
  precision?: 'hundredths' | 'seconds';
}

/** Circular, numeric countdown — shared by SacrificeGameUI/SacrificeTutorial
 * (hundredths precision, smooth full-duration color blend) and
 * FlyingBombGameUI/FlyingBombTutorial (whole seconds, a discrete color
 * switch in the last few seconds) so every game using it stays visually
 * consistent with itself. */
export function CountdownRing({
  deadlineAt,
  clockOffset,
  totalMs,
  active = true,
  size = 104,
  strokeWidth = 8,
  trackColor = colors.rim,
  textColor = colors.chalk,
  lowTimeColor = colors.stop,
  highTimeColor = colors.amberGlow,
  lowTimeThresholdMs,
  precision = 'hundredths',
}: Props): React.ReactElement {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useSharedValue(1); // 1 = full time left, 0 = expired
  const ringScale = useSharedValue(1);
  // Only driven when lowTimeThresholdMs is set: 0 until the threshold is
  // crossed, then tweens to 1 — a discrete switch rather than a blend.
  const dangerProgress = useSharedValue(0);

  useEffect(() => {
    if (!deadlineAt) return;
    if (!active) {
      cancelAnimation(progress);
      cancelAnimation(ringScale);
      cancelAnimation(dangerProgress);
      return;
    }
    const remaining = Math.max(0, deadlineAt - clockOffset - Date.now());
    progress.value = Math.min(1, remaining / totalMs);
    progress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    ringScale.value = 1;
    ringScale.value = withTiming(MIN_SCALE, { duration: remaining, easing: Easing.linear });

    if (lowTimeThresholdMs != null) {
      const delayToThreshold = Math.max(0, remaining - lowTimeThresholdMs);
      dangerProgress.value = remaining <= lowTimeThresholdMs ? 1 : 0;
      dangerProgress.value = withDelay(delayToThreshold, withTiming(1, { duration: 250 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, totalMs, active, lowTimeThresholdMs]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
    stroke:
      lowTimeThresholdMs != null
        ? interpolateColor(dangerProgress.value, [0, 1], [highTimeColor, lowTimeColor])
        : interpolateColor(progress.value, [0, 1], [lowTimeColor, highTimeColor]),
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }));

  // Readout ticked on a plain interval and isolated to this one Text — the
  // ring itself stays on the native thread via Reanimated regardless.
  const formatRemaining = (remainingMs: number) =>
    precision === 'seconds'
      ? String(Math.max(0, Math.ceil(remainingMs / 1000)))
      : (remainingMs / 1000).toFixed(2);
  const [display, setDisplay] = useState(() => formatRemaining(totalMs));
  useEffect(() => {
    if (!deadlineAt || !active) return; // inactive → freeze at the last value
    const tick = () => {
      const remaining = Math.max(0, deadlineAt - clockOffset - Date.now());
      setDisplay(formatRemaining(remaining));
    };
    tick();
    const interval = setInterval(tick, precision === 'seconds' ? 200 : 33);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, clockOffset, active, precision]);

  return (
    <Animated.View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        ringStyle,
      ]}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
          animatedProps={ringProps}
        />
      </Svg>
      <Text
        style={{
          // Ticks every frame — tabular-nums keeps each digit the same
          // width so the reading doesn't visually jitter as it counts down,
          // same reason a Courier New (or any monospace) digit display
          // would, without actually needing the monospace font itself.
          fontVariant: ['tabular-nums'],
          fontWeight: '900',
          fontSize: size * (precision === 'seconds' ? 0.34 : 0.22),
          color: textColor,
          letterSpacing: 0.5,
        }}
      >
        {display}
      </Text>
    </Animated.View>
  );
}
