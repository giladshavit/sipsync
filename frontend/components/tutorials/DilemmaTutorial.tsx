import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { GlassWater, Handshake, Swords } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Two phones, each showing a compressed replica of the real Dilemma game
// screen (two HELP/BETRAY buttons). Both fingers rise and tap at the exact
// same time — this is a simultaneous, secret decision, not a turn-based one
// — then both phones reveal their OWN verdict together, at the same instant.
// In the mutual scenarios that lands as two matching colors; only the
// lopsided scenario (one betrays) splits it into one green + one red screen.
// Runs through all 3 payoff scenarios once and holds on the last (best)
// outcome. Slower and longer than the other tutorials, so the tutorial
// screen grants it extra time (see DURATION_MS_OVERRIDES in tutorial.tsx).

type Choice = 'HELP' | 'BETRAY';
type Phase = 'idle' | 'finger' | 'press' | 'reveal';

interface Scenario {
  you: Choice;
  them: Choice;
}

const SCENARIOS: Scenario[] = [
  { you: 'BETRAY', them: 'BETRAY' },
  { you: 'BETRAY', them: 'HELP' },
  { you: 'HELP', them: 'HELP' },
];

// Per-scenario story: both fingers rise together, tap together, then both
// verdicts land together. Same run-once, hold-on-final convention as the
// other tutorials, just paced slower to give each beat room to read.
const SCENARIO_MS = 2_500;
const INTRO_DELAY_MS = 400;
const T_FINGER = 0;
const T_PRESS = 550;
const T_REVEAL = 1_050;

function resultFor(mine: Choice, theirs: Choice): 'WIN' | 'LOSE' {
  if (mine === theirs) return mine === 'HELP' ? 'WIN' : 'LOSE';
  return mine === 'BETRAY' ? 'WIN' : 'LOSE';
}

// Mirrors the real payoff matrix's chaser counts: mutual help owes nothing,
// mutual betrayal costs both a chaser each, and the lopsided case makes the
// helper drink double while the betrayer drinks nothing.
function chasersFor(mine: Choice, theirs: Choice): number {
  if (mine === theirs) return mine === 'HELP' ? 0 : 1;
  return mine === 'BETRAY' ? 0 : 2;
}

const PHONE_W = 138;
const PHONE_H = 208;
const BTN_W = 54;
const BTN_H = 52;
const BTN_GAP = 6;
// Finger's horizontal offset from the row's center to land on the left
// (HELP) or right (BETRAY) button
const TARGET_X: Record<Choice, number> = {
  HELP: -(BTN_W / 2 + BTN_GAP / 2),
  BETRAY: BTN_W / 2 + BTN_GAP / 2,
};

// ── One HELP/BETRAY button, scaled down to phone size ───────────────────────

function MiniButton({
  choice,
  state,
}: {
  choice: Choice;
  state: 'idle' | 'locked' | 'dimmed';
}): React.ReactElement {
  const isHelp = choice === 'HELP';
  const Icon = isHelp ? Handshake : Swords;
  const tint = isHelp ? colors.go : colors.stop;
  const locked = state === 'locked';
  const dimmed = state === 'dimmed';

  const pop = useSharedValue(1);
  useEffect(() => {
    if (locked) {
      pop.value = withSequence(
        withTiming(1.12, { duration: 140, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 190 }),
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
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          backgroundColor: locked ? tint : colors.surface,
          borderWidth: 2,
          borderColor: dimmed ? colors.rim : tint,
          opacity: dimmed ? 0.4 : 1,
        },
      ]}
    >
      <Icon size={17} color={locked ? colors.ink : dimmed ? colors.fog : tint} strokeWidth={2.5} />
      <Text
        style={{
          ...typography.label,
          fontSize: 7,
          fontWeight: '900',
          letterSpacing: 0.5,
          color: locked ? colors.ink : dimmed ? colors.fog : colors.chalk,
        }}
      >
        {choice}
      </Text>
    </Animated.View>
  );
}

// ── One phone — chrome + button row + tapping finger + its own verdict flash

