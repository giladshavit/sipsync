import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  interpolateColor,
  Extrapolation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  LinearTransition,
  FadeInRight,
  FadeOutDown,
} from 'react-native-reanimated';
import { Hourglass, Skull } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS } from '@/constants/avatars';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// One shared mockup, one perspective — unlike CoinFlipTutorial's split
// screen, every player sees the same board here, so a single phone tells
// the whole story. Mirrors TwentyOneGameUI exactly: the magenta-tinted BG +
// full-bleed ambient/danger radial glow, the personal turn-distance badge
// (fixed height/borderWidth across states), the current/next avatar duo
// above the ring — animated between turns the same way RouletteGameUI's
// turn queue is, not a hard cut — the floating "+X" toast between them,
// and the ring/counter nudged above true center.
//
// Full round-trip story: the counter climbs through three other players'
// turns while the viewer's own distance counts down (3 → 2 → 1, with the
// "YOU'RE NEXT" amber warning firing the instant the viewer becomes the
// up-next avatar), then the viewer's own turn (the finger tap), then one
// more turn past the viewer that busts — so every urgency state and the
// loss banner all get a real beat, not just the tap itself. Each beat
// lands 2s apart, matching the real game's own pacing on this screen.

const TARGET = 21;
const ACCENT = '#D946EF';
const BG = '#150A17';
const COLOR_STOPS = [0, 14, 18, TARGET];
const COLOR_RAMP = [colors.go, colors.amber, colors.stop, colors.stop];
const GLOW_OPACITY_RAMP = [0, 0.16, 0.4, 0.58];

// 4 players: the viewer, plus 3 named others — enough for the viewer's
// distance to start at 3 and tick all the way down to 0.
const TOTAL_PLAYERS = 4;
const ME = 'Player 1';
const OTHER_1 = 'Player 2';
const OTHER_2 = 'Player 3';
const OTHER_3 = 'Player 4';

// Real avatar art for this story's cast, same AVATAR_POOL the real game
// assigns from, instead of a generic initial-letter placeholder — this
// tutorial has no real player_ids to key off of, so the mapping is just
// hardcoded per name.
const PLAYER_AVATARS: Record<string, string> = {
  [ME]: 'fox',
  [OTHER_1]: 'owl',
  [OTHER_2]: 'panda',
  [OTHER_3]: 'tiger',
};

const RING_SIZE = 108;
const RING_STROKE = 9;
const AVATAR_SIZE_CURRENT = 52;
const AVATAR_SIZE_NEXT = 34;

// ── Choreography timeline ────────────────────────────────────────────────
// A full 2s per beat — enough to actually read what changed between turns
// — then the viewer's own turn takes a bit longer to let the finger tap
// read clearly, then a final 2s beat for the bust.
const T_STEP1 = 2_000;
const T_STEP2 = 4_000;
const T_STEP3 = 6_000; // becomes the viewer's turn
const FINGER_APPEAR_DELAY = 300; // after step3 starts, before the hand shows up
const FINGER_GLIDE_MS = 300;
const FINGER_HOVER_MS = 150;
const FINGER_PRESS_MS = 150;
const AFTER_PRESS_DELAY = 250; // press lands → counter/turn flip
const T_FINGER_IN = T_STEP3 + FINGER_APPEAR_DELAY;
const T_FINGER_PRESS = T_FINGER_IN + FINGER_GLIDE_MS + FINGER_HOVER_MS;
const T_STEP5 = T_FINGER_PRESS + FINGER_PRESS_MS + AFTER_PRESS_DELAY;
const T_BUST = T_STEP5 + 2_000;

type Stage = 'start' | 'step1' | 'step2' | 'step3' | 'step5' | 'bust';
type FingerPhase = 'hidden' | 'in' | 'press';
type Urgency = 'now' | 'next' | 'later';

interface StageInfo {
  count: number;
  currentName: string;
  nextName: string;
  isMeCurrent: boolean;
  isMeNext: boolean;
  distance: number;
  toastAmount: number | null;
}

