import React, { useEffect, useRef } from 'react';
import { Text, View, Pressable, Image } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withSequence,
  withRepeat,
  interpolate,
  interpolateColor,
  Extrapolation,
  Easing,
  LinearTransition,
  FadeInRight,
  FadeOutDown,
} from 'react-native-reanimated';
import { Hourglass, Skull } from 'lucide-react-native';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const TARGET = 21;
const AMOUNTS = [1, 2, 3] as const;
const ACCENT = '#D946EF';

// This game's own near-black — tinted toward the accent rather than the
// generic app-wide colors.ink, same convention as RouletteGameUI's felt and
// FlyingBombGameUI's BG each getting their own tint.
const BG = '#150A17';

// Danger thresholds for the ring/number color — cool at a fresh counter,
// warming through amber, hard red once a bust is close (see design notes:
// "cool to hot" as the count approaches 21).
const COLOR_STOPS = [0, 14, 18, TARGET];
const COLOR_RAMP = [colors.go, colors.amber, colors.stop, colors.stop];
// Same thresholds drive the ambient danger glow's intensity, kept subtle
// until real danger so it doesn't fight the ring for attention early on.
const GLOW_OPACITY_RAMP = [0, 0.16, 0.4, 0.58];

// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the turn advances —
// same watchdog pattern as RouletteGameUI.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

const RING_SIZE = 220;
const RING_STROKE = 16;
const AVATAR_SIZE_CURRENT = 76;
const AVATAR_SIZE_NEXT = 48;

interface LastEvent {
  type: string;
  player_id: string;
  amount: number;
  count: number;
  reason: 'pick' | 'timeout';
}

type Urgency = 'now' | 'next' | 'later';

// SVG <Stop> elements only ever live inside <Defs> — they never draw
// anything themselves, so they have no native host instance for Reanimated
// to attach animatedProps to (Animated.createAnimatedComponent(Stop)
// throws "Cannot find host instance for this component" at runtime, even
// though it typechecks fine). So the danger glow's color steps at the same
// thresholds as the ring/counter but isn't hue-interpolated frame-by-frame
// like they are — only its overall intensity (a real View's opacity, which
// Reanimated can animate) ramps smoothly.
function dangerStepColor(count: number): string {
  if (count >= 18) return colors.stop;
  if (count >= 14) return colors.amber;
  return colors.go;
}

// The signature move of this screen: the whole board's ambience — not just
// the ring — reads as the fuse. Rendered as a full-bleed layer behind the
// entire screen (not just the ring's own small box): confining it to a
// smaller container used to leave a visible rectangular seam where the
// glow's box ended and the flat background resumed, reading as "cut off"
// rather than ambient. A quiet, permanent accent-colored wash gives the
// game its own identity at a glance; a second glow, tied to the same danger
// ramp as the ring/counter, blooms in as the count climbs.
const DangerGlow: React.FC<{ count: number }> = ({ count }) => {
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
          <RadialGradient id="ambientGlow" cx="50%" cy="46%" r="75%">
            <Stop offset="0" stopColor={ACCENT} stopOpacity={0.14} />
            <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ambientGlow)" />
      </Svg>

      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, glowStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="dangerGlow" cx="50%" cy="46%" r="60%">
              <Stop offset="0" stopColor={dangerColor} stopOpacity={1} />
              <Stop offset="1" stopColor={dangerColor} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#dangerGlow)" />
        </Svg>
      </Animated.View>
    </View>
  );
};

const ValueRing: React.FC<{ count: number; children: React.ReactNode }> = ({
  count,
  children,
}) => {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(0); // 0 = empty, 1 = at 21

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
      {children}
    </View>
  );
};

function initialLetter(name: string): string {
  return (name.match(/[A-Za-zא-ת]/)?.[0] ?? '?').toUpperCase();
}

interface TurnQueueAvatarProps {
  role: 0 | 1;
  name: string;
  avatar: string | null | undefined;
  isMe: boolean;
  neutralRingColor: string;
}