function DilemmaPhone({
  fingerVisible,
  fingerTarget,
  locked,
  revealResult,
  revealChasers,
}: {
  fingerVisible: boolean;
  fingerTarget: Choice;
  locked: Choice | null;
  revealResult: 'WIN' | 'LOSE' | null;
  revealChasers: number;
}): React.ReactElement {
  const fingerOpacity = useSharedValue(0);
  const fingerTranslateX = useSharedValue(0);
  const fingerTranslateY = useSharedValue(30);

  useEffect(() => {
    fingerTranslateX.value = withTiming(TARGET_X[fingerTarget], { duration: 340 });
    if (fingerVisible) {
      fingerOpacity.value = withTiming(1, { duration: 280 });
      fingerTranslateY.value = withTiming(0, { duration: 440, easing: Easing.out(Easing.quad) });
    } else {
      fingerOpacity.value = withTiming(0, { duration: 220 });
      fingerTranslateY.value = 30;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerVisible, fingerTarget]);
  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [{ translateX: fingerTranslateX.value }, { translateY: fingerTranslateY.value }],
  }));

  const revealOpacity = useSharedValue(0);
  useEffect(() => {
    revealOpacity.value = withTiming(revealResult ? 1 : 0, { duration: 260 });
  }, [revealResult, revealOpacity]);
  const revealStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));
  const revealBg = revealResult === 'WIN' ? colors.go : colors.stop;

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
      <View
        style={{ width: 28, height: 3, backgroundColor: colors.rim, borderRadius: 2, marginTop: 9, marginBottom: 6 }}
      />

      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', gap: BTN_GAP }}>
          <MiniButton choice="HELP" state={locked === 'HELP' ? 'locked' : locked ? 'dimmed' : 'idle'} />
          <MiniButton choice="BETRAY" state={locked === 'BETRAY' ? 'locked' : locked ? 'dimmed' : 'idle'} />
        </View>

        {/* Tapping finger, rising from below toward whichever button this
            scenario targets */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              bottom: PHONE_H / 2 - BTN_H / 2 - 18,
              zIndex: 30,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.5,
              shadowRadius: 8,
              elevation: 20,
            },
            fingerStyle,
          ]}
        >
          <Image source={require('@/assets/images/tap-gesture.png')} style={{ width: 30, height: 30 }} />
        </Animated.View>
      </View>

      {/* This phone's own verdict — fills the whole card edge-to-edge,
          green if it won, red if it lost */}
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
            backgroundColor: revealBg,
          },
          revealStyle,
        ]}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 }}>
          {revealResult === 'WIN' ? 'WIN' : 'DRINK'}
        </Text>
        {revealChasers > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
            <GlassWater size={14} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>
              {revealChasers} {revealChasers === 1 ? 'CHASER' : 'CHASERS'}
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function DilemmaTutorial(): React.ReactElement {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    SCENARIOS.forEach((_, i) => {
      const base = INTRO_DELAY_MS + i * SCENARIO_MS;
      timers.push(
        setTimeout(() => { setScenarioIndex(i); setPhase('finger'); }, base + T_FINGER),
        setTimeout(() => setPhase('press'), base + T_PRESS),
        setTimeout(() => setPhase('reveal'), base + T_REVEAL),
      );
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  const scenario = SCENARIOS[scenarioIndex];
  const bothLocked = phase === 'press' || phase === 'reveal';
  const revealing = phase === 'reveal';

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <DilemmaPhone
          fingerVisible={phase === 'finger'}
          fingerTarget={scenario.you}
          locked={bothLocked ? scenario.you : null}
          revealResult={revealing ? resultFor(scenario.you, scenario.them) : null}
          revealChasers={revealing ? chasersFor(scenario.you, scenario.them) : 0}
        />
        <DilemmaPhone
          fingerVisible={phase === 'finger'}
          fingerTarget={scenario.them}
          locked={bothLocked ? scenario.them : null}
          revealResult={revealing ? resultFor(scenario.them, scenario.you) : null}
          revealChasers={revealing ? chasersFor(scenario.them, scenario.you) : 0}
        />
      </View>
    </View>
  );
}
