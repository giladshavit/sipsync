import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
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

// A frozen watch face — outer ring, 12 hour ticks, two static hands at a
// fixed angle. Deliberately non-ticking: this is the one game where a
// moving clock in view would hand players the exact thing the round asks
// them not to have. Pure texture, not a real instrument.
function ClockGlyph({
  cx,
  cy,
  r,
  hourAngle,
  minuteAngle,
  opacity,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  hourAngle: number;
  minuteAngle: number;
  opacity: number;
  color: string;
}) {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI;
    const inner = r * 0.9;
    return {
      key: i,
      x1: cx + Math.cos(a) * inner,
      y1: cy + Math.sin(a) * inner,
      x2: cx + Math.cos(a) * r,
      y2: cy + Math.sin(a) * r,
    };
  });
  const hourRad = (hourAngle * Math.PI) / 180;
  const minRad = (minuteAngle * Math.PI) / 180;
  return (
    <>
      <Circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={1} fill="none" opacity={opacity} />
      {ticks.map((t) => (
        <Line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={color} strokeWidth={1} opacity={opacity} />
      ))}
      <Line
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(hourRad) * r * 0.42}
        y2={cy + Math.sin(hourRad) * r * 0.42}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={opacity}
      />
      <Line
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(minRad) * r * 0.66}
        y2={cy + Math.sin(minRad) * r * 0.66}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={opacity}
      />
    </>
  );
}

// Scattered watch faces bleeding off the corners, plus a faint amber glow
// centered where the target number sits — texture and warmth behind the
// number instead of a flat fill, without competing with it for attention.
function TimerBackdrop() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="timerGlow" cx="50%" cy="40%" r="55%">
            <Stop offset="0%" stopColor={colors.amber} stopOpacity={0.08} />
            <Stop offset="100%" stopColor={colors.amber} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#timerGlow)" />
        <ClockGlyph cx={width * -0.1} cy={height * 0.06} r={width * 0.46} hourAngle={-35} minuteAngle={195} opacity={0.05} color={colors.bronze} />
        <ClockGlyph cx={width * 1.08} cy={height * 0.94} r={width * 0.52} hourAngle={70} minuteAngle={305} opacity={0.045} color={colors.fog} />
        <ClockGlyph cx={width * 0.88} cy={height * 0.16} r={width * 0.14} hourAngle={210} minuteAngle={15} opacity={0.07} color={colors.bronze} />
        <ClockGlyph cx={width * 0.1} cy={height * 0.85} r={width * 0.11} hourAngle={150} minuteAngle={275} opacity={0.06} color={colors.fog} />
      </Svg>
    </View>
  );
}

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
        <TimerBackdrop />
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
              fontVariant: ['tabular-nums'],
            }}
          >
            {targetS}
          </Text>
        </Animated.View>
      </View>
    );
  }

  // ── Countdown: stamped 3 · 2 · 1 ─────────────────────────────────────────
  if (phase === 'countdown') {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.ink }}>
        <TimerBackdrop />
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
            fontVariant: ['tabular-nums'],
          }}
        >
          {elapsedAtTap != null ? (elapsedAtTap / 1000).toFixed(2) : '—'}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 16, marginTop: 10 }}>
          Target: {targetS}
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
        <TimerBackdrop />
        <Text
          style={{
            position: 'absolute',
            top: 64,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: colors.fog,
            ...typography.label,
            fontSize: 12,
            letterSpacing: 4,
            textTransform: 'uppercase',
          }}
        >
          Tap when time's up
        </Text>
        <Text
          style={{
            color: colors.chalk,
            fontSize: 120,
            lineHeight: 130,
            fontWeight: '900',
            letterSpacing: -5,
            fontVariant: ['tabular-nums'],
          }}
        >
          {targetS}
        </Text>
      </View>
    </Pressable>
  );
};