// Current-turn (role 0, large) / up-next (role 1, smaller) avatar. Mounted
// keyed by player_id in a mapped list (see the render below) rather than
// two hardcoded "slot A"/"slot B" blocks — same convention as
// RouletteGameUI's TurnQueueSlot: when a turn advances, whoever was "next"
// keeps their same component identity as they move into the "current"
// role, so `layout` smoothly animates the grow-and-reposition instead of
// the old current abruptly vanishing and a new one popping into place.
// Whoever falls out of the two visible roles exits (fades down); whoever
// newly enters "next" fades in from the side.
//
// When it's the viewer's own — either their turn now or on deck next —
// the ring switches to the accent color, glows, breathes, and gets a small
// "YOU" pin: a real visual marker instead of relying on a text label alone.
const TurnQueueAvatar: React.FC<TurnQueueAvatarProps> = ({ role, name, avatar, isMe, neutralRingColor }) => {
  const size = role === 0 ? AVATAR_SIZE_CURRENT : AVATAR_SIZE_NEXT;
  const avatarSource = avatar ? AVATAR_IMAGES[avatar] : undefined;
  const fallbackBg = avatar ? AVATAR_COLORS[avatar] : avatarFallbackColor(name);

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
  }, [isMe, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(16).stiffness(140)}
      entering={FadeInRight.duration(280)}
      exiting={FadeOutDown.duration(220)}
      style={{ alignItems: 'center' }}
    >
      {role === 1 && (
        <Text style={{ ...typography.label, fontSize: 9, color: colors.fog, marginBottom: 6 }}>
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
            backgroundColor: avatarSource ? colors.parchment : fallbackBg,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: ACCENT,
            shadowOpacity: isMe ? 0.8 : 0,
            shadowRadius: isMe ? 12 : 0,
            shadowOffset: { width: 0, height: 0 },
            elevation: isMe ? 10 : 0,
          },
          pulseStyle,
        ]}
      >
        {avatarSource ? (
          <Image source={avatarSource} style={{ width: size, height: size }} resizeMode="cover" />
        ) : (
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.38 }}>
            {initialLetter(name)}
          </Text>
        )}
      </Animated.View>

      {isMe ? (
        <View
          style={{
            marginTop: -10,
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 8,
            backgroundColor: ACCENT,
            borderWidth: 1.5,
            borderColor: BG,
          }}
        >
          <Text style={{ color: colors.chalk, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>
            YOU
          </Text>
        </View>
      ) : (
        // Everyone else gets their name spelled out underneath — the
        // viewer's own avatar skips this since the "YOU" pin above already
        // says it more clearly than a repeated name would.
        <Text
          numberOfLines={1}
          style={{
            ...typography.label,
            fontSize: role === 0 ? 10 : 9,
            color: colors.chalk,
            marginTop: 5,
            maxWidth: size + 24,
          }}
        >
          {name}
        </Text>
      )}
    </Animated.View>
  );
};

// The viewer's own distance to their next turn. Three visually distinct
// states so "get ready" (next) never reads the same as "act now" (now):
// "now" is a solid, pulsing accent pill (impossible to miss); "next" is an
// outlined amber pill (a warning, not yet urgent — no fill); "later" is a
// quiet neutral pill with an hourglass, matching the surrounding chrome.
const PersonalTurnBadge: React.FC<{ label: string; urgency: Urgency }> = ({ label, urgency }) => {
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
  }, [urgency, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const isNow = urgency === 'now';
  const isNext = urgency === 'next';

  // Height and borderWidth are both constant across every urgency state —
  // only color/fill/text vary — so the badge never resizes (and nothing
  // around it reflows) the instant the turn rotates. A borderWidth that
  // toggled 0-vs-2 or a paddingVertical that toggled per-state used to
  // change the box's total rendered size on every transition.
  return (
    <Animated.View
      style={[
        {
          height: 34,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          borderRadius: 999,
          paddingHorizontal: 16,
          borderWidth: 2,
          borderColor: isNow ? ACCENT : isNext ? colors.amber : colors.rim,
          backgroundColor: isNow ? ACCENT : 'transparent',
          shadowColor: ACCENT,
          shadowOpacity: isNow ? 0.6 : 0,
          shadowRadius: isNow ? 14 : 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: isNow ? 8 : 0,
        },
        pulseStyle,
      ]}
    >
      {urgency === 'later' && <Hourglass size={13} color={colors.fog} strokeWidth={2.5} />}
      <Text
        style={{
          ...typography.label,
          fontSize: isNow ? 14 : 11,
          color: isNow ? colors.chalk : isNext ? colors.amber : colors.fog,
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
};

// Floating "+X" toast for the last increment that landed — whoever made it,
// human or server-forced. A small glowing chip (not bare text) that rises
// and fades over ~2s. `triggerKey` (the resulting count, which strictly
// increases every turn and so is unique per event within a round) is what
// re-fires the animation — `amount` alone isn't safe to key off, since two
// different turns can land the same amount (e.g. +2 then +2 again) without
// the value itself ever "changing" between renders.
const IncrementToast: React.FC<{ amount: number | null; triggerKey: number | null }> = ({
  amount,
  triggerKey,
}) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (triggerKey == null) return;
    opacity.value = 0;
    translateY.value = 0;
    opacity.value = withSequence(
      withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 900 }),
      withTiming(0, { duration: 950 }),
    );
    translateY.value = withTiming(-26, { duration: 2_000, easing: Easing.out(Easing.quad) });
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
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: 999,
          backgroundColor: 'rgba(217,70,239,0.16)',
          borderWidth: 1.5,
          borderColor: ACCENT,
          shadowColor: ACCENT,
          shadowOpacity: 0.6,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        }}
      >
        <Text style={{ color: colors.fog, fontSize: 14, fontWeight: '600', marginBottom: 2 }}>+</Text>
        <Text style={{ color: colors.chalk, fontSize: 22, fontWeight: '900', marginLeft: 1 }}>{amount}</Text>
      </View>
    </Animated.View>
  );
};

