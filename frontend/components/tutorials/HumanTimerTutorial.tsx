import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Svg, { Circle, Line, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
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

// Mockup frame's own interior, inside the border and clear of the speaker
// grill / home bar — see the phone-in-phone container below. Only used to
// scale the backdrop glyphs to this smaller frame.
const SCREEN_W = 284;
const SCREEN_H = 380;

// Same frozen watch-face glyph as the real HumanTimerGameUI's TimerBackdrop,
// scaled to this mockup's frame — non-ticking for the same reason: this is
// the one game where a moving clock in view would hand players the exact
// thing the round asks them not to have.
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
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={opacity}
      />
      <Line
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(minRad) * r * 0.66}
        y2={cy + Math.sin(minRad) * r * 0.66}
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={opacity}
      />
    </>
  );
}

// Only rendered behind the 'target'/'counting' stages, same as the real
// game's ink-background phases — the blue 'result' stage stays flat there
// too, so this mirrors it rather than inventing extra texture.
function TutorialTimerBackdrop() {
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <Svg width={SCREEN_W} height={SCREEN_H}>
        <Defs>
          <RadialGradient id="tutorialTimerGlow" cx="50%" cy="40%" r="55%">
            <Stop offset="0%" stopColor={colors.amber} stopOpacity={0.08} />
            <Stop offset="100%" stopColor={colors.amber} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H} fill="url(#tutorialTimerGlow)" />
        <ClockGlyph cx={SCREEN_W * -0.12} cy={SCREEN_H * 0.05} r={SCREEN_W * 0.5} hourAngle={-35} minuteAngle={195} opacity={0.05} color={colors.bronze} />
        <ClockGlyph cx={SCREEN_W * 1.1} cy={SCREEN_H * 0.95} r={SCREEN_W * 0.55} hourAngle={70} minuteAngle={305} opacity={0.045} color={colors.fog} />
      </Svg>
    </View>
  );
}

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
          {(stage === 'target' || stage === 'counting') && <TutorialTimerBackdrop />}

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
              <Text style={{ color: colors.amber, fontSize: 76, fontWeight: '900', letterSpacing: -3, fontVariant: ['tabular-nums'] }}>
                {DEMO_TARGET_S}
              </Text>
            </>
          )}

          {stage === 'counting' && (
            <>
              <Text
                style={{
                  position: 'absolute',
                  top: 20,
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  color: colors.fog,
                  ...typography.label,
                  fontSize: 10,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                }}
              >
                Tap when time's up
              </Text>
              <Text style={{ color: colors.chalk, fontSize: 64, fontWeight: '900', letterSpacing: -2, fontVariant: ['tabular-nums'] }}>
                {DEMO_TARGET_S}
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
                You called it at
              </Text>
              <Text style={{ color: '#FFFFFF', fontSize: 54, fontWeight: '900', letterSpacing: -2, fontVariant: ['tabular-nums'] }}>
                {DEMO_TAP_S}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 8 }}>
                Target: {DEMO_TARGET_S}
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