// The fixed part of the story — what the board looks like at each beat.
// Turn order cycles Player2 → Player3 → Player4 → (viewer) → Player2 → ...,
// so the viewer's distance counts 3 → 2 → 1 → 0, then wraps back to 3 the
// instant their own turn passes, right before the round-ending bust.
function stageInfo(stage: Stage): StageInfo {
  switch (stage) {
    case 'start':
      return { count: 12, currentName: OTHER_1, nextName: OTHER_2, isMeCurrent: false, isMeNext: false, distance: TOTAL_PLAYERS - 1, toastAmount: null };
    case 'step1':
      return { count: 13, currentName: OTHER_2, nextName: OTHER_3, isMeCurrent: false, isMeNext: false, distance: 2, toastAmount: 1 };
    case 'step2':
      return { count: 16, currentName: OTHER_3, nextName: ME, isMeCurrent: false, isMeNext: true, distance: 1, toastAmount: 3 };
    case 'step3':
      return { count: 18, currentName: ME, nextName: OTHER_1, isMeCurrent: true, isMeNext: false, distance: 0, toastAmount: 2 };
    case 'step5':
      return { count: 20, currentName: OTHER_1, nextName: OTHER_2, isMeCurrent: false, isMeNext: false, distance: TOTAL_PLAYERS - 1, toastAmount: 2 };
    case 'bust':
      return { count: 21, currentName: OTHER_1, nextName: OTHER_2, isMeCurrent: false, isMeNext: false, distance: TOTAL_PLAYERS - 1, toastAmount: 1 };
  }
}

// SVG <Stop> elements only live inside <Defs> and never draw anything
// themselves, so they have no native host instance for Reanimated to
// attach animatedProps to (Animated.createAnimatedComponent(Stop) throws
// "Cannot find host instance for this component" at runtime — mirrors the
// same fix in TwentyOneGameUI's DangerGlow). Color steps at the same
// thresholds as the ring/counter instead of hue-interpolating every frame;
// only the glow's overall intensity (a real View's opacity) animates smoothly.
function dangerStepColor(count: number): string {
  if (count >= 18) return colors.stop;
  if (count >= 14) return colors.amber;
  return colors.go;
}

// Same permanent ambient wash + count-driven danger bloom as
// TwentyOneGameUI's DangerGlow — rendered full-bleed behind the whole
// simulated screen (not just the ring's own box), same fix as the real
// component: confining it to a smaller container left a visible
// rectangular seam where the glow ended and the flat background resumed.
function MiniDangerGlow({ count }: { count: number }): React.ReactElement {
  const progress = useSharedValue(count / TARGET);

  useEffect(() => {
    progress.value = withTiming(count / TARGET, {
      duration: 420,
      easing: Easing.out(Easing.quad),
    });
  }, [count, progress]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value * TARGET, COLOR_STOPS, GLOW_OPACITY_RAMP, Extrapolation.CLAMP),
  }));

  const dangerColor = dangerStepColor(count);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient id="tutorialAmbientGlow" cx="50%" cy="46%" r="75%">
            <Stop offset="0" stopColor={ACCENT} stopOpacity={0.14} />
            <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tutorialAmbientGlow)" />
      </Svg>

      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, glowStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="tutorialDangerGlow" cx="50%" cy="46%" r="60%">
              <Stop offset="0" stopColor={dangerColor} stopOpacity={1} />
              <Stop offset="1" stopColor={dangerColor} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#tutorialDangerGlow)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// Mirrors TwentyOneGameUI's ValueRing exactly: ring stroke and the counter
// text both driven off the same progress value and the same
// COLOR_STOPS/COLOR_RAMP interpolation, instead of an approximated ternary.
function MiniRing({ count }: { count: number }): React.ReactElement {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(count / TARGET);

  useEffect(() => {
    progress.value = withTiming(count / TARGET, {
      duration: 420,
      easing: Easing.out(Easing.quad),
    });
  }, [count, progress]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
    stroke: interpolateColor(progress.value * TARGET, COLOR_STOPS, COLOR_RAMP),
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value * TARGET, COLOR_STOPS, COLOR_RAMP),
  }));

  return (
    <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: 'absolute' }}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          stroke={colors.rim}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={circumference}
          strokeLinecap="round"
          rotation={-90}
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
          animatedProps={ringProps}
        />
      </Svg>
      <Animated.Text
        style={[{ fontVariant: ['tabular-nums'], fontWeight: '900', fontSize: 40 }, textStyle]}
      >
        {count}
      </Animated.Text>
    </View>
  );
}

interface TurnQueueAvatarProps {
  role: 0 | 1;
  name: string;
  avatar: string;
  isMe: boolean;
  neutralRingColor: string;
}

