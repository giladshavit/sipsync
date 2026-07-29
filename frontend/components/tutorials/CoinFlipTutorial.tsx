import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Anchor, Check, Crown } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Two independent mockups shown side by side — this game splits the room
// into two different screens, so the tutorial does too, instead of one
// shared board like the other games'. They run one shared chronological
// story, once — the coin lands on Player 1's screen first, then Other
// Players' screen reacts to it — never the other way around, since guessers
// never see the result until everyone has voted (see CoinFlipGameUI).

type Stage = 'spin' | 'landed' | 'tap' | 'correct';

const SPIN_MS = 1_200;
const LANDED_HOLD_MS = 700;
const TAP_TRAVEL_MS = 450; // finger fades in and glides to the button
const CORRECT_DELAY_MS = 300; // press lands → correct badge

const T_LANDED = SPIN_MS;
const T_TAP = T_LANDED + LANDED_HOLD_MS;
const T_CORRECT = T_TAP + TAP_TRAVEL_MS + CORRECT_DELAY_MS;

const PHONE_W = 134;
const PHONE_H = 224;
const ROW_GAP = 14;

const COIN_SIZE = 56;
const BUTTON_SIZE = 52;

const GOLD = { bg: '#F59E0B', rim: '#FCD34D', ink: '#78350F' };
const SILVER = { bg: '#B8C4D0', rim: '#E8EDF2', ink: '#1E293B' };

// Warm near-black, matching CoinFlipGameUI — no navy
const BG_FLIPPER = '#17130E';
const BG_GUESSER = '#141210';

// ── Player 1's mini coin — plays one scripted flip, lands on heads, holds ──

function MiniCoinFace({ face, size }: { face: 'heads' | 'tails'; size: number }): React.ReactElement {
  const palette = face === 'heads' ? GOLD : SILVER;
  const Icon = face === 'heads' ? Crown : Anchor;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.bg,
        borderWidth: 3,
        borderColor: palette.rim,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={size * 0.4} color={palette.ink} strokeWidth={2.5} />
    </View>
  );
}

function ScriptedCoin({ stage }: { stage: Stage }): React.ReactElement {
  const HALF_TURNS = 5; // odd count: starts on tails, ends on heads
  const spin = useSharedValue(0);
  const labelOpacity = useSharedValue(0);

  useEffect(() => {
    if (stage !== 'spin') return;
    spin.value = 0;
    labelOpacity.value = 0;
    spin.value = withTiming(HALF_TURNS, { duration: SPIN_MS, easing: Easing.out(Easing.cubic) });
    labelOpacity.value = withDelay(SPIN_MS, withTiming(1, { duration: 180 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const headsStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.abs(Math.cos(spin.value * Math.PI)) }],
    opacity: Math.round(spin.value) % 2 === 1 ? 1 : 0,
  }));
  const tailsStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    transform: [{ scaleY: Math.abs(Math.cos(spin.value * Math.PI)) }],
    opacity: Math.round(spin.value) % 2 === 1 ? 0 : 1,
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: COIN_SIZE, height: COIN_SIZE }}>
        <Animated.View style={tailsStyle}>
          <MiniCoinFace face="tails" size={COIN_SIZE} />
        </Animated.View>
        <Animated.View style={headsStyle}>
          <MiniCoinFace face="heads" size={COIN_SIZE} />
        </Animated.View>
      </View>
      <Animated.Text
        style={[
          {
            color: GOLD.rim,
            fontSize: 12,
            fontWeight: '900',
            letterSpacing: 1.5,
            marginTop: 8,
          },
          labelStyle,
        ]}
      >
        HEADS
      </Animated.Text>
    </View>
  );
}

// ── Other players' mini vote — finger taps heads, then a correct badge ─────

