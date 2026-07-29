import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { GlassWater, Hand, Package, Skull, X, Check } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Two phones replaying ONE real round beat-for-beat, exactly as the live
// game now choreographs it (BlackBoxGameUI.tsx): Player 1's finger picks a
// grid card → their phone privately flips it open (the 2s peek) while
// Player 2's phone shows only "Player 1 is checking the card" — the
// information asymmetry IS the game, so the two screens deliberately
// diverge for that one beat and stay in lockstep everywhere else. Then
// Player 2's finger presses LEAVE IT, and both phones run the same
// dim-and-flip reveal at the same instant (mirroring the real sync), landing
// on a Drink card: Player 1 drinks, Player 2 is safe.
//
// Colors are BlackBoxGameUI.tsx's own tokens verbatim — the brushed-steel
// vault surfaces, the solid-red Drink face with white chasers, the blue=P1 /
// orange=P2 identity pair, and the skull plaque copied from DrinkDoneBanner.
const VAULT = '#1E2530';
const VAULT_DEEP = '#12161D';
const VAULT_LIGHT = '#39465A';
const SLATE = '#475569';
const SLATE_GLOW = '#94A3B8';
const PLAYER_A_TINT = '#2563EB'; // colors.tapped — Player 1 / Holder
const PLAYER_B_TINT = '#F97316'; // colors.orange — Player 2 / Guesser

const DEMO_CHASERS = 2;
const PICKED_INDEX = 3; // bottom-left tile — the scripted pick

// ── Timeline (ms from mount) — run once, freeze on DONE. The room tutorial
// screen grants this story extra time via DURATION_MS_OVERRIDES. ──────────
const T_FINGER_1 = 400; // P1's finger rises over the bottom-left tile
const T_PICK = 1_000; // tile lifts + glows under the press
const T_TRAVEL = 1_500; // other tiles vanish; the card travels up-center
const T_PEEK_OPEN = 2_100; // P1 only: flip open (P2 gets the status line);
// re-seals at T_PEEK_OPEN + FLIP_MS + PEEK_HOLD ≈ 4.5s
const PEEK_HOLD = 2_000; // same 2s private read as the real game
const T_DECIDE = 5_200; // buttons enter BOTH phones together (synced beat)
const T_FINGER_2 = 5_700; // P2's finger rises toward LEAVE IT
const T_PRESS = 6_300; // LEAVE IT locks, TAKE IT fades
const T_REVEAL = 7_000; // both phones dim; card zooms center — in sync
const T_FLIP = 7_700; // the truth flip, same instant on both screens
const T_DONE = 8_700; // skull plaque: P1 drinks, P2 safe

const PHONE_W = 138;
const PHONE_H = 216;
const PLAY_W = PHONE_W - 16;
const PLAY_H = 158;

const M_CARD_W = 30;
const M_CARD_H = 40;
const M_GAP = 5;
const GRID_LEFT = (PLAY_W - (M_CARD_W * 3 + M_GAP * 2)) / 2;
const GRID_TOP = 12;
const FLIP_MS = 420;

function tileX(i: number): number {
  return GRID_LEFT + (i % 3) * (M_CARD_W + M_GAP);
}
function tileY(i: number): number {
  return GRID_TOP + Math.floor(i / 3) * (M_CARD_H + M_GAP);
}
// The chosen card's two stops, mirroring the real stage: the duel-lane rest
// (upper center, modest) and the reveal's center-stage zoom.
const REST_X = (PLAY_W - M_CARD_W) / 2;
const REST_Y = 14;
const CENTER_X = (PLAY_W - M_CARD_W) / 2;
const CENTER_Y = (PLAY_H - M_CARD_H) / 2 - 4;
const REVEAL_SCALE = 1.75;

type Stage =
  | 'GRID'
  | 'FINGER1'
  | 'PICKED'
  | 'PEEK'
  | 'DECIDE'
  | 'FINGER2'
  | 'PRESS'
  | 'REVEAL'
  | 'DONE';

const STAGE_ORDER: Stage[] = [
  'GRID',
  'FINGER1',
  'PICKED',
  'PEEK',
  'DECIDE',
  'FINGER2',
  'PRESS',
  'REVEAL',
  'DONE',
];
function atLeast(stage: Stage, min: Stage): boolean {
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(min);
}