// Scaled-down mirror of TwentyOneGameUI's TurnQueueAvatar: current (role 0,
// large) / up-next (role 1, smaller), keyed by NAME in a mapped list at the
// call site (names are this story's unique player IDs) rather than two
// hardcoded "slot A"/"slot B" blocks — so when a turn advances, whoever was
// "next" keeps their component identity as they move into "current" and
// `layout` animates the grow-and-reposition, same as RouletteGameUI's turn
// queue and the real TwentyOneGameUI. This story's cast has real avatar art
// hardcoded via PLAYER_AVATARS (see above), same AVATAR_IMAGES the real
// game renders from, instead of a placeholder initial letter.
const TurnQueueAvatar: React.FC<TurnQueueAvatarProps> = ({ role, name, avatar, isMe, neutralRingColor }) => {
  const size = role === 0 ? AVATAR_SIZE_CURRENT : AVATAR_SIZE_NEXT;
  const avatarSource = AVATAR_IMAGES[avatar];
  const fallbackBg = AVATAR_COLORS[avatar];

  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isMe) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 480, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 480, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
    return () => cancelAnimation(pulse);
  }, [isMe, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(16).stiffness(140)}
      entering={FadeInRight.duration(260)}
      exiting={FadeOutDown.duration(200)}
      style={{ alignItems: 'center' }}
    >
      {role === 1 && (
        <Text style={{ ...typography.label, fontSize: 6, color: colors.fog, marginBottom: 4 }}>
          UP NEXT
        </Text>
      )}
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: isMe ? 3 : 2,
            borderColor: isMe ? ACCENT : neutralRingColor,
            overflow: 'hidden',
            backgroundColor: fallbackBg,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: ACCENT,
            shadowOpacity: isMe ? 0.8 : 0,
            shadowRadius: isMe ? 10 : 0,
            shadowOffset: { width: 0, height: 0 },
            elevation: isMe ? 8 : 0,
          },
          pulseStyle,
        ]}
      >
        <Image source={avatarSource} style={{ width: size, height: size }} resizeMode="cover" />
      </Animated.View>

      {isMe ? (
        <View
          style={{
            marginTop: -8,
            paddingHorizontal: 6,
            paddingVertical: 1.5,
            borderRadius: 7,
            backgroundColor: ACCENT,
            borderWidth: 1.5,
            borderColor: BG,
          }}
        >
          <Text style={{ color: colors.chalk, fontSize: 7, fontWeight: '900', letterSpacing: 0.5 }}>
            YOU
          </Text>
        </View>
      ) : (
        // Everyone else gets their name spelled out underneath — the
        // viewer's own avatar skips this since the "YOU" pin already says
        // it more clearly, mirroring TwentyOneGameUI's TurnQueueAvatar.
        <Text
          numberOfLines={1}
          style={{
            ...typography.label,
            fontSize: role === 0 ? 7 : 6,
            color: colors.chalk,
            marginTop: 3,
            maxWidth: size + 16,
          }}
        >
          {name}
        </Text>
      )}
    </Animated.View>
  );
};

