import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';

// Shared implementation behind both MajorityTutorial ("go with the flow")
// and MinorityTutorial ("against the flow") — same phone replica, same two
// example questions, same racing-bar reveal; only `mode` changes which side
// of each vote counts as the win. Not itself a per-game registry entry (see
// CountdownRing.tsx for the same "shared, unregistered" pattern in games/).

export type FlowMode = 'FLOW' | 'AGAINST';

type Phase = 'idle' | 'tap' | 'locked' | 'reveal';

interface Scenario {
  question: string;
  optionA: string;
  optionB: string;
  pick: 'A' | 'B';
  countA: number;
  countB: number;
}

// Same two example rounds for both tutorials: A is always the minority pick,
// B the majority pick, so flipping `mode` alone flips who wins each one.
const SCENARIOS: Scenario[] = [
  { question: 'Winter or summer?', optionA: 'Winter', optionB: 'Summer', pick: 'B', countA: 4, countB: 7 },
  { question: 'Salty or sweet?', optionA: 'Salty', optionB: 'Sweet', pick: 'A', countA: 4, countB: 7 },
];

function aWinsFor(mode: FlowMode, scenario: Scenario): boolean {
  const aIsMajority = scenario.countA > scenario.countB;
  return mode === 'FLOW' ? aIsMajority : !aIsMajority;
}

function pickWonFor(mode: FlowMode, scenario: Scenario): boolean {
  const aWins = aWinsFor(mode, scenario);
  return scenario.pick === 'A' ? aWins : !aWins;
}

const INTRO_DELAY_MS = 400;
const T_TAP = 500;
const T_LOCK = 850;
const T_REVEAL = 1_450;
const SCENARIO_MS = 3_000;

// Reveal choreography, compressed from the real game's ResultColumn timing
// (see MajorityGameUI.tsx) to fit the tutorial's faster pace
const RACE_DELAY_MS = 150;
const RACE_DURATION_MS = 450;
const COLOR_DELAY_MS = RACE_DELAY_MS + RACE_DURATION_MS;
const COLOR_DURATION_MS = 200;
const VERDICT_DELAY_MS = COLOR_DELAY_MS + 150;

const PHONE_W = 150;
const PHONE_H = 224;
const BTN_W = 54;
const BTN_H = 42;
const BTN_GAP = 8;
const TARGET_X: Record<'A' | 'B', number> = {
  A: -(BTN_W / 2 + BTN_GAP / 2),
  B: BTN_W / 2 + BTN_GAP / 2,
};

const MAX_BAR_H = 62;
const MIN_BAR_H = 6;
const BAR_W = 20;

// ── One mini vote button, scaled down from the real OptionButton ───────────

