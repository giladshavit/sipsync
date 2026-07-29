import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View, Image } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { Anchor, Check, Crown, Eye, MessageCircle, Wine, X } from 'lucide-react-native';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';

type Face = 'heads' | 'tails';

// Coin flip: spins for FLIP_MS with a hop, then settles on the result
const FLIP_MS = 2_400;
const COIN_SIZE = 168;
const BUTTON_SIZE = 136;
// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the round resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// Warm near-black for both seats — no navy. Flipper and guessers share the
// same base so the only cue that tells the two roles apart is the glow tint.
const BG_FLIPPER = '#17130E';
const BG_GUESSER = '#141210';
const GLOW_FLIPPER = colors.amberGlow; // warm gold — the secret they hold
const GLOW_GUESSER = colors.chalk; // soft moonlight — the room reading it

// Concentric, gradually-fading rings fake a soft radial glow without a
// gradient dependency — more, fainter layers read smoother than a couple of
// hard-edged circles
const GLOW_RINGS = [
  { size: 560, opacity: 0.035 },
  { size: 420, opacity: 0.05 },
  { size: 300, opacity: 0.075 },
  { size: 190, opacity: 0.11 },
];
const GLOW_ANCHOR_Y = 210;

const GOLD = { bg: '#F59E0B', rim: '#FCD34D', ink: '#78350F' };
const SILVER = { bg: '#B8C4D0', rim: '#E8EDF2', ink: '#1E293B' };

// Small tracked-caps stat/label text — see constants/design.ts's typography
// note for why this isn't Courier New anymore.
const MONO = typography.label;

const FACE_META: Record<Face, { label: string; palette: typeof GOLD; Icon: typeof Crown }> = {
  heads: { label: 'HEADS', palette: GOLD, Icon: Crown },
  tails: { label: 'TAILS', palette: SILVER, Icon: Anchor },
};

// ── Ambient glow — soft radial-ish backdrop behind the coin, built from
// plain layered Views (no gradient lib in this project) ────────────────────

function AmbientGlow({ tint }: { tint: string }): React.ReactElement {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      {GLOW_RINGS.map(({ size, opacity }) => (
        <View
          key={size}
          style={{
            position: 'absolute',
            top: GLOW_ANCHOR_Y - size / 2,
            left: '50%',
            width: size,
            height: size,
            marginLeft: -size / 2,
            borderRadius: size / 2,
            backgroundColor: tint,
            opacity,
          }}
        />
      ))}
    </View>
  );
}

// ── Pill badge — the prompt banner ("announce it" / "believe them?") ───────