// ── Mini sealed face — the diamond seal + package emblem from the real
// GridTileBack/CardBack, scaled down ───────────────────────────────────────
function MiniSealedFace({ hinted }: { hinted: boolean }): React.ReactElement {
  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 7,
        backgroundColor: VAULT,
        borderWidth: 1.5,
        borderColor: hinted ? SLATE_GLOW : SLATE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 13,
          height: 13,
          borderRadius: 3,
          borderWidth: 1,
          borderColor: hinted ? SLATE_GLOW : colors.fog,
          transform: [{ rotate: '45deg' }],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ transform: [{ rotate: '-45deg' }] }}>
          <Package size={7} color={hinted ? SLATE_GLOW : colors.fog} strokeWidth={2} />
        </View>
      </View>
    </View>
  );
}

// ── Mini drink face — the real CardFront verbatim at this scale: a SOLID
// red plate, white chaser icons, nothing else ──────────────────────────────
function MiniDrinkFace(): React.ReactElement {
  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 7,
        backgroundColor: colors.stop,
        borderWidth: 1.5,
        borderColor: colors.stop,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 3,
      }}
    >
      {Array.from({ length: DEMO_CHASERS }, (_, i) => (
        <GlassWater key={i} size={10} color={colors.chalk} strokeWidth={2.5} />
      ))}
    </View>
  );
}

// ── The traveling, flipping hero card — same scaleY-cosine squash + face
// swap technique as the real FlippableCard, driven by one continuous spin
// value across the whole story (0 sealed → 1 peek open → 2 re-sealed →
// 3 truth-flip open) ───────────────────────────────────────────────────────
function MiniHeroCard({
  x,
  y,
  scale,
  spin,
  hinted,
}: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  scale: SharedValue<number>;
  spin: SharedValue<number>;
  hinted: boolean;
}): React.ReactElement {
  const wrapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value },
      { scaleY: Math.abs(Math.cos(spin.value * Math.PI)) },
    ],
  }));
  const backStyle = useAnimatedStyle(() => ({ opacity: Math.round(spin.value) % 2 === 0 ? 1 : 0 }));
  const frontStyle = useAnimatedStyle(() => ({ opacity: Math.round(spin.value) % 2 === 1 ? 1 : 0 }));
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: M_CARD_W, height: M_CARD_H, zIndex: 10 }, wrapStyle]}>
      <Animated.View style={[StyleSheet.absoluteFillObject, backStyle]}>
        <MiniSealedFace hinted={hinted} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFillObject, frontStyle]}>
        <MiniDrinkFace />
      </Animated.View>
    </Animated.View>
  );
}

// ── Mini decision button — TAKE IT / LEAVE IT, with the locked/faded states
// the real DecisionButton moves through once the Guesser commits ───────────
function MiniDecisionButton({
  label,
  Icon,
  state,
  compact,
}: {
  label: string;
  Icon: typeof Hand;
  state: 'idle' | 'chosen' | 'faded';
  compact: boolean;
}): React.ReactElement {
  const pop = useSharedValue(1);
  useEffect(() => {
    if (state === 'chosen') {
      pop.value = withSequence(
        withTiming(1.14, { duration: 150, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 180 }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const chosen = state === 'chosen';
  return (
    <Animated.View
      style={[
        popStyle,
        {
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          paddingVertical: compact ? 4 : 7,
          paddingHorizontal: compact ? 6 : 9,
          borderRadius: 7,
          backgroundColor: chosen ? VAULT_LIGHT : VAULT,
          borderWidth: 1.5,
          borderColor: chosen ? SLATE_GLOW : SLATE,
          opacity: state === 'faded' ? 0.35 : 1,
        },
      ]}
    >
      <Icon size={compact ? 9 : 12} color={chosen ? colors.chalk : SLATE_GLOW} strokeWidth={2.5} />
      <Text style={{ ...typography.label, color: colors.chalk, fontSize: compact ? 5 : 6 }}>{label}</Text>
    </Animated.View>
  );
}

// ── Skull plaque — DrinkDoneBanner scaled down, with the Guesser's phone
// also getting the green "you're safe" line the loser's phone doesn't ──────
function MiniSkullPlaque({ isTarget }: { isTarget: boolean }): React.ReactElement {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 180 });
    scale.value = withSequence(
      withTiming(1.08, { duration: 200, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 120 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,15,0.7)', zIndex: 20 },
        style,
      ]}
    >
      <View
        style={{
          alignItems: 'center',
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: colors.stop,
          borderWidth: 1.5,
          borderColor: colors.chalk,
          borderRadius: 8,
          gap: 3,
        }}
      >
        <Skull size={18} color={colors.chalk} strokeWidth={2} />
        <Text style={{ color: colors.chalk, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>
          {isTarget ? 'YOU' : 'PLAYER 1'}
        </Text>
        <Text style={{ ...typography.label, color: colors.chalk, fontSize: 5, opacity: 0.9 }}>
          {isTarget ? 'You drink the box' : 'Drinks the box'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
          {Array.from({ length: DEMO_CHASERS }, (_, i) => (
            <GlassWater key={i} size={11} color={colors.chalk} strokeWidth={2.5} />
          ))}
        </View>
      </View>
      {!isTarget && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 7 }}>
          <Check size={9} color={colors.go} strokeWidth={3} />
          <Text style={{ ...typography.label, color: colors.go, fontSize: 6 }}>You're safe</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── A tapping finger, rising from below onto a target point in the play
// area — same gesture asset and rise-then-fade pattern as DilemmaTutorial ──
function MiniFinger({
  visible,
  targetX,
  targetY,
}: {
  visible: boolean;
  targetX: number;
  targetY: number;
}): React.ReactElement {
  const opacity = useSharedValue(0);
  const rise = useSharedValue(26);
  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 240 });
      rise.value = withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) });
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      rise.value = 26;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          // The fingertip lands just under the target's center
          left: targetX - 6,
          top: targetY + 6,
          zIndex: 30,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: 0.5,
          shadowRadius: 7,
          elevation: 20,
        },
        style,
      ]}
    >
      <Image source={require('@/assets/images/tap-gesture.png')} style={{ width: 26, height: 26 }} />
    </Animated.View>
  );
}