function MiniOptionButton({
  label,
  state,
}: {
  label: string;
  state: 'idle' | 'locked' | 'dimmed';
}): React.ReactElement {
  const locked = state === 'locked';
  const dimmed = state === 'dimmed';

  const pop = useSharedValue(1);
  useEffect(() => {
    if (locked) {
      pop.value = withSequence(
        withTiming(1.08, { duration: 120, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 150 }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Animated.View
      style={[
        popStyle,
        {
          width: BTN_W,
          height: BTN_H,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: locked ? colors.amber : colors.parchment,
          borderWidth: 1.5,
          borderColor: colors.ink,
          opacity: dimmed ? 0.4 : 1,
        },
      ]}
    >
      <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 9, fontWeight: '900', textAlign: 'center' }}>
        {label}
      </Text>
    </Animated.View>
  );
}

// ── One racing bar + its label, mirroring the real game's ResultColumn ─────

function MiniBar({
  label,
  targetHeight,
  won,
  reveal,
}: {
  label: string;
  targetHeight: number;
  won: boolean;
  reveal: boolean;
}): React.ReactElement {
  const height = useSharedValue(MIN_BAR_H);
  const colorProgress = useSharedValue(0);
  useEffect(() => {
    if (reveal) {
      height.value = withDelay(
        RACE_DELAY_MS,
        withTiming(targetHeight, { duration: RACE_DURATION_MS, easing: Easing.out(Easing.cubic) }),
      );
      colorProgress.value = withDelay(COLOR_DELAY_MS, withTiming(1, { duration: COLOR_DURATION_MS }));
    } else {
      height.value = MIN_BAR_H;
      colorProgress.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, targetHeight, won]);

  const barStyle = useAnimatedStyle(() => ({
    height: height.value,
    backgroundColor: interpolateColor(colorProgress.value, [0, 1], [colors.dune, won ? colors.go : colors.stop]),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(colorProgress.value, [0, 1], [colors.ink, won ? colors.go : colors.stop]),
  }));

  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.Text
        numberOfLines={1}
        style={[{ fontSize: 9, fontWeight: '900', maxWidth: 56, textAlign: 'center' }, labelStyle]}
      >
        {label}
      </Animated.Text>
      <View style={{ height: MAX_BAR_H, justifyContent: 'flex-end', marginTop: 6 }}>
        <Animated.View style={[{ width: BAR_W, borderWidth: 1.5, borderColor: colors.ink }, barStyle]} />
      </View>
    </View>
  );
}

// ── The phone — question + buttons, crossfading into the racing-bar reveal
// (same opaque-overlay technique as DilemmaTutorial's per-phone verdict) ───

function ScenarioPhone({
  scenario,
  phase,
  mode,
}: {
  scenario: Scenario;
  phase: Phase;
  mode: FlowMode;
}): React.ReactElement {
  // Tapping finger — anchored to the button row's own box (not the wider
  // centered wrapper around it), so its resting position actually lands on
  // the buttons instead of drifting below them.
  const fingerOpacity = useSharedValue(0);
  const fingerX = useSharedValue(TARGET_X[scenario.pick]);
  useEffect(() => {
    fingerX.value = TARGET_X[scenario.pick];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.pick]);
  useEffect(() => {
    fingerOpacity.value = withTiming(phase === 'tap' || phase === 'locked' ? 1 : 0, {
      duration: phase === 'tap' ? 220 : 150,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [{ translateX: fingerX.value }],
  }));

  const revealOpacity = useSharedValue(0);
  useEffect(() => {
    revealOpacity.value = withTiming(phase === 'reveal' ? 1 : 0, { duration: 220 });
  }, [phase, revealOpacity]);
  const revealStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));

  // Verdict lands a beat after the bars settle — same "personal stake comes
  // last" staggering as the real game's reveal
  const verdictOpacity = useSharedValue(0);
  useEffect(() => {
    verdictOpacity.value =
      phase === 'reveal' ? withDelay(VERDICT_DELAY_MS, withTiming(1, { duration: 200 })) : 0;
  }, [phase, verdictOpacity]);
  const verdictStyle = useAnimatedStyle(() => ({ opacity: verdictOpacity.value }));

  const locked = phase === 'locked' || phase === 'reveal';
  const stateA: 'idle' | 'locked' | 'dimmed' =
    scenario.pick === 'A' ? (locked ? 'locked' : 'idle') : locked ? 'dimmed' : 'idle';
  const stateB: 'idle' | 'locked' | 'dimmed' =
    scenario.pick === 'B' ? (locked ? 'locked' : 'idle') : locked ? 'dimmed' : 'idle';

  const reveal = phase === 'reveal';
  const total = scenario.countA + scenario.countB;
  const targetA = Math.max(MIN_BAR_H, (scenario.countA / total) * MAX_BAR_H);
  const targetB = Math.max(MIN_BAR_H, (scenario.countB / total) * MAX_BAR_H);
  const aWins = aWinsFor(mode, scenario);
  const pickWon = pickWonFor(mode, scenario);

  return (
    <View
      style={{
        width: PHONE_W,
        height: PHONE_H,
        backgroundColor: colors.surface,
        borderRadius: 22,
        borderWidth: 2,
        borderColor: colors.rim,
        overflow: 'hidden',
        alignItems: 'center',
      }}
    >
      <View style={{ width: 32, height: 3, backgroundColor: colors.rim, borderRadius: 2, marginTop: 9, marginBottom: 8 }} />

      <View style={{ flex: 1, width: '100%', backgroundColor: colors.cream, alignItems: 'center' }}>
        <Text
          style={{
            ...typography.label,
            color: colors.amber,
            fontSize: 8,
            fontWeight: '800',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            marginTop: 10,
          }}
        >
          Vote
        </Text>
        <Text
          numberOfLines={2}
          style={{ color: colors.ink, fontSize: 11, fontWeight: '900', textAlign: 'center', marginTop: 4, paddingHorizontal: 10 }}
        >
          {scenario.question}
        </Text>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {/* Wrapper scoped tightly to the button row's own box, so the
              finger's position is relative to the buttons themselves. */}
          <View style={{ position: 'relative' }}>
            <View style={{ flexDirection: 'row', gap: BTN_GAP }}>
              <MiniOptionButton label={scenario.optionA} state={stateA} />
              <MiniOptionButton label={scenario.optionB} state={stateB} />
            </View>

            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: BTN_H * 0.35,
                  alignSelf: 'center',
                  zIndex: 30,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 6,
                  elevation: 20,
                },
                fingerStyle,
              ]}
            >
              <Image source={require('@/assets/images/tap-gesture.png')} style={{ width: 28, height: 28 }} />
            </Animated.View>
          </View>
        </View>
      </View>

      {/* Racing-bar reveal — opaque, fades in over the vote screen (same
          layering technique as DilemmaTutorial's per-phone overlay) */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.cream,
          },
          revealStyle,
        ]}
      >
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-end' }}>
          <MiniBar label={scenario.optionA} targetHeight={targetA} won={aWins} reveal={reveal} />
          <MiniBar label={scenario.optionB} targetHeight={targetB} won={!aWins} reveal={reveal} />
        </View>

        <Animated.View
          style={[
            {
              marginTop: 14,
              paddingVertical: 6,
              paddingHorizontal: 12,
              alignItems: 'center',
              backgroundColor: pickWon ? colors.go : colors.stop,
              borderWidth: 1.5,
              borderColor: colors.ink,
            },
            verdictStyle,
          ]}
        >
          <Text style={{ color: colors.chalk, fontSize: 11, fontWeight: '900', letterSpacing: 0.3 }}>
            {pickWon ? 'YOU WIN' : 'YOU DRINK'}
          </Text>
          <Text style={{ ...typography.label, color: colors.chalk, fontSize: 9, fontWeight: '800', marginTop: 2 }}>
            {pickWon ? '+5' : '−5'} PTS
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function FlowTutorial({ mode }: { mode: FlowMode }): React.ReactElement {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    SCENARIOS.forEach((_, i) => {
      const base = INTRO_DELAY_MS + i * SCENARIO_MS;
      timers.push(
        setTimeout(() => { setScenarioIndex(i); setPhase('idle'); }, base),
        setTimeout(() => setPhase('tap'), base + T_TAP),
        setTimeout(() => setPhase('locked'), base + T_LOCK),
        setTimeout(() => setPhase('reveal'), base + T_REVEAL),
      );
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  const scenario = SCENARIOS[scenarioIndex];

  return (
    <View style={{ alignItems: 'center' }}>
      <ScenarioPhone scenario={scenario} phase={phase} mode={mode} />
    </View>
  );
}
