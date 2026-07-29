import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import type { MiniGameProps } from '../ActiveGameScreen';
import { colors, typography } from '@/constants/design';

// Mirrors the backend's straggler grace: target + worst-error-so-far + 10 s
const STRAGGLER_GRACE_MS = 10_000;

type Phase = 'reveal' | 'countdown' | 'counting' | 'tapped';

export const HumanTimerGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const [phase, setPhase] = useState<Phase>('reveal');
  const [countdownDigit, setCountdownDigit] = useState(3);
  const [elapsedAtTap, setElapsedAtTap] = useState<number | null>(null);

  const phaseRef = useRef<Phase>('reveal');

  // Countdown digit stamp (UI-thread)
  const digitScale = useSharedValue(1);

  const digitStyle = useAnimatedStyle(() => ({
    transform: [{ scale: digitScale.value }],
  }));

  const targetS = typeof gameState.target_s === 'number' ? gameState.target_s : 0;
  const countdownAt =
    typeof gameState.countdown_at === 'number' ? gameState.countdown_at : 0;
  const startAt = typeof gameState.start_at === 'number' ? gameState.start_at : 0;
  const taps = (gameState.taps ?? {}) as Record<string, number>;

  // ── Phase schedule: reveal → countdown → counting ─────────────────────────
  useEffect(() => {
    if (!countdownAt || !startAt) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    const countdownLocal = countdownAt - clockOffset;
    const startLocal = startAt - clockOffset;

    timers.push(
      setTimeout(() => {
        if (phaseRef.current !== 'reveal') return;
        phaseRef.current = 'countdown';
        setPhase('countdown');
        const tick = setInterval(() => {
          const left = Math.ceil((startLocal - Date.now()) / 1000);
          if (left > 0) setCountdownDigit(left);
        }, 100);
        intervals.push(tick);
      }, Math.max(0, countdownLocal - Date.now())),
    );

    timers.push(
      setTimeout(() => {
        if (phaseRef.current === 'tapped') return;
        phaseRef.current = 'counting';
        setPhase('counting');
      }, Math.max(0, startLocal - Date.now())),
    );

    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownAt, startAt, clockOffset]);

  // Stamp each countdown digit — heavy drop from oversized to rest
  useEffect(() => {
    digitScale.value = 1.45;
    digitScale.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownDigit]);

  // ── Dynamic deadline watcher (end condition 2) ────────────────────────────
  // Once someone's error can't be beaten by the stragglers, ask the server to
  // close the round; it re-validates against its own clock.
  useEffect(() => {
    if (!startAt || !targetS) return;
    const tapValues = Object.values(taps);
    if (tapValues.length === 0) return;

    const targetMs = targetS * 1_000;
    const startLocal = startAt - clockOffset;
    const worstErr = Math.max(...tapValues.map((e) => Math.abs(e - targetMs)));
    const deadlineLocal = Math.min(
      startLocal + targetMs + worstErr + STRAGGLER_GRACE_MS,
      startLocal + 2 * targetMs,
    );

    const timer = setTimeout(() => {
      onAction('expire');
    }, Math.max(0, deadlineLocal - Date.now()));

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(taps), startAt, targetS, clockOffset]);

  function handleTap() {
    if (phaseRef.current !== 'counting') return;
    const now = Date.now();
    phaseRef.current = 'tapped';
    setPhase('tapped');
    setElapsedAtTap(now - (startAt - clockOffset));
    onAction('tap', { local_ts: now });
  }

  // ── Reveal: the number to hold in your head ──────────────────────────────
  if (phase === 'reveal') {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.ink }}>
        <Animated.View entering={FadeInDown.duration(350)} style={{ alignItems: 'center' }}>
          <Text
            style={{
              color: colors.fog,
              ...typography.label,
              fontSize: 12,
              letterSpacing: 5,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Your target
          </Text>
          <Text
            style={{
              color: colors.amber,
              fontSize: 150,
              lineHeight: 160,
              fontWeight: '900',
              letterSpacing: -6,
            }}
          >
            {targetS}
            <Text style={{ fontSize: 60, fontWeight: '200', letterSpacing: 0 }}>s</Text>
          </Text>
          <Text
            style={{
              color: colors.chalk,
              fontSize: 15,
              marginTop: 16,
              textAlign: 'center',
              maxWidth: 260,
              lineHeight: 22,
            }}
          >
            Count it in your head — no clock. Tap when exactly {targetS} seconds
            have passed.
          </Text>
        </Animated.View>
      </View>
    );
  }

  // ── Countdown: stamped 3 · 2 · 1 ─────────────────────────────────────────
  if (phase === 'countdown') {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.ink }}>
        <Text
          style={{
            color: colors.fog,
            ...typography.label,
            fontSize: 12,
            letterSpacing: 6,
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          Start counting in
        </Text>
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
      </View>
    );
  }

  // ── Tapped: blue confirmation, same language as the reflex game ──────────
  if (phase === 'tapped') {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.tapped }}>
        <Text
          style={{
            color: 'rgba(255,255,255,0.65)',
            ...typography.label,
            fontSize: 12,
            letterSpacing: 5,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          You called it at
        </Text>
        <Text
          style={{
            color: '#FFFFFF',
            fontSize: 76,
            lineHeight: 84,
            fontWeight: '900',
            letterSpacing: -3,
          }}
        >
          {elapsedAtTap != null ? (elapsedAtTap / 1000).toFixed(2) : '—'}s
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 16, marginTop: 10 }}>
          Target: {targetS}s
        </Text>
        <Animated.Text
          entering={FadeIn.delay(400).duration(300)}
          style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 26 }}
        >
          Waiting for the others…
        </Animated.Text>
      </View>
    );
  }

  // ── Counting: dark, silent, completely still — no motion to break focus ──
  return (
    <Pressable className="flex-1" onPress={handleTap}>
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.ink }}>
        <Text
          style={{
            color: colors.fog,
            ...typography.label,
            fontSize: 13,
            letterSpacing: 6,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Count…
        </Text>
        <Text
          style={{
            color: colors.chalk,
            fontSize: 120,
            lineHeight: 130,
            fontWeight: '900',
            letterSpacing: -5,
          }}
        >
          {targetS}
          <Text style={{ fontSize: 48, fontWeight: '200', letterSpacing: 0 }}>s</Text>
        </Text>
        <Text
          style={{
            color: colors.fog,
            fontSize: 14,
            marginTop: 16,
            textAlign: 'center',
          }}
        >
          Tap anywhere when {targetS} seconds are up
        </Text>
      </View>
    </Pressable>
  );
};
