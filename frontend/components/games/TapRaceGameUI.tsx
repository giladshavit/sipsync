import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  interpolateColor,
  FadeIn,
} from 'react-native-reanimated';
import type { MiniGameProps } from '../ActiveGameScreen';
import { colors, typography } from '@/constants/design';

const RACE_MS = 10_000;
const COUNTDOWN_MS = 3_000; // must match the backend's _COUNTDOWN_MS
// How long before the end the background starts shifting toward red
const URGENCY_MS = 3_000;

type Phase = 'countdown' | 'tapping' | 'done';

export const TapRaceGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [countdownDigit, setCountdownDigit] = useState(3);
  const [count, setCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RACE_MS / 1000);

  // Refs so timers and the final report never read stale state
  const countRef = useRef(0);
  const phaseRef = useRef<Phase>('countdown');
  const reportedRef = useRef(false);

  // Counter pulse on every tap + race-end urgency tint, both on the UI thread
  const pulse = useSharedValue(1);
  const urgency = useSharedValue(0);
  const barProgress = useSharedValue(1);
  // Countdown "pour": amber rises from the bottom like a glass filling over
  // 3 s — when it reaches the top, the screen IS the amber tap arena.
  const pour = useSharedValue(0);
  const digitScale = useSharedValue(1);

  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      urgency.value,
      [0, 1],
      [colors.amber, colors.stop],
    ),
  }));
  const counterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));
  const barStyle = useAnimatedStyle(() => ({
    width: `${barProgress.value * 100}%` as `${number}%`,
  }));
  const pourStyle = useAnimatedStyle(() => ({
    height: `${pour.value * 100}%` as `${number}%`,
  }));
  const digitStyle = useAnimatedStyle(() => ({
    transform: [{ scale: digitScale.value }],
  }));

  const startAt = typeof gameState.start_at === 'number' ? gameState.start_at : 0;
  const endAt = typeof gameState.end_at === 'number' ? gameState.end_at : 0;

  useEffect(() => {
    if (!startAt || !endAt) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    // Server UTC → local device time (same correction as the reflex game)
    const startLocal = startAt - clockOffset;
    const endLocal = endAt - clockOffset;

    // Start the pour, catching up if this client mounted mid-countdown
    const cdLeft = Math.max(0, startLocal - Date.now());
    pour.value = 1 - cdLeft / COUNTDOWN_MS;
    pour.value = withTiming(1, { duration: cdLeft, easing: Easing.linear });

    // 3 · 2 · 1 — re-derived from the clock each tick so it can't drift
    const countdownTick = setInterval(() => {
      const left = Math.ceil((startLocal - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(countdownTick);
        return;
      }
      setCountdownDigit(left);
    }, 100);
    intervals.push(countdownTick);

    // GO — open the tap window and start the clock visuals
    timers.push(
      setTimeout(() => {
        phaseRef.current = 'tapping';
        setPhase('tapping');
        const raceLeft = Math.max(0, endLocal - Date.now());
        barProgress.value = withTiming(0, {
          duration: raceLeft,
          easing: Easing.linear,
        });
        urgency.value = withDelay(
          Math.max(0, raceLeft - URGENCY_MS),
          withTiming(1, { duration: URGENCY_MS, easing: Easing.in(Easing.quad) }),
        );

        const secondsTick = setInterval(() => {
          setSecondsLeft(Math.max(0, Math.ceil((endLocal - Date.now()) / 1000)));
        }, 100);
        intervals.push(secondsTick);
      }, Math.max(0, startLocal - Date.now())),
    );

    // TIME — lock input and report the final count exactly once
    timers.push(
      setTimeout(() => {
        phaseRef.current = 'done';
        setPhase('done');
        if (!reportedRef.current) {
          reportedRef.current = true;
          onAction('taps_final', { count: countRef.current });
        }
      }, Math.max(0, endLocal - Date.now())),
    );

    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt, endAt, clockOffset]);

  // Stamp each digit in — heavy drop from oversized to rest
  useEffect(() => {
    digitScale.value = 1.45;
    digitScale.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownDigit]);

  function handleTap() {
    if (phaseRef.current !== 'tapping') return;
    countRef.current += 1;
    setCount(countRef.current);
    pulse.value = withSequence(
      withTiming(1.14, { duration: 45, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
    );
  }

  // ── Countdown: the glass pours — amber rises from the bottom over 3 s,
  // and when it reaches the brim the screen has become the tap arena ───────
  if (phase === 'countdown') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, overflow: 'hidden' }}>
        {/* Rising pour with a foam line at the surface */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: colors.amber,
              borderTopWidth: 4,
              borderTopColor: 'rgba(255,255,255,0.65)',
            },
            pourStyle,
          ]}
        />

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text
            style={{
              color: colors.chalk,
              ...typography.label,
              fontSize: 12,
              letterSpacing: 6,
              textTransform: 'uppercase',
              marginBottom: 6,
              opacity: 0.7,
            }}
          >
            Pouring…
          </Text>

          {/* Stamped digit — chalk reads on both the ink and the rising amber */}
          <Animated.Text
            key={countdownDigit}
            style={[
              {
                color: colors.chalk,
                fontSize: 210,
                lineHeight: 220,
                fontWeight: '900',
                letterSpacing: -8,
              },
              digitStyle,
            ]}
          >
            {countdownDigit}
          </Animated.Text>

          <Text
            style={{
              color: colors.chalk,
              fontSize: 15,
              marginTop: 6,
              opacity: 0.7,
            }}
          >
            Tap as fast as you can when it&apos;s full
          </Text>
        </View>
      </View>
    );
  }

  // ── Race + locked end state share the tinted background ─────────────────
  return (
    <Pressable className="flex-1" onPress={handleTap} disabled={phase === 'done'}>
      <Animated.View style={[{ flex: 1 }, bgStyle]}>
        {/* Time bar + seconds, pinned top */}
        <View style={{ paddingTop: 64, paddingHorizontal: 24 }}>
          <View
            style={{
              height: 8,
              borderWidth: 1,
              borderColor: 'rgba(10,10,15,0.55)',
              padding: 1,
            }}
          >
            <Animated.View
              style={[{ height: '100%', backgroundColor: colors.ink }, barStyle]}
            />
          </View>
          <Text
            style={{
              color: colors.ink,
              ...typography.label,
              fontWeight: '700',
              fontSize: 13,
              letterSpacing: 3,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            {phase === 'done' ? 'TIME!' : `${secondsLeft}S LEFT`}
          </Text>
        </View>

        {/* Live counter */}
        <View className="flex-1 items-center justify-center">
          <Animated.Text
            style={[
              {
                color: colors.ink,
                fontSize: 132,
                lineHeight: 140,
                fontWeight: '900',
                letterSpacing: -5,
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
              fontSize: 13,
              letterSpacing: 5,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            taps
          </Text>

          {phase === 'done' && (
            <Animated.Text
              entering={FadeIn.delay(250).duration(300)}
              style={{ color: 'rgba(10,10,15,0.7)', fontSize: 15, marginTop: 28 }}
            >
              Waiting for the others…
            </Animated.Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
};
