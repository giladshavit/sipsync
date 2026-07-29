import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { GlassWater } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { CountdownRing } from '../games/CountdownRing';

// Two independent phones, one shared story told in order: finger rises on
// Player 1's screen, Player 1 taps, finger rises on Player 2's screen,
// Player 2 taps — then the room-safe reveal lands on both at once (the real
// game broadcasts the same GAME_STATE to everyone). Runs once and holds on
// the final state, matching the other tutorials' run-once convention.
type Stage = 'intro' | 'finger1' | 'press1' | 'finger2' | 'press2' | 'safe';
const STAGE_ORDER: Stage[] = ['intro', 'finger1', 'press1', 'finger2', 'press2', 'safe'];
const stageIndex = (stage: Stage): number => STAGE_ORDER.indexOf(stage);

const T_FINGER1 = 600;
const T_PRESS1 = 1_800;
const T_FINGER2 = 3_200;
const T_PRESS2 = 4_400;
const T_SAFE = 5_100;

// Compressed stand-in for the real 30 s clock — same ring, same math, just
// scaled to fit the tutorial's story, so it's visibly near-empty by the
// time the room is saved (same tension the real countdown builds)
const RING_TOTAL_MS = 5_500;

const PHONE_W = 150;
const PHONE_H = 300;
const ROW_GAP = 14;
const BUTTON_SIZE = 52;

// ── One phone's pledge button + rising-finger tap ──────────────────────────

function PledgeButton({
  fingerVisible,
  pressed,
  count,
}: {
  fingerVisible: boolean;
  pressed: boolean;
  /** How many times this screen has pledged — pledging is repeatable, so
   * this is a running count, never a one-shot "locked in" checkmark. */
  count: number;
}): React.ReactElement {
  const fingerOpacity = useSharedValue(0);
  const fingerTranslateY = useSharedValue(36);
  const fingerScale = useSharedValue(1);
  const buttonPop = useSharedValue(1);

  // Finger glides up from below the button into pressing position — slow
  // and deliberate, so the gesture reads clearly instead of flashing by
  useEffect(() => {
    if (fingerVisible) {
      fingerOpacity.value = withTiming(1, { duration: 320 });
      fingerTranslateY.value = withTiming(0, { duration: 600, easing: Easing.out(Easing.quad) });
    } else {
      fingerOpacity.value = withTiming(0, { duration: 220 });
      fingerTranslateY.value = 36;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerVisible]);

  // The actual tap — finger dips, button thumps
  useEffect(() => {
    if (!pressed) return;
    fingerScale.value = withSequence(
      withTiming(0.78, { duration: 140, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
    );
    buttonPop.value = withSequence(
      withTiming(0.86, { duration: 140, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressed]);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [{ translateY: fingerTranslateY.value }, { scale: fingerScale.value }],
  }));
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: buttonPop.value }] }));

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: BUTTON_SIZE + 24, height: BUTTON_SIZE + 46, alignItems: 'center' }}>
        <Animated.View style={[buttonStyle, { position: 'absolute', top: 0 }]}>
          <View
            style={{
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              borderRadius: BUTTON_SIZE / 2,
              backgroundColor: colors.amber,
              borderWidth: 3,
              borderColor: colors.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GlassWater size={22} color={colors.ink} strokeWidth={2.5} />
          </View>
        </Animated.View>

        {/* Tapping finger, rising from below the button */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: BUTTON_SIZE - 16,
              zIndex: 30,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.5,
              shadowRadius: 10,
              elevation: 30,
            },
            fingerStyle,
          ]}
        >
          <Image
            source={require('@/assets/images/tap-gesture.png')}
            style={{ width: 40, height: 40 }}
          />
        </Animated.View>
      </View>

      {/* Reserved-height counter — never a checkmark, since pledging again
          is always allowed; same "×N" language as the real game screen */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          height: 16,
          opacity: count > 0 ? 1 : 0,
        }}
      >
        <GlassWater size={10} color={colors.amber} strokeWidth={2.5} />
        <Text style={{ color: colors.amber, ...typography.label, fontSize: 10, fontWeight: '800' }}>
          ×{count}
        </Text>
      </View>
    </View>
  );
}

// ── One phone mockup — chrome + label + shared ring/progress + its button ──