function PromptBadge({
  icon: Icon,
  children,
  tint,
}: {
  icon: typeof MessageCircle;
  children: React.ReactNode;
  tint: string;
}): React.ReactElement {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
        paddingVertical: 9,
        paddingHorizontal: 18,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1.5,
        borderColor: tint,
      }}
    >
      <Icon size={16} color={tint} strokeWidth={2.5} />
      <Text
        style={{
          color: colors.chalk,
          fontSize: 14,
          fontWeight: '800',
          letterSpacing: 0.3,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

// ── Flipper badge — replaces the old plain-text header with the actual
// person: their avatar (sized to the circle) and name, with a small caption
// underneath instead of one all-caps sentence carrying everything ─────────

const FLIPPER_AVATAR_SIZE = 60;

function FlipperBadge({
  name,
  avatar,
  isSelf,
}: {
  name: string;
  avatar: string | null | undefined;
  isSelf: boolean;
}): React.ReactElement {
  const avatarSource = avatar ? AVATAR_IMAGES[avatar] : undefined;
  const ringColor = avatar ? AVATAR_COLORS[avatar] : avatarFallbackColor(name);
  const initial = (name.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: FLIPPER_AVATAR_SIZE,
          height: FLIPPER_AVATAR_SIZE,
          borderRadius: FLIPPER_AVATAR_SIZE / 2,
          overflow: 'hidden',
          borderWidth: 3,
          borderColor: colors.amberGlow,
          backgroundColor: avatarSource ? colors.parchment : ringColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {avatarSource ? (
          <Image
            source={avatarSource}
            style={{ width: FLIPPER_AVATAR_SIZE, height: FLIPPER_AVATAR_SIZE }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '700' }}>{initial}</Text>
        )}
      </View>
      <Text
        style={{
          color: colors.chalk,
          fontSize: 18,
          fontWeight: '900',
          letterSpacing: 0.3,
          marginTop: 8,
        }}
      >
        {isSelf ? 'You' : name}
      </Text>
      <Text
        style={{
          ...MONO,
          color: colors.amberGlow,
          fontSize: 10,
          marginTop: 2,
        }}
      >
        {isSelf ? "You're flipping" : 'Flipped the coin'}
      </Text>
    </View>
  );
}

// ── Stat chip — the bold status readout ("locked in" / "tap your call") ────

function StatChip({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent: boolean;
}): React.ReactElement {
  return (
    <View
      style={{
        marginTop: 30,
        paddingVertical: 11,
        paddingHorizontal: 22,
        borderRadius: 22,
        backgroundColor: accent ? colors.amber : colors.surface,
        borderWidth: 1.5,
        borderColor: accent ? colors.amberGlow : colors.rim,
      }}
    >
      <Text
        style={{
          color: accent ? '#241A05' : colors.chalk,
          fontSize: 15,
          fontWeight: '800',
          letterSpacing: 0.5,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

// ── Reveal card typography — matches the app's own kicker/hero-number
// convention (see podium.tsx, summary.tsx): a small tracked label tag
// labels a large bold-sans number, instead of one run-on sentence at a
// single weight ──────────────────────────────────────────────────────────

function Kicker({
  children,
  tint,
  style,
}: {
  children: React.ReactNode;
  tint: string;
  style?: object;
}): React.ReactElement {
  return (
    <Text
      style={{
        ...typography.label,
        fontWeight: '700',
        fontSize: 13,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: tint,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

function StatRow({
  icon: Icon,
  value,
  label,
  tint,
}: {
  icon: typeof Eye;
  value: number;
  label: string;
  tint: string;
}): React.ReactElement {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: 'rgba(0,0,0,0.22)',
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 14,
      }}
    >
      <Icon size={20} color={tint} strokeWidth={2.5} />
      <Text style={{ color: tint, fontSize: 28, fontWeight: '900' }}>{value}</Text>
      <Kicker tint={tint} style={{ flexShrink: 1 }}>
        {label}
      </Kicker>
    </View>
  );
}

/** Whether-you-drink readout — no points, just the chaser count that matters
 * right now. Renders nothing when no chaser is owed. */
function ChaserBadge({ chasers, tint }: { chasers: number; tint: string }): React.ReactElement | null {
  if (chasers <= 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 16,
        backgroundColor: 'rgba(0,0,0,0.22)',
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 16,
      }}
    >
      <Wine size={20} color={tint} strokeWidth={2.5} />
      <Text style={{ color: tint, fontSize: 22, fontWeight: '900' }}>{chasers}</Text>
      <Kicker tint={tint}>{chasers === 1 ? 'CHASER' : 'CHASERS'}</Kicker>
    </View>
  );
}

// ── Coin faces ───────────────────────────────────────────────────────────────

function CoinFace({ face, size }: { face: Face; size: number }): React.ReactElement {
  const { label, palette, Icon } = FACE_META[face];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.bg,
        borderWidth: size * 0.045,
        borderColor: palette.rim,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Inner minted ring */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.08,
          left: size * 0.08,
          right: size * 0.08,
          bottom: size * 0.08,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: palette.ink,
          opacity: 0.35,
        }}
      />
      <Icon size={size * 0.34} color={palette.ink} strokeWidth={2.5} />
      <Text
        style={{
          ...MONO,
          color: palette.ink,
          fontSize: size * 0.11,
          fontWeight: '900',
          marginTop: size * 0.03,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function MysteryCoinFace({ size }: { size: number }): React.ReactElement {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surface,
        borderWidth: size * 0.045,
        borderColor: colors.rim,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.fog, fontSize: size * 0.42, fontWeight: '900' }}>?</Text>
    </View>
  );
}

// ── Flipper's coin — real flip that lands on the result ─────────────────────

function FlippingCoin({
  result,
  instant,
}: {
  result: Face;
  /** Reconnecting mid-round — mount already settled, no flip animation. */
  instant: boolean;
}): React.ReactElement {
  // Faces swap via scaleY (|cos|-style fake 3D): a true rotateX layer with
  // perspective slices sibling layers in z-space (same pitfall the roulette
  // tutorial hit). spin counts half-turns; odd = result face up.
  const HALF_TURNS = 9; // odd count: starts on the back, ends on the result
  const spin = useSharedValue(instant ? HALF_TURNS : 0);
  const hop = useSharedValue(0);

  useEffect(() => {
    if (instant) return;
    spin.value = withTiming(HALF_TURNS, {
      duration: FLIP_MS,
      easing: Easing.out(Easing.cubic),
    });
    hop.value = withSequence(
      withTiming(-56, { duration: FLIP_MS * 0.42, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: FLIP_MS * 0.58, easing: Easing.bounce }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Squash follows a cosine so the coin thins edge-on mid half-turn
  const resultStyle = useAnimatedStyle(() => {
    const phase = spin.value * Math.PI; // one half-turn per unit
    const cos = Math.cos(phase);
    const showing = Math.round(spin.value) % 2 === 1;
    return {
      transform: [{ translateY: hop.value }, { scaleY: Math.abs(cos) }],
      opacity: showing ? 1 : 0,
    };
  });
  const backStyle = useAnimatedStyle(() => {
    const phase = spin.value * Math.PI;
    const cos = Math.cos(phase);
    const showing = Math.round(spin.value) % 2 === 1;
    return {
      position: 'absolute' as const,
      transform: [{ translateY: hop.value }, { scaleY: Math.abs(cos) }],
      opacity: showing ? 0 : 1,
    };
  });

  const other: Face = result === 'heads' ? 'tails' : 'heads';
  return (
    <View style={{ height: COIN_SIZE + 64, justifyContent: 'flex-end' }}>
      <Animated.View style={backStyle}>
        <CoinFace face={other} size={COIN_SIZE} />
      </Animated.View>
      <Animated.View style={resultStyle}>
        <CoinFace face={result} size={COIN_SIZE} />
      </Animated.View>
    </View>
  );
}

// ── Guesser's vote button ────────────────────────────────────────────────────

interface VoteButtonProps {
  face: Face;
  state: 'idle' | 'picked' | 'dimmed';
  disabled: boolean;
  onPress: (face: Face) => void;
}

// How much bigger the idle glow ring is than the button itself
const GLOW_PAD = 22;

function VoteButton({ face, state, disabled, onPress }: VoteButtonProps): React.ReactElement {
  const { label, palette, Icon } = FACE_META[face];
  const picked = state === 'picked';
  // Tappable and still undecided — the state this whole affordance is for
  const awaitingTap = state === 'idle' && !disabled;

  // Lock-in thump when this button becomes the pick
  const pop = useSharedValue(1);
  useEffect(() => {
    if (picked) {
      pop.value = withSequence(
        withTiming(1.12, { duration: 140, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 160 }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  // "Tap me" hint — gentle breathing scale on the button itself plus a soft
  // glow ring that pulses behind it, both only while a real choice is still
  // waiting on this player. Stops the instant they pick (or the vote closes)
  // rather than looping forever on an already-decided button.
  const tapPulse = useSharedValue(0);
  useEffect(() => {
    if (awaitingTap) {
      tapPulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    } else {
      tapPulse.value = withTiming(0, { duration: 150 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingTap]);
  const tapPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + tapPulse.value * 0.06 }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.15 + tapPulse.value * 0.35,
    transform: [{ scale: 0.88 + tapPulse.value * 0.12 }],
  }));

  return (
    <Pressable onPress={() => onPress(face)} disabled={disabled}>
      {({ pressed }) => (
        <Animated.View style={[popStyle, { alignItems: 'center', gap: 10 }]}>
          <View
            style={{
              width: BUTTON_SIZE + GLOW_PAD,
              height: BUTTON_SIZE + GLOW_PAD,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {awaitingTap && (
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: 'absolute',
                    width: BUTTON_SIZE + GLOW_PAD,
                    height: BUTTON_SIZE + GLOW_PAD,
                    borderRadius: (BUTTON_SIZE + GLOW_PAD) / 2,
                    backgroundColor: palette.rim,
                  },
                  glowStyle,
                ]}
              />
            )}
            <Animated.View
              style={[
                {
                  width: BUTTON_SIZE,
                  height: BUTTON_SIZE,
                  borderRadius: BUTTON_SIZE / 2,
                  backgroundColor: picked ? palette.bg : colors.surface,
                  borderWidth: 4,
                  borderColor: state === 'dimmed' ? colors.rim : palette.rim,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: state === 'dimmed' ? 0.35 : 1,
                  transform: pressed && !disabled ? [{ scale: 0.93 }] : [],
                },
                awaitingTap && tapPulseStyle,
              ]}
            >
              <Icon
                size={46}
                color={picked ? palette.ink : state === 'dimmed' ? colors.fog : palette.rim}
                strokeWidth={2.5}
              />
            </Animated.View>
          </View>
          <Text
            style={{
              ...MONO,
              color: state === 'dimmed' ? colors.fog : colors.chalk,
              fontSize: 15,
              fontWeight: '900',
            }}
          >
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export const CoinFlipGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const { playerId } = usePlayerIdentity();

  const status = (gameState.status as string) ?? 'PLAYING';
  const flipperId = (gameState.flipper_id as string) ?? null;
  const result = (gameState.result as Face) ?? 'heads';
  const votes = (gameState.votes as Record<string, Face>) ?? {};
  const voteMs = (gameState.vote_ms as number) ?? 20_000;
  const voteDeadlineAt = (gameState.vote_deadline_at as number) ?? 0;
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const avatars = (gameState.avatars as Record<string, string | null>) ?? {};
  const tally = (gameState.tally as { correct: number; wrong: number } | null) ?? null;

  const playing = status === 'PLAYING';
  const done = status === 'DONE';
  const isFlipper = !!playerId && playerId === flipperId;
  const myVote: Face | null = playerId ? (votes[playerId] ?? null) : null;
  const guesserCount = Math.max(0, Object.keys(displayNames).length - 1);
  const voteCount = Object.keys(votes).length;
  const flipperName = flipperId ? (displayNames[flipperId] ?? '?') : '?';

  const bg = isFlipper ? BG_FLIPPER : BG_GUESSER;
  const glow = isFlipper ? GLOW_FLIPPER : GLOW_GUESSER;

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // The flip runs FLIP_MS on the flipper's screen before the announce prompt.
  // Reconnecting clients mount mid-round — skip straight to the settled coin.
  const [flipDone, setFlipDone] = useState(
    () => voteDeadlineAt - clockOffset - Date.now() < voteMs - FLIP_MS,
  );
  // Frozen at mount: whether this client joined after the flip already landed
  const mountedSettled = useRef(flipDone);
  useEffect(() => {
    if (flipDone) return;
    const timer = setTimeout(() => setFlipDone(true), FLIP_MS + 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vote countdown bar, corrected from server time to this device's clock
  const timerProgress = useSharedValue(1);
  useEffect(() => {
    if (!playing || !voteDeadlineAt) return;
    const remaining = Math.max(0, voteDeadlineAt - clockOffset - Date.now());
    timerProgress.value = Math.min(1, remaining / voteMs);
    timerProgress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteDeadlineAt, playing, clockOffset, voteMs]);
  const timerBarStyle = useAnimatedStyle(() => ({
    width: `${timerProgress.value * 100}%` as `${number}%`,
  }));

  // Deadline watchdog — every client nudges the server once the window shuts;
  // the server validates against its own clock before resolving
  useEffect(() => {
    if (!playing || !voteDeadlineAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, voteDeadlineAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onActionRef.current('EXPIRE');
      retry = setInterval(() => onActionRef.current('EXPIRE'), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [voteDeadlineAt, playing, clockOffset]);

  // Guesser's mystery coin sways while the room decides
  const sway = useSharedValue(0);
  useEffect(() => {
    if (playing) {
      sway.value = withRepeat(
        withSequence(
          withTiming(-6, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(6, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    } else {
      sway.value = withTiming(0, { duration: 200 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  const swayStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sway.value}deg` }],
  }));

  // Reveal overlay slams in once the round resolves; game.tsx holds
  // navigation (END_HOLD_MS) so it plays before the summary screen
  const revealOpacity = useSharedValue(0);
  const revealScale = useSharedValue(0.8);
  useEffect(() => {
    if (!done) return;
    revealOpacity.value = withDelay(250, withTiming(1, { duration: 200 }));
    revealScale.value = withDelay(
      250,
      withSequence(
        withTiming(1.06, { duration: 220, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 130 }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: revealOpacity.value,
    transform: [{ scale: revealScale.value }],
  }));

  function handleVote(face: Face) {
    if (!myVote) onAction('VOTE', { choice: face });
  }

  // ── Per-viewer verdict for the reveal overlay ─────────────────────────────
  // Guessers get a plain right/wrong readout; the flipper gets the two tally
  // counts spelled out plainly (how many read the bluff, how many bought
  // it). Points aren't repeated here — the summary screen right after this
  // owns that number — but whether a chaser is owed still is, since that's
  // the thing to act on immediately.
  type Tone = 'good' | 'bad';
  type Verdict =
    | { role: 'guesser'; correct: boolean; voted: boolean; chasers: number; tone: Tone }
    | {
        role: 'flipper';
        headline: string;
        correctCount: number;
        wrongCount: number;
        chasers: number;
        tone: Tone;
      };

  let verdict: Verdict | null = null;
  if (done) {
    if (isFlipper && tally) {
      const calledOut = 2 * tally.correct > tally.correct + tally.wrong;
      // A tie is a win for the flipper — an exact split means no strict
      // majority read them, so they don't drink either.
      verdict = {
        role: 'flipper',
        headline: calledOut
          ? 'THEY READ YOU'
          : tally.wrong > tally.correct
            ? 'YOU FOOLED THE ROOM'
            : 'SPLIT DECISION',
        correctCount: tally.correct,
        wrongCount: tally.wrong,
        chasers: calledOut ? 2 : 0,
        tone: calledOut ? 'bad' : 'good',
      };
    } else if (!isFlipper) {
      const correct = myVote === result;
      verdict = {
        role: 'guesser',
        correct,
        voted: myVote !== null,
        chasers: correct ? 0 : 1,
        tone: correct ? 'good' : 'bad',
      };
    }
  }

  const TONE_BG: Record<Tone, string> = { good: colors.go, bad: colors.stop };
  const TONE_TEXT: Record<Tone, string> = { good: colors.chalk, bad: colors.chalk };

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <AmbientGlow tint={glow} />
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 56,
          paddingBottom: 32,
        }}
      >
        {/* Header — the flipper themself: avatar + name, not a text banner */}
        <View style={{ minHeight: 40, marginTop: 22, alignItems: 'center' }}>
          <FlipperBadge name={flipperName} avatar={avatars[flipperId ?? '']} isSelf={isFlipper} />
        </View>

        {/* Vote timer */}
        <View
          style={{
            height: 6,
            marginTop: 10,
            borderWidth: 1,
            borderColor: colors.rim,
            padding: 1,
            opacity: playing ? 1 : 0,
          }}
        >
          <Animated.View
            style={[{ height: '100%', backgroundColor: colors.amber }, timerBarStyle]}
          />
        </View>

        {/* Stage */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {isFlipper ? (
            <>
              <FlippingCoin result={result} instant={mountedSettled.current} />
              {flipDone ? (
                <>
                  <Text
                    style={{
                      color: FACE_META[result].palette.rim,
                      fontSize: 34,
                      fontWeight: '900',
                      letterSpacing: 4,
                      marginTop: 24,
                    }}
                  >
                    {FACE_META[result].label}
                  </Text>
                  <PromptBadge icon={MessageCircle} tint={colors.amberGlow}>
                    SAY IT OUT LOUD — TRUTH OR BLUFF
                  </PromptBadge>
                </>
              ) : (
                <Text
                  style={{
                    color: colors.chalk,
                    fontSize: 15,
                    fontWeight: '700',
                    marginTop: 24,
                    opacity: 0.85,
                  }}
                >
                  Flipping…
                </Text>
              )}
              <StatChip accent={voteCount === guesserCount && guesserCount > 0}>
                {voteCount}/{guesserCount} LOCKED IN
              </StatChip>
            </>
          ) : (
            <>
              <PromptBadge icon={Eye} tint={colors.silver}>
                DO YOU BELIEVE THEM?
              </PromptBadge>

              <Animated.View style={[swayStyle, { marginTop: 34 }]}>
                <MysteryCoinFace size={88} />
              </Animated.View>

              <View style={{ flexDirection: 'row', gap: 28, marginTop: 40 }}>
                <VoteButton
                  face="heads"
                  state={myVote === 'heads' ? 'picked' : myVote ? 'dimmed' : 'idle'}
                  disabled={!playing || !!myVote}
                  onPress={handleVote}
                />
                <VoteButton
                  face="tails"
                  state={myVote === 'tails' ? 'picked' : myVote ? 'dimmed' : 'idle'}
                  disabled={!playing || !!myVote}
                  onPress={handleVote}
                />
              </View>

              <StatChip accent={!!myVote}>
                {myVote ? `LOCKED IN · ${voteCount}/${guesserCount} VOTED` : 'TAP YOUR CALL'}
              </StatChip>
            </>
          )}
        </View>
      </View>

      {/* Reveal overlay */}
      {done && verdict && (
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
              backgroundColor: 'rgba(10,10,15,0.82)',
            },
            revealStyle,
          ]}
        >
          <CoinFace face={result} size={140} />
          <Text
            style={{
              color: colors.chalk,
              fontSize: 24,
              fontWeight: '900',
              letterSpacing: 2,
              marginTop: 20,
            }}
          >
            IT WAS {FACE_META[result].label}
          </Text>

          <View
            style={{
              alignItems: 'center',
              marginTop: 22,
              paddingVertical: 24,
              paddingHorizontal: 28,
              borderRadius: 20,
              borderWidth: 2,
              borderColor: 'rgba(255,255,255,0.3)',
              backgroundColor: TONE_BG[verdict.tone],
              maxWidth: 320,
            }}
          >
            {verdict.role === 'guesser' ? (
              <>
                <Kicker tint={TONE_TEXT[verdict.tone]} style={{ marginBottom: 6 }}>
                  Your guess
                </Kicker>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {verdict.correct ? (
                    <Check size={28} color={TONE_TEXT[verdict.tone]} strokeWidth={3} />
                  ) : (
                    <X size={28} color={TONE_TEXT[verdict.tone]} strokeWidth={3} />
                  )}
                  <Text
                    style={{
                      color: TONE_TEXT[verdict.tone],
                      fontSize: 27,
                      fontWeight: '900',
                      letterSpacing: 0.5,
                    }}
                  >
                    {verdict.correct ? 'YOU WERE RIGHT' : 'YOU WERE WRONG'}
                  </Text>
                </View>
                {!verdict.voted && (
                  <Kicker tint={TONE_TEXT[verdict.tone]} style={{ marginTop: 6 }}>
                    No guess submitted
                  </Kicker>
                )}
                <ChaserBadge chasers={verdict.chasers} tint={TONE_TEXT[verdict.tone]} />
              </>
            ) : (
              <>
                <Kicker tint={TONE_TEXT[verdict.tone]} style={{ marginBottom: 6 }}>
                  The room&apos;s verdict
                </Kicker>
                <Text
                  style={{
                    color: TONE_TEXT[verdict.tone],
                    fontSize: 25,
                    fontWeight: '900',
                    letterSpacing: 0.5,
                    textAlign: 'center',
                  }}
                >
                  {verdict.headline}
                </Text>
                <View style={{ marginTop: 14, gap: 8, width: '100%' }}>
                  <StatRow
                    icon={Wine}
                    value={verdict.wrongCount}
                    label="you fooled"
                    tint={TONE_TEXT[verdict.tone]}
                  />
                  <StatRow
                    icon={Eye}
                    value={verdict.correctCount}
                    label="saw through you"
                    tint={TONE_TEXT[verdict.tone]}
                  />
                </View>
                <ChaserBadge chasers={verdict.chasers} tint={TONE_TEXT[verdict.tone]} />
              </>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
};