// Mirrors TwentyOneGameUI's PersonalTurnBadge exactly: solid pulsing accent
// pill for "now", outlined amber pill for "next", quiet neutral pill with
// an hourglass for "later". Height and borderWidth are constant across all
// three states (only color/fill/text vary) so the badge never resizes —
// and nothing around it reflows — the instant the turn rotates.
function MiniPersonalTurnBadge({ label, urgency }: { label: string; urgency: Urgency }): React.ReactElement {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (urgency === 'now') {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 420, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
    return () => cancelAnimation(pulse);
  }, [urgency, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const isNow = urgency === 'now';
  const isNext = urgency === 'next';

  return (
    <Animated.View
      style={[
        {
          height: 22,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          borderRadius: 999,
          paddingHorizontal: 12,
          borderWidth: 1.5,
          borderColor: isNow ? ACCENT : isNext ? colors.amber : colors.rim,
          backgroundColor: isNow ? ACCENT : 'transparent',
          shadowColor: ACCENT,
          shadowOpacity: isNow ? 0.6 : 0,
          shadowRadius: isNow ? 10 : 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: isNow ? 6 : 0,
        },
        pulseStyle,
      ]}
    >
      {urgency === 'later' && <Hourglass size={10} color={colors.fog} strokeWidth={2.5} />}
      <Text
        style={{
          ...typography.label,
          fontSize: isNow ? 10 : 8,
          color: isNow ? colors.chalk : isNext ? colors.amber : colors.fog,
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

// Mirrors TwentyOneGameUI's IncrementToast: a small glowing chip that rises
// and fades. Durations are compressed (~1s instead of ~2s) since this
// tutorial's beats land ~2s apart, not fast enough to need the full-length
// float, but still fast enough that the real 2s version would linger into
// the next beat's toast.
function MiniIncrementToast({ amount, triggerKey }: { amount: number | null; triggerKey: string }): React.ReactElement | null {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (amount == null) return;
    opacity.value = 0;
    translateY.value = 0;
    opacity.value = withSequence(
      withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 380 }),
      withTiming(0, { duration: 400 }),
    );
    translateY.value = withTiming(-14, { duration: 900, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (amount == null) return null;

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute' }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: 'rgba(217,70,239,0.16)',
          borderWidth: 1,
          borderColor: ACCENT,
          shadowColor: ACCENT,
          shadowOpacity: 0.6,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
        }}
      >
        <Text style={{ color: colors.fog, fontSize: 8, fontWeight: '600', marginBottom: 1 }}>+</Text>
        <Text style={{ color: colors.chalk, fontSize: 13, fontWeight: '900' }}>{amount}</Text>
      </View>
    </Animated.View>
  );
}

function MiniButton({
  amount,
  isTarget,
  enabled,
  fingerPhase,
}: {
  amount: number;
  isTarget: boolean;
  enabled: boolean;
  fingerPhase: FingerPhase;
}): React.ReactElement {
  const press = useSharedValue(1);

  useEffect(() => {
    if (isTarget && fingerPhase === 'press') {
      press.value = withSequence(
        withTiming(0.86, { duration: 110, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }),
      );
    }
  }, [isTarget, fingerPhase, press]);

  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View
      style={[
        {
          width: 44,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'center',
          paddingVertical: 9,
          borderRadius: 999,
          borderWidth: 1.5,
          backgroundColor: enabled ? colors.surface : '#1A1A24',
          borderColor: enabled ? ACCENT : colors.rim,
          shadowColor: ACCENT,
          shadowOpacity: enabled ? 0.5 : 0,
          shadowRadius: enabled ? 8 : 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: enabled ? 6 : 0,
        },
        pressStyle,
      ]}
    >
      <Text style={{ color: enabled ? colors.fog : '#4A4A55', fontSize: 9, fontWeight: '600', marginBottom: 1 }}>
        +
      </Text>
      <Text style={{ color: enabled ? colors.chalk : colors.fog, fontSize: 15, fontWeight: '900' }}>
        {amount}
      </Text>
    </Animated.View>
  );
}

export function TwentyOneTutorial(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('start');
  const [fingerPhase, setFingerPhase] = useState<FingerPhase>('hidden');

  const fingerOpacity = useSharedValue(0);
  const fingerScale = useSharedValue(1);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage('step1'), T_STEP1),
      setTimeout(() => setStage('step2'), T_STEP2),
      setTimeout(() => setStage('step3'), T_STEP3),
      setTimeout(() => {
        setFingerPhase('in');
        fingerOpacity.value = withTiming(1, { duration: FINGER_GLIDE_MS });
      }, T_FINGER_IN),
      setTimeout(() => {
        setFingerPhase('press');
        fingerScale.value = withSequence(
          withTiming(0.82, { duration: 110, easing: Easing.in(Easing.quad) }),
          withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }),
        );
      }, T_FINGER_PRESS),
      setTimeout(() => {
        setStage('step5');
        fingerOpacity.value = withTiming(0, { duration: 250 });
      }, T_STEP5),
      setTimeout(() => setStage('bust'), T_BUST),
    ];
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(fingerOpacity);
      cancelAnimation(fingerScale);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [{ scale: fingerScale.value }],
  }));

  const info = stageInfo(stage);
  const finished = stage === 'bust';
  const urgency: Urgency = info.distance === 0 ? 'now' : info.distance === 1 ? 'next' : 'later';
  const personalLabel =
    info.distance === 0 ? 'YOUR TURN' : info.distance === 1 ? "YOU'RE NEXT" : `${info.distance} TURNS TO GO`;
  const currentCaption = info.isMeCurrent ? 'YOUR TURN' : `${info.currentName.toUpperCase()}'S TURN`;

  // [current, next] — mapped and keyed by name (this story's unique player
  // IDs), same convention as TwentyOneGameUI's duoPids, so React recognizes
  // the same avatar moving between roles across a turn advance instead of
  // hard-cutting to a freshly mounted one.
  const duoNames = finished ? [] : [info.currentName, info.nextName];

  return (
    <View className="items-center">
      {/* Phone-in-phone container, matching ReflexTutorial's frame */}
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

        {/* Simulated game screen — mirrors TwentyOneGameUI's magenta-tinted
            board, danger glow, personal-turn badge, avatar duo, and toast. */}
        <View style={{ flex: 1, width: '100%', alignItems: 'center', backgroundColor: BG, paddingHorizontal: 16 }}>
          {/* Ambient/danger glow — full-bleed behind everything on this
              simulated screen, not just the ring. */}
          <MiniDangerGlow count={info.count} />

          {/* Top — the viewer's own distance to their next turn. */}
          <View style={{ marginTop: 8, alignItems: 'center', minHeight: 26, justifyContent: 'center' }}>
            {!finished && <MiniPersonalTurnBadge label={personalLabel} urgency={urgency} />}
          </View>

          {/* Middle-top — turn duo, above the ring rather than below it.
              Keyed by name so the turn-advance transition animates. */}
          {duoNames.length > 0 && (
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
              {duoNames.map((name, i) => (
                <TurnQueueAvatar
                  key={name}
                  role={i as 0 | 1}
                  name={name}
                  avatar={PLAYER_AVATARS[name]}
                  isMe={i === 0 ? info.isMeCurrent : info.isMeNext}
                  neutralRingColor={i === 0 ? colors.go : colors.rim}
                />
              ))}
            </View>
          )}

          {/* Floating "+X" toast — between the turn duo and the ring, in a
              fixed-height slot so it never shifts anything around it. The
              extra top margin keeps its upward float clear of the avatar
              names just above it. */}
          <View style={{ marginTop: 6, height: 24, alignItems: 'center', justifyContent: 'center' }}>
            <MiniIncrementToast amount={info.toastAmount} triggerKey={stage} />
          </View>

          {/* Center — ring + counter, nudged slightly above true vertical
              center via the paddingBottom bias, same as TwentyOneGameUI. */}
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 14 }}>
            <MiniRing count={info.count} />

            <View style={{ marginTop: 10, alignItems: 'center', minHeight: 14 }}>
              {!finished && (
                <Text style={{ ...typography.label, fontSize: 9, color: info.isMeCurrent ? ACCENT : colors.chalk }}>
                  {currentCaption}
                </Text>
              )}
            </View>
          </View>

          {/* Controls row, with the tapping finger over +2. Generous
              marginBottom keeps them clear of the screen's bottom edge. */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 50 }}>
            {[1, 2, 3].map((amount) => (
              <View key={amount}>
                <MiniButton
                  amount={amount}
                  isTarget={amount === 2}
                  enabled={info.isMeCurrent && info.count + amount <= TARGET}
                  fingerPhase={fingerPhase}
                />
                {amount === 2 && (
                  <Animated.View
                    style={[
                      {
                        position: 'absolute',
                        // tap-gesture.png's fingertip sits right at the
                        // image's own top edge, so `top` here is ~where the
                        // tip itself lands (not the image's center) — this
                        // container has no offset from the button's top, so
                        // a negative-or-zero top leaves the tip hovering
                        // above the button entirely. Push it down into the
                        // button's own vertical middle instead.
                        top: 14,
                        left: 0,
                        zIndex: 30,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 8 },
                        shadowOpacity: 0.5,
                        shadowRadius: 10,
                        elevation: 24,
                      },
                      fingerStyle,
                    ]}
                  >
                    <Image
                      source={require('@/assets/images/tap-gesture.png')}
                      style={{ width: 44, height: 44 }}
                    />
                  </Animated.View>
                )}
              </View>
            ))}
          </View>
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

        {/* End-of-round banner — mirrors TwentyOneGameUI's exactly: always
            red with a skull, naming whoever hit 21, same for every viewer. */}
        {finished && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(10,10,15,0.7)',
            }}
          >
            <View
              style={{
                alignItems: 'center',
                paddingVertical: 16,
                paddingHorizontal: 20,
                backgroundColor: colors.stop,
                borderWidth: 2,
                borderColor: colors.chalk,
                borderRadius: 10,
              }}
            >
              <Skull size={22} color={colors.chalk} strokeWidth={2} />
              <Text
                style={{
                  color: colors.chalk,
                  fontSize: 16,
                  fontWeight: '900',
                  letterSpacing: 0.5,
                  marginTop: 6,
                  textAlign: 'center',
                }}
              >
                {info.currentName.toUpperCase()}
              </Text>
              <Text style={{ ...typography.label, color: colors.chalk, fontSize: 8, marginTop: 6, opacity: 0.9 }}>
                2 chasers · −8 pts
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