function ScriptedVote({ stage }: { stage: Stage }): React.ReactElement {
  const fingerOpacity = useSharedValue(0);
  const fingerScale = useSharedValue(1);
  const pick = useSharedValue(0); // 0 → idle, 1 → heads picked
  const badgeScale = useSharedValue(0);

  useEffect(() => {
    if (stage === 'tap') {
      fingerOpacity.value = withTiming(1, { duration: 220 });
      const timer = setTimeout(() => {
        fingerScale.value = withSequence(
          withTiming(0.8, { duration: 100, easing: Easing.in(Easing.quad) }),
          withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }),
        );
        pick.value = withDelay(70, withTiming(1, { duration: 150 }));
      }, TAP_TRAVEL_MS);
      return () => clearTimeout(timer);
    }
    if (stage === 'correct') {
      badgeScale.value = withSequence(
        withTiming(1.15, { duration: 180, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 120 }),
      );
    }
    if (stage === 'spin' || stage === 'landed') {
      fingerOpacity.value = 0;
      fingerScale.value = 1;
      pick.value = 0;
      badgeScale.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [{ scale: fingerScale.value }],
  }));
  const headsBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pick.value * 0.1 }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badgeScale.value > 0 ? 1 : 0,
    transform: [{ scale: badgeScale.value }],
  }));

  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <Animated.View
        style={[
          {
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            borderRadius: BUTTON_SIZE / 2,
            backgroundColor: colors.surface,
            borderWidth: 2.5,
            borderColor: GOLD.rim,
            alignItems: 'center',
            justifyContent: 'center',
          },
          headsBtnStyle,
        ]}
      >
        <Crown size={22} color={GOLD.rim} strokeWidth={2.5} />

        {/* Tapping finger */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 10,
              top: 12,
              zIndex: 30,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.5,
              shadowRadius: 14,
              elevation: 30,
            },
            fingerStyle,
          ]}
        >
          <Image
            source={require('@/assets/images/tap-gesture.png')}
            style={{ width: 46, height: 46 }}
          />
        </Animated.View>

        {/* Correct badge */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: -6,
              right: -6,
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: colors.go,
              borderWidth: 2,
              borderColor: colors.chalk,
              alignItems: 'center',
              justifyContent: 'center',
            },
            badgeStyle,
          ]}
        >
          <Check size={13} color={colors.chalk} strokeWidth={3} />
        </Animated.View>
      </Animated.View>

      <View
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: BUTTON_SIZE / 2,
          backgroundColor: colors.surface,
          borderWidth: 2.5,
          borderColor: SILVER.rim,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Anchor size={22} color={SILVER.rim} strokeWidth={2.5} />
      </View>
    </View>
  );
}

// ── Mini phone frame ─────────────────────────────────────────────────────────

function MiniPhone({
  label,
  labelTint,
  bg,
  children,
}: {
  label: string;
  labelTint: string;
  bg: string;
  children: React.ReactNode;
}): React.ReactElement {
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
        style={{
          width: 32,
          height: 3,
          backgroundColor: colors.rim,
          borderRadius: 2,
          marginTop: 9,
          marginBottom: 8,
        }}
      />
      <View style={{ flex: 1, width: '100%', backgroundColor: bg, alignItems: 'center', paddingTop: 4 }}>
        <Text
          style={{
            color: labelTint,
            ...typography.label,
            fontSize: 9,
            letterSpacing: 1.5,
            fontWeight: '800',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
      </View>
      <View
        style={{
          width: 44,
          height: 3,
          backgroundColor: colors.fog,
          borderRadius: 2,
          marginVertical: 8,
          opacity: 0.35,
        }}
      />
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function CoinFlipTutorial(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('spin');

  // Runs once and holds on the final state — no repeat spin, matching the
  // other tutorials' run-once convention (see ReflexTutorial)
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage('landed'), T_LANDED),
      setTimeout(() => setStage('tap'), T_TAP),
      setTimeout(() => setStage('correct'), T_CORRECT),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <View className="items-center">
      {/* Two independent screens, side by side — the story plays left, then right */}
      <View style={{ flexDirection: 'row', gap: ROW_GAP }}>
        <MiniPhone label="Player 1" labelTint={colors.amberGlow} bg={BG_FLIPPER}>
          <ScriptedCoin stage={stage} />
        </MiniPhone>
        <MiniPhone label="Other players" labelTint={colors.silver} bg={BG_GUESSER}>
          <ScriptedVote stage={stage} />
        </MiniPhone>
      </View>
    </View>
  );
}