function PledgePhone({
  label,
  myCount,
  fingerVisible,
  pressed,
  pledged,
  target,
  ringDeadlineAt,
  safe,
}: {
  label: string;
  myCount: number;
  fingerVisible: boolean;
  pressed: boolean;
  pledged: number;
  target: number;
  ringDeadlineAt: number;
  safe: boolean;
}): React.ReactElement {
  const remaining = Math.max(0, target - pledged);

  const revealOpacity = useSharedValue(0);
  useEffect(() => {
    revealOpacity.value = withTiming(safe ? 1 : 0, { duration: 200 });
  }, [safe, revealOpacity]);
  const revealStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));

  return (
    <View
      style={{
        width: PHONE_W,
        height: PHONE_H,
        backgroundColor: colors.surface,
        borderRadius: 24,
        borderWidth: 2,
        borderColor: colors.rim,
        overflow: 'hidden',
        alignItems: 'center',
      }}
    >
      {/* Speaker grill */}
      <View
        style={{
          width: 32,
          height: 3,
          backgroundColor: colors.rim,
          borderRadius: 2,
          marginTop: 10,
          marginBottom: 8,
        }}
      />

      <View
        style={{
          flex: 1,
          width: '100%',
          backgroundColor: colors.cream,
          alignItems: 'center',
          paddingTop: 6,
        }}
      >
        <Text
          style={{
            color: colors.dune,
            ...typography.label,
            fontSize: 9,
            letterSpacing: 1.5,
            fontWeight: '800',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>

        <View style={{ marginTop: 6 }}>
          <CountdownRing
            deadlineAt={ringDeadlineAt}
            clockOffset={0}
            totalMs={RING_TOTAL_MS}
            active={!safe}
            size={56}
            strokeWidth={5}
            trackColor={colors.sand}
            textColor={colors.ink}
            highTimeColor={colors.amber}
          />
        </View>

        {/* Same "how many left" framing as the real game screen */}
        <Text style={{ color: colors.ink, fontSize: 30, fontWeight: '900', marginTop: 4 }}>
          {remaining}
        </Text>
        <Text
          style={{
            color: colors.amber,
            ...typography.label,
            fontSize: 9,
            fontWeight: '800',
            marginTop: -4,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          to go
        </Text>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PledgeButton fingerVisible={fingerVisible} pressed={pressed} count={myCount} />
        </View>
      </View>

      {/* Room-safe reveal — lands on both phones at once, like the real
          shared broadcast */}
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
            backgroundColor: 'rgba(22,163,74,0.94)',
          },
          revealStyle,
        ]}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 }}>
          ROOM SAFE
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}>
          <GlassWater size={13} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: '700' }}>
            Volunteers still drink
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function SacrificeTutorial(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('intro');
  const [ringDeadlineAt] = useState(() => Date.now() + RING_TOTAL_MS);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage('finger1'), T_FINGER1),
      setTimeout(() => setStage('press1'), T_PRESS1),
      setTimeout(() => setStage('finger2'), T_FINGER2),
      setTimeout(() => setStage('press2'), T_PRESS2),
      setTimeout(() => setStage('safe'), T_SAFE),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const idx = stageIndex(stage);
  const phone1Count = idx >= stageIndex('press1') ? 1 : 0;
  const phone2Count = idx >= stageIndex('press2') ? 1 : 0;
  const pledged = phone1Count + phone2Count;
  const safe = stage === 'safe';

  return (
    <View className="items-center">
      {/* Two independent screens, side by side — the story plays left, then right */}
      <View style={{ flexDirection: 'row', gap: ROW_GAP }}>
        <PledgePhone
          label="Player 1"
          myCount={phone1Count}
          fingerVisible={stage === 'finger1' || stage === 'press1'}
          pressed={stage === 'press1'}
          pledged={pledged}
          target={2}
          ringDeadlineAt={ringDeadlineAt}
          safe={safe}
        />
        <PledgePhone
          label="Player 2"
          myCount={phone2Count}
          fingerVisible={stage === 'finger2' || stage === 'press2'}
          pressed={stage === 'press2'}
          pledged={pledged}
          target={2}
          ringDeadlineAt={ringDeadlineAt}
          safe={safe}
        />
      </View>
    </View>
  );
}