// ── One phone's play area ──────────────────────────────────────────────────
function PhonePlayArea({
  role,
  stage,
}: {
  role: 'holder' | 'guesser';
  stage: Stage;
}): React.ReactElement {
  const isHolder = role === 'holder';

  // Hero card motion — one continuous timeline per phone, driven by stage
  // transitions (never remounted, so its coordinate carries across beats,
  // exactly like the real single-canvas stage).
  const x = useSharedValue(tileX(PICKED_INDEX));
  const y = useSharedValue(tileY(PICKED_INDEX));
  const scale = useSharedValue(1);
  const spin = useSharedValue(0);
  const gridOpacity = useSharedValue(1);
  const dim = useSharedValue(0);

  useEffect(() => {
    if (stage === 'PEEK') {
      gridOpacity.value = withTiming(0, { duration: 260 });
      x.value = withTiming(REST_X, { duration: 480, easing: Easing.out(Easing.cubic) });
      y.value = withTiming(REST_Y, { duration: 480, easing: Easing.out(Easing.cubic) });
      scale.value = withTiming(1.15, { duration: 480 });
      if (isHolder) {
        // The private peek: open, hold 2s, re-seal — Holder's phone only.
        spin.value = withDelay(
          T_PEEK_OPEN - T_TRAVEL,
          withSequence(
            withTiming(1, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) }),
            withDelay(PEEK_HOLD, withTiming(2, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) })),
          ),
        );
      }
    }
    if (stage === 'REVEAL') {
      dim.value = withTiming(1, { duration: 420 });
      x.value = withTiming(CENTER_X, { duration: 480, easing: Easing.out(Easing.cubic) });
      y.value = withTiming(CENTER_Y, { duration: 480, easing: Easing.out(Easing.cubic) });
      scale.value = withTiming(REVEAL_SCALE, { duration: 480, easing: Easing.out(Easing.cubic) });
      // The truth flip lands at the same wall-clock instant on BOTH phones —
      // the sync the real game now guarantees. Guesser's card goes 0→1,
      // Holder's continues 2→3; both end face-up.
      spin.value = withDelay(
        T_FLIP - T_REVEAL,
        withTiming(isHolder ? 3 : 1, { duration: FLIP_MS + 80, easing: Easing.inOut(Easing.cubic) }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const gridStyle = useAnimatedStyle(() => ({ opacity: gridOpacity.value }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value * 0.75 }));

  const picked = atLeast(stage, 'PICKED');
  const inDecide = stage === 'DECIDE' || stage === 'FINGER2' || stage === 'PRESS';
  const leaveState: 'idle' | 'chosen' = stage === 'PRESS' ? 'chosen' : 'idle';
  const takeState: 'idle' | 'faded' = stage === 'PRESS' ? 'faded' : 'idle';

  return (
    <View style={{ width: PLAY_W, height: PLAY_H }}>
      {/* Grid of the 5 UNCHOSEN tiles (the chosen slot is the hero card) */}
      <Animated.View style={[StyleSheet.absoluteFillObject, gridStyle]}>
        {Array.from({ length: 6 }, (_, i) =>
          i === PICKED_INDEX ? null : (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: tileX(i),
                top: tileY(i),
                width: M_CARD_W,
                height: M_CARD_H,
                opacity: picked ? 0.35 : 1,
              }}
            >
              <MiniSealedFace hinted={false} />
            </View>
          ),
        )}
      </Animated.View>

      {/* The chosen card — travels, peeks (Holder), reveals (both) */}
      <MiniHeroCard x={x} y={y} scale={scale} spin={spin} hinted={picked} />

      {/* Status line during the peek — the two screens' one deliberate
          divergence, exactly like the live round */}
      {stage === 'PEEK' && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: REST_Y + M_CARD_H * 1.15 + 16 }}>
          <Text
            style={{
              ...typography.label,
              color: isHolder ? SLATE_GLOW : PLAYER_A_TINT,
              fontSize: 6,
              textAlign: 'center',
            }}
          >
            {isHolder ? 'Only you can see this' : 'Player 1 is checking the card'}
          </Text>
        </View>
      )}

      {/* Decision row — the Guesser's own controls, informational (compact)
          on the Holder's phone, entering on both screens together */}
      {inDecide && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: PLAY_H - (isHolder ? 46 : 56),
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <MiniDecisionButton label="Take it" Icon={Hand} state={takeState} compact={isHolder} />
          <MiniDecisionButton label="Leave it" Icon={X} state={leaveState} compact={isHolder} />
        </View>
      )}
      {inDecide && isHolder && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: PLAY_H - 12 }}>
          <Text style={{ ...typography.label, color: PLAYER_B_TINT, fontSize: 5.5, textAlign: 'center' }}>
            Player 2 is deciding
          </Text>
        </View>
      )}

      {/* Reveal dim — darkness settles under the centered card */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#0A0A0F', zIndex: 5 }, dimStyle]}
      />

      {/* Fingers — P1's over the bottom-left tile, P2's over LEAVE IT;
          each rises one beat before its press lands */}
      {isHolder && (
        <MiniFinger
          visible={stage === 'FINGER1' || stage === 'PICKED'}
          targetX={tileX(PICKED_INDEX) + M_CARD_W / 2}
          targetY={tileY(PICKED_INDEX) + M_CARD_H / 2}
        />
      )}
      {!isHolder && (
        <MiniFinger
          visible={stage === 'FINGER2' || stage === 'PRESS'}
          targetX={PLAY_W / 2 + 26}
          targetY={PLAY_H - 40}
        />
      )}

      {/* Verdict — skull plaque on both phones, safe line on the Guesser's */}
      {stage === 'DONE' && <MiniSkullPlaque isTarget={isHolder} />}
    </View>
  );
}