interface IncrementButtonProps {
  amount: number;
  enabled: boolean;
  ghostPress: boolean;
  onPress: (amount: number) => void;
}

const IncrementButton: React.FC<IncrementButtonProps> = ({
  amount,
  enabled,
  ghostPress,
  onPress,
}) => {
  // Two independent scale sources: `ghostPress` mimics a server-forced tap
  // (EXPIRE), `pressScale` is the real finger's own tactile feedback —
  // smoothly animated via onPressIn/onPressOut rather than the instant,
  // unanimated snap a bare `pressed &&` transform gives.
  const ghost = useSharedValue(1);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    if (!ghostPress) return;
    ghost.value = withSequence(
      withTiming(0.88, { duration: 110, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }),
    );
  }, [ghostPress, ghost]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ghost.value * pressScale.value }],
  }));

  function handlePressIn() {
    if (!enabled) return;
    pressScale.value = withTiming(0.92, { duration: 70, easing: Easing.out(Easing.quad) });
  }
  function handlePressOut() {
    pressScale.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.back(1.8)) });
  }

  return (
    <Pressable
      style={{ flex: 1 }}
      onPress={() => enabled && onPress(amount)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={!enabled}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingVertical: 20,
            borderRadius: 999,
            borderWidth: 2,
            backgroundColor: enabled ? colors.surface : '#1A1A24',
            borderColor: enabled ? ACCENT : colors.rim,
            shadowColor: ACCENT,
            shadowOpacity: enabled ? 0.5 : 0,
            shadowRadius: enabled ? 14 : 0,
            shadowOffset: { width: 0, height: 0 },
            elevation: enabled ? 8 : 0,
          },
          pressStyle,
        ]}
      >
        <Text
          style={{
            color: enabled ? colors.fog : '#4A4A55',
            fontSize: 18,
            fontWeight: '600',
            marginBottom: 3,
          }}
        >
          +
        </Text>
        <Text
          style={{
            color: enabled ? colors.chalk : colors.fog,
            fontSize: 32,
            fontWeight: '900',
            marginLeft: 1,
          }}
        >
          {amount}
        </Text>
      </Animated.View>
    </Pressable>
  );
};

