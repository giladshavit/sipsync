import React from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  withRepeat,
  Easing,
  FadeIn,
  useReducedMotion,
} from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';

const GLASS_WIDTH = 58;
const GLASS_HEIGHT = 82;
const FOAM_HEIGHT = 5;

// One full pour-then-drink cycle: pour up, sit for a beat, drain (someone
// drank it), rest empty, repeat.
const POUR_MS = 1_500;
const HOLD_MS = 450;
const DRAIN_MS = 700;
const EMPTY_MS = 350;

// Liquid never animates to a true 0 height — a hairline of amber stays at
// the bottom so the foam bar doesn't collapse onto the glass floor and pop.
const EMPTY_FILL = 0.03;

// Bubbles live INSIDE the clipped liquid view, so they are only ever visible
// where there is liquid — no gating logic needed, the drain hides them.
const BUBBLES = [
  { left: 10, size: 5, delayMs: 0, durationMs: 1_400 },
  { left: 27, size: 7, delayMs: 500, durationMs: 1_700 },
  { left: 41, size: 4, delayMs: 950, durationMs: 1_200 },
];

function Bubble({ left, size, delayMs, durationMs }: (typeof BUBBLES)[number]) {
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1),
    );
  }, [progress, delayMs, durationMs]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -progress.value * (GLASS_HEIGHT * 0.8) }],
    // Fade in quickly at the bottom, fade out near the surface
    opacity: progress.value < 0.15 ? progress.value / 0.15 : 1 - (progress.value - 0.15) / 0.85,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          bottom: 4,
          left,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(252, 211, 77, 0.9)',
        },
        style,
      ]}
    />
  );
}

/**
 * Branded loading state for the beat between navigating into the game screen
 * and the WebSocket snapshot arriving: a glass pours full of amber, someone
 * drinks it, repeat. Content fades in after a short delay so sub-150ms gaps
 * show only the ink background instead of flashing anything at all.
 */
export function RoundLoader({ label = 'Pouring the next round' }: { label?: string }) {
  const reducedMotion = useReducedMotion();
  const fill = useSharedValue(reducedMotion ? 0.66 : EMPTY_FILL);

  React.useEffect(() => {
    if (reducedMotion) return;
    fill.value = withRepeat(
      withSequence(
        withTiming(1, { duration: POUR_MS, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: HOLD_MS }),
        withTiming(EMPTY_FILL, { duration: DRAIN_MS, easing: Easing.in(Easing.quad) }),
        withTiming(EMPTY_FILL, { duration: EMPTY_MS }),
      ),
      -1,
    );
  }, [fill, reducedMotion]);

  const liquidStyle = useAnimatedStyle(() => ({
    height: fill.value * (GLASS_HEIGHT - 4),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <Animated.View
        entering={FadeIn.delay(150).duration(300)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <View
          style={{
            width: GLASS_WIDTH,
            height: GLASS_HEIGHT,
            borderWidth: 2.5,
            borderTopWidth: 0,
            borderColor: 'rgba(240, 240, 232, 0.3)',
            borderBottomLeftRadius: 10,
            borderBottomRightRadius: 10,
          }}
        >
          <View
            style={{
              flex: 1,
              overflow: 'hidden',
              borderBottomLeftRadius: 7,
              borderBottomRightRadius: 7,
              justifyContent: 'flex-end',
            }}
          >
            <Animated.View
              style={[{ backgroundColor: colors.amber, overflow: 'hidden' }, liquidStyle]}
            >
              <View style={{ height: FOAM_HEIGHT, backgroundColor: colors.amberGlow }} />
              {!reducedMotion && BUBBLES.map((b) => <Bubble key={b.left} {...b} />)}
            </Animated.View>
          </View>
          {/* Glass shine: a faint vertical highlight on the left wall */}
          <View
            style={{
              position: 'absolute',
              top: 8,
              bottom: 10,
              left: 5,
              width: 2,
              borderRadius: 1,
              backgroundColor: 'rgba(240, 240, 232, 0.18)',
            }}
          />
        </View>
        <Text
          style={{
            ...typography.label,
            marginTop: 24,
            fontSize: 11,
            color: colors.fog,
          }}
        >
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}