// ── One phone frame — same chrome as the other tutorials ──────────────────
function MiniPhone({
  roleLabel,
  tint,
  role,
  stage,
}: {
  roleLabel: string;
  tint: string;
  role: 'holder' | 'guesser';
  stage: Stage;
}): React.ReactElement {
  return (
    <View
      style={{
        width: PHONE_W,
        height: PHONE_H,
        backgroundColor: colors.surface,
        borderRadius: 20,
        borderWidth: 2,
        borderColor: colors.rim,
        overflow: 'hidden',
        alignItems: 'center',
      }}
    >
      <View style={{ width: 26, height: 3, backgroundColor: colors.rim, borderRadius: 2, marginTop: 8, marginBottom: 5 }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ink, alignItems: 'center' }}>
        <Text
          style={{
            ...typography.label,
            color: tint,
            fontSize: 7,
            letterSpacing: 1,
            fontWeight: '800',
            marginTop: 7,
          }}
        >
          {roleLabel}
        </Text>
        <View style={{ marginTop: 8 }}>
          <PhonePlayArea role={role} stage={stage} />
        </View>
      </View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function BlackBoxTutorial(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('GRID');

  useEffect(() => {
    const script: [number, Stage][] = [
      [T_FINGER_1, 'FINGER1'],
      [T_PICK, 'PICKED'],
      [T_TRAVEL, 'PEEK'],
      [T_DECIDE, 'DECIDE'],
      [T_FINGER_2, 'FINGER2'],
      [T_PRESS, 'PRESS'],
      [T_REVEAL, 'REVEAL'],
      [T_DONE, 'DONE'],
    ];
    const timers = script.map(([at, s]) => setTimeout(() => setStage(s), at));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <MiniPhone roleLabel="PLAYER 1 · HOLDER" tint={PLAYER_A_TINT} role="holder" stage={stage} />
        <MiniPhone roleLabel="PLAYER 2 · GUESSER" tint={PLAYER_B_TINT} role="guesser" stage={stage} />
      </View>
    </View>
  );
}