export const TwentyOneGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const { playerId } = usePlayerIdentity();

  const status = (gameState.status as string) ?? 'PLAYING';
  const count = typeof gameState.count === 'number' ? gameState.count : 0;
  const currentPlayerId = (gameState.current_player_id as string | null) ?? null;
  const nextPlayerId = (gameState.next_player_id as string | null) ?? null;
  const turnMs = (gameState.turn_ms as number) ?? 12_000;
  const turnDeadlineAt = (gameState.turn_deadline_at as number) ?? 0;
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const avatars = (gameState.avatars as Record<string, string | null>) ?? {};
  const lastEvent = (gameState.last_event as LastEvent | null | undefined) ?? null;

  // turn_order/turn_index ride in the broadcast state (the server needs
  // them — see twenty_one.py's trust note), but the only thing derived from
  // them here is the VIEWER'S OWN distance to their next turn — an internal
  // number, never rendered as a player count or anyone else's position, so
  // it doesn't reintroduce the meta-gaming the hidden queue is meant to
  // prevent.
  const turnOrder = (gameState.turn_order as string[] | undefined) ?? [];
  const turnIndex = (gameState.turn_index as number) ?? 0;
  const totalPlayers = turnOrder.length || Object.keys(displayNames).length;
  const myQueueIndex = playerId ? turnOrder.indexOf(playerId) : -1;
  const myTurnDistance =
    myQueueIndex >= 0 && totalPlayers > 0
      ? (((myQueueIndex - turnIndex) % totalPlayers) + totalPlayers) % totalPlayers
      : null;

  const playing = status === 'PLAYING';
  const isMyTurn = playing && !!playerId && playerId === currentPlayerId;
  const isNextMe = playing && !!playerId && playerId === nextPlayerId;
  const finished = status === 'DONE';
  const loserId = finished ? lastEvent?.player_id ?? null : null;
  const loserName = loserId ? (displayNames[loserId] ?? '?') : null;

  // Which button the server auto-pressed on a turn timeout, for the ghost tap
  const ghostAmount =
    lastEvent?.reason === 'timeout' ? lastEvent.amount : null;

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Turn countdown bar, corrected from server time to this device's clock
  const timerProgress = useSharedValue(1);
  useEffect(() => {
    if (!playing || !turnDeadlineAt) return;
    const remaining = Math.max(0, turnDeadlineAt - clockOffset - Date.now());
    timerProgress.value = Math.min(1, remaining / turnMs);
    timerProgress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnDeadlineAt, playing, clockOffset, turnMs]);
  const timerBarStyle = useAnimatedStyle(() => ({
    width: `${timerProgress.value * 100}%` as `${number}%`,
  }));

  // Deadline watchdog — every client nudges the server if the current player
  // stalls; the server validates against its own clock and auto-increments.
  useEffect(() => {
    if (!playing || !turnDeadlineAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, turnDeadlineAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onActionRef.current('EXPIRE');
      retry = setInterval(() => onActionRef.current('EXPIRE'), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [turnDeadlineAt, playing, clockOffset]);

  // Number pulses on every change — landing on the exact same value twice in
  // a row (impossible mid-round, but matters for the frozen final frame)
  // shouldn't re-trigger it.
  const numberScale = useSharedValue(1);
  const prevCountRef = useRef(count);
  useEffect(() => {
    if (count === prevCountRef.current) return;
    prevCountRef.current = count;
    numberScale.value = withSequence(
      withTiming(1.18, { duration: 120, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
    );
  }, [count, numberScale]);
  const numberStyle = useAnimatedStyle(() => ({
    transform: [{ scale: numberScale.value }],
    color: interpolateColor(count, COLOR_STOPS, COLOR_RAMP),
  }));

  // Loss banner — fades/scales in once the round ends. game.tsx holds
  // navigation (END_HOLD_MS) so this plays before the summary screen.
  const bannerOpacity = useSharedValue(0);
  const bannerScale = useSharedValue(0);
  useEffect(() => {
    if (!finished) return;
    bannerOpacity.value = withTiming(1, { duration: 200 });
    bannerScale.value = withSequence(
      withTiming(1.08, { duration: 220, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 120 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);
  const bannerStyle = useAnimatedStyle(() => ({
    opacity: bannerOpacity.value,
    transform: [{ scale: bannerScale.value }],
  }));

  function handlePress(amount: number) {
    onAction('INCREMENT', { amount });
  }

  const currentName = displayNames[currentPlayerId ?? ''] ?? '?';
  const currentCaption = finished ? '' : isMyTurn ? 'YOUR TURN' : `${currentName}'s turn`;

  // [current, next] — mapped and keyed by player_id (not hardcoded "slot
  // A"/"slot B" JSX) so React can recognize the same avatar moving between
  // roles across a turn advance; see TurnQueueAvatar's own note.
  const duoPids = [currentPlayerId, nextPlayerId].filter((pid): pid is string => !!pid);

  const urgency: Urgency =
    myTurnDistance === 0 ? 'now' : myTurnDistance === 1 ? 'next' : 'later';
  const personalLabel =
    myTurnDistance === null
      ? null
      : myTurnDistance === 0
        ? 'YOUR TURN'
        : myTurnDistance === 1
          ? "YOU'RE NEXT"
          : `${myTurnDistance} TURNS TO GO`;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 56,
          paddingBottom: 88,
        }}
      >
        {/* Ambient/danger glow — a full-bleed layer behind everything on
            this screen, not just the ring, so there's no rectangular seam
            where a smaller glow box would have ended. */}
        <DangerGlow count={count} />

        {/* Turn timer */}
        <View
          style={{
            height: 6,
            borderWidth: 1,
            borderColor: colors.rim,
            padding: 1,
            opacity: playing ? 1 : 0,
          }}
        >
          <Animated.View
            style={[
              { height: '100%', backgroundColor: isMyTurn ? colors.go : colors.fog },
              timerBarStyle,
            ]}
          />
        </View>

        {/* Top — the viewer's own distance to their next turn, the single
            most personally relevant fact on screen. */}
        <View style={{ marginTop: 16, alignItems: 'center', minHeight: 44, justifyContent: 'center' }}>
          {!finished && personalLabel && <PersonalTurnBadge label={personalLabel} urgency={urgency} />}
        </View>

        {/* Middle-top — turn duo, current player large / next player
            smaller, sitting above the ring rather than below it. Everyone
            but the viewer gets their name under their avatar. Keyed by
            player_id so the turn-advance transition animates (see
            TurnQueueAvatar), not a hard cut. */}
        {!finished && duoPids.length > 0 && (
          <View
            style={{
              marginTop: 6,
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: 26,
            }}
          >
            {duoPids.map((pid, i) => (
              <TurnQueueAvatar
                key={pid}
                role={i as 0 | 1}
                name={displayNames[pid] ?? '?'}
                avatar={avatars[pid]}
                isMe={i === 0 ? isMyTurn : isNextMe}
                neutralRingColor={i === 0 ? colors.go : colors.rim}
              />
            ))}
          </View>
        )}

        {/* Floating "+X" toast for the last increment — sits between the
            turn duo and the ring, in a fixed-height slot so its
            appear/fade cycle never shifts anything around it. The extra
            top margin keeps its upward float clear of the avatar names
            just above, which it was drifting up into and covering. Not
            gated by `finished`: the move that busts the counter to 21 gets
            a toast too, same as any other turn. */}
        <View style={{ marginTop: 10, height: 30, alignItems: 'center', justifyContent: 'center' }}>
          <IncrementToast amount={lastEvent?.amount ?? null} triggerKey={lastEvent?.count ?? null} />
        </View>

        {/* Center — the ring + counter, nudged slightly above true vertical
            center (the paddingBottom biases the centered content upward)
            rather than dead-center or bottom-anchored. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 28 }}>
          <ValueRing count={count}>
            <Animated.Text
              style={[
                { fontVariant: ['tabular-nums'], fontWeight: '900', fontSize: 92 },
                numberStyle,
              ]}
            >
              {count}
            </Animated.Text>
          </ValueRing>

          <View style={{ marginTop: 22, alignItems: 'center', minHeight: 20 }}>
            {!finished && (
              <Text
                style={{
                  ...typography.label,
                  fontSize: 13,
                  color: isMyTurn ? ACCENT : colors.chalk,
                }}
              >
                {currentCaption}
              </Text>
            )}
          </View>
        </View>

        {/* Controls — always mounted so their disabled state itself reads as
            "not your turn" / "would bust", not just absence of buttons.
            Generous bottom padding on the outer container (above) keeps
            these clear of the screen's bottom edge. */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {AMOUNTS.map((amount) => (
            <IncrementButton
              key={amount}
              amount={amount}
              enabled={isMyTurn && count + amount <= TARGET}
              ghostPress={ghostAmount === amount && lastEvent?.player_id === currentPlayerId}
              onPress={handlePress}
            />
          ))}
        </View>
      </View>

      {/* End-of-round banner — always red with a skull, shown identically
          to everyone (winners included), naming whoever hit 21. */}
      {finished && loserName && (
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
              backgroundColor: 'rgba(10,10,15,0.7)',
            },
            bannerStyle,
          ]}
        >
          <View
            style={{
              alignItems: 'center',
              paddingVertical: 28,
              paddingHorizontal: 32,
              backgroundColor: colors.stop,
              borderWidth: 3,
              borderColor: colors.chalk,
              borderRadius: 12,
              maxWidth: 320,
            }}
          >
            <Skull size={40} color={colors.chalk} strokeWidth={2} />
            <Text
              style={{
                color: colors.chalk,
                fontSize: 26,
                fontWeight: '900',
                letterSpacing: 1,
                marginTop: 10,
                textAlign: 'center',
              }}
            >
              {loserName.toUpperCase()}
            </Text>
            <Text
              style={{
                ...typography.label,
                color: colors.chalk,
                fontSize: 12,
                marginTop: 10,
                opacity: 0.9,
              }}
            >
              2 chasers · −8 pts
            </Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
};
