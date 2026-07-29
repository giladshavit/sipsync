import React, { useEffect, useRef } from 'react';
import { Text, Pressable, View, Image, ScrollView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withRepeat,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { GlassWater, Handshake, ShieldCheck, Swords } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';

import { CountdownRing } from './CountdownRing';

// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the room resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// Small tracked-caps stat/label text — see constants/design.ts's typography
// note for why this isn't Courier New anymore.
const MONO = typography.label;

// This screen's title ("Prisoner's Dilemma") — the trial run for dropping
// Courier New that's now the app-wide standard (typography.title).
const TITLE = typography.title;

type Choice = 'HELP' | 'BETRAY';

interface Payoff {
  result: 'WIN' | 'LOSE';
  chasers: number;
  scoreDelta: number;
}

// Mirrors backend/app/games/dilemma.py's payoff matrix exactly. Game state is
// broadcast verbatim (same trust model as coin_flip/closest_average), so the
// client derives its own reveal from `choices` instead of waiting on the
// separate OUTCOMES message, which only lands in a ref and wouldn't
// re-render this screen anyway.
function payoff(mine: Choice, theirs: Choice): Payoff {
  if (mine === 'HELP' && theirs === 'HELP') return { result: 'WIN', chasers: 0, scoreDelta: 5 };
  if (mine === 'BETRAY' && theirs === 'BETRAY') return { result: 'LOSE', chasers: 1, scoreDelta: -5 };
  if (mine === 'BETRAY') return { result: 'WIN', chasers: 0, scoreDelta: 10 };
  return { result: 'LOSE', chasers: 2, scoreDelta: -10 };
}

// ── Opponent badge — who you're paired against this round: avatar + name,
// same pattern as coin_flip's FlipperBadge and roulette's turn queue rather
// than a bare name string ──────────────────────────────────────────────────

const OPPONENT_AVATAR_SIZE = 76;

function OpponentBadge({
  name,
  avatar,
}: {
  name: string;
  avatar: string | null | undefined;
}): React.ReactElement {
  const avatarSource = avatar ? AVATAR_IMAGES[avatar] : undefined;
  const ringColor = avatar ? AVATAR_COLORS[avatar] : avatarFallbackColor(name);
  const initial = (name.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: OPPONENT_AVATAR_SIZE,
          height: OPPONENT_AVATAR_SIZE,
          borderRadius: OPPONENT_AVATAR_SIZE / 2,
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
            style={{ width: OPPONENT_AVATAR_SIZE, height: OPPONENT_AVATAR_SIZE }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '700' }}>{initial}</Text>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: colors.chalk,
          fontSize: 26,
          fontWeight: '900',
          letterSpacing: -0.3,
          textAlign: 'center',
          marginTop: 10,
          maxWidth: 260,
        }}
      >
        {name}
      </Text>
    </View>
  );
}

// ── HELP / BETRAY choice button ──────────────────────────────────────────────

type ButtonState = 'idle' | 'picked' | 'dimmed';

function ChoiceButton({
  choice,
  state,
  disabled,
  onPress,
}: {
  choice: Choice;
  state: ButtonState;
  disabled: boolean;
  onPress: (choice: Choice) => void;
}): React.ReactElement {
  const isHelp = choice === 'HELP';
  const Icon = isHelp ? Handshake : Swords;
  const tint = isHelp ? colors.go : colors.stop;
  const picked = state === 'picked';
  const dimmed = state === 'dimmed';

  const pop = useSharedValue(1);
  useEffect(() => {
    if (picked) {
      pop.value = withSequence(
        withTiming(1.08, { duration: 140, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 180 }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  // Idle-state "pick me" cue — a soft wash across the whole button that
  // breathes in and out. Was a growing/fading border ring that snapped back
  // to start instantly every 1.4s (withTiming duration: 0), which read as a
  // flicker right where the ring's top edge reset; a plain opacity
  // oscillation (withRepeat's own reverse, no snap-back, no transform) can't
  // produce that seam, and covering the full button instead of just a thin
  // outline is the gentler, more even version asked for.
  const ripple = useSharedValue(0);
  useEffect(() => {
    if (state === 'idle' && !disabled) {
      ripple.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1_000, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1_000, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    } else {
      ripple.value = withTiming(0, { duration: 150 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, disabled]);
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ripple.value, [0, 1], [0.1, 0.32]),
  }));

  return (
    <Pressable onPress={() => onPress(choice)} disabled={disabled} style={{ flex: 1 }}>
      {({ pressed }) => (
        <View style={{ flex: 1 }}>
          {state === 'idle' && !disabled && (
            <Animated.View
              pointerEvents="none"
              style={[
                rippleStyle,
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 22,
                  backgroundColor: tint,
                },
              ]}
            />
          )}
          <Animated.View
            style={[
              popStyle,
              {
                flex: 1,
                minHeight: 168,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                backgroundColor: picked ? tint : colors.surface,
                borderWidth: 3,
                borderColor: dimmed ? colors.rim : tint,
                opacity: dimmed ? 0.35 : 1,
                transform: pressed && !disabled ? [{ scale: 0.96 }] : [],
              },
            ]}
          >
            <Icon size={44} color={picked ? colors.ink : dimmed ? colors.fog : tint} strokeWidth={2.5} />
            <Text
              style={{
                ...MONO,
                fontSize: 20,
                fontWeight: '900',
                color: picked ? colors.ink : dimmed ? colors.fog : colors.chalk,
              }}
            >
              {choice}
            </Text>
          </Animated.View>
        </View>
      )}
    </Pressable>
  );
}

// ── Reveal half — one side of the split screen ──────────────────────────────
// Color always tracks WIN/LOSE (green/red) regardless of choice, so the
// asymmetric "one betrays" case reads unambiguously: the betrayer's half
// goes green, the helper's half goes red.
//
// Headline wording depends on `perspective` too: the opponent's half is
// always read by the viewer as "what did they just do to me", so the two
// lopsided outcomes are phrased as an action directed at "you" ("BETRAYED
// YOU" / "TRUSTED YOU") rather than a generic third-person description. The
// viewer's own half stays first-person-implied ("BETRAYED THEM", "GOT
// BETRAYED") since there's no ambiguity about who it's about. Mutual
// outcomes are symmetric and need no "you"/"them" framing either way.

function halfAppearance(choice: Choice, result: 'WIN' | 'LOSE', perspective: 'you' | 'opponent') {
  const bg = result === 'WIN' ? colors.go : colors.stop;
  const ink = colors.chalk;
  if (choice === 'HELP' && result === 'WIN') {
    return { bg, Icon: Handshake, headline: 'STAYED LOYAL', ink };
  }
  if (choice === 'HELP') {
    // This side helped but still lost — the other side betrayed them.
    return {
      bg,
      Icon: Handshake,
      headline: perspective === 'opponent' ? 'TRUSTED YOU' : 'GOT BETRAYED',
      ink,
    };
  }
  if (result === 'WIN') {
    // This side betrayed the other and came out ahead.
    return {
      bg,
      Icon: Swords,
      headline: perspective === 'opponent' ? 'BETRAYED YOU' : 'BETRAYED THEM',
      ink,
    };
  }
  return { bg, Icon: Swords, headline: 'MUTUAL BETRAYAL', ink };
}

const REVEAL_AVATAR_SIZE = 64;

function RevealHalf({
  label,
  avatar,
  choice,
  scoreDelta,
  chasers,
  perspective,
  insetTop = 0,
  insetBottom = 0,
}: {
  label: string;
  avatar: string | null | undefined;
  choice: Choice;
  scoreDelta: number;
  chasers: number;
  perspective: 'you' | 'opponent';
  insetTop?: number;
  insetBottom?: number;
}): React.ReactElement {
  const result: 'WIN' | 'LOSE' = scoreDelta >= 0 ? 'WIN' : 'LOSE';
  const { bg, Icon, headline, ink } = halfAppearance(choice, result, perspective);
  const ringColor = avatar ? AVATAR_COLORS[avatar] : ink;
  const fallbackBg = avatarFallbackColor(label);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: insetTop,
        paddingBottom: insetBottom,
      }}
    >
      <View
        style={{
          width: REVEAL_AVATAR_SIZE,
          height: REVEAL_AVATAR_SIZE,
          borderRadius: REVEAL_AVATAR_SIZE / 2,
          overflow: 'hidden',
          borderWidth: 3,
          backgroundColor: avatar ? colors.parchment : fallbackBg,
          borderColor: ringColor,
          shadowColor: colors.ink,
          shadowOpacity: 0.35,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 5,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
        }}
      >
        {avatar ? (
          <Image
            source={AVATAR_IMAGES[avatar]}
            style={{ width: REVEAL_AVATAR_SIZE, height: REVEAL_AVATAR_SIZE }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '900' }}>
            {(label.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase()}
          </Text>
        )}
      </View>
      <Text style={{ ...MONO, color: ink, fontSize: 11, opacity: 0.7 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Icon size={30} color={ink} strokeWidth={2.5} />
        <Text style={{ color: ink, fontSize: 22, fontWeight: '900', letterSpacing: 0.3, textAlign: 'center' }}>
          {headline}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 }}>
        <Text style={{ ...MONO, color: ink, fontWeight: '800', fontSize: 17 }}>
          {scoreDelta >= 0 ? '+' : '−'}{Math.abs(scoreDelta)} PTS
        </Text>
        {chasers > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <GlassWater size={17} color={ink} strokeWidth={2.5} />
            <Text style={{ ...MONO, color: ink, fontWeight: '800', fontSize: 15 }}>
              {chasers} {chasers === 1 ? 'CHASER' : 'CHASERS'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// Bold diagonal ribbon seam between the two halves — plain layered Views, no
// gradient/SVG dependency (same "no gradient lib" constraint as CoinFlipUI's
// AmbientGlow).
function DiagonalSeam(): React.ReactElement {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -60,
        right: -60,
        top: '50%',
        height: 30,
        marginTop: -15,
        backgroundColor: colors.ink,
        borderTopWidth: 4,
        borderBottomWidth: 4,
        borderColor: colors.amber,
        transform: [{ rotate: '-4deg' }],
      }}
    />
  );
}

// ── Immune player's live "who's decided" readout (no choices shown) ────────

function ImmuneWaitingBoard({
  pairs,
  choices,
  displayNames,
}: {
  pairs: string[][];
  choices: Record<string, Choice>;
  displayNames: Record<string, string>;
}): React.ReactElement | null {
  if (pairs.length === 0) return null;
  return (
    <View style={{ width: '100%', marginTop: 20 }}>
      <Text style={{ ...MONO, color: colors.dune, fontSize: 10, marginBottom: 8 }}>
        Who&apos;s decided
      </Text>
      <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
        {pairs.map(([a, b], index) => {
          const aLocked = choices[a] !== undefined;
          const bLocked = choices[b] !== undefined;
          return (
            <View
              key={`${a}-${b}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 8,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.sand,
              }}
            >
              <Text numberOfLines={1} style={{ flex: 1, color: colors.ink, fontSize: 13, fontWeight: '600' }}>
                {displayNames[a] ?? '?'} <Text style={{ color: colors.dune }}>vs</Text> {displayNames[b] ?? '?'}
              </Text>
              <View
                style={{ width: 8, height: 8, borderRadius: 4, marginLeft: 6, backgroundColor: aLocked ? colors.amber : colors.sand }}
              />
              <View
                style={{ width: 8, height: 8, borderRadius: 4, marginLeft: 6, backgroundColor: bLocked ? colors.amber : colors.sand }}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Immune player's DONE report — every pair's outcome, now safe to reveal ──

function ImmuneReport({
  pairs,
  choices,
  displayNames,
}: {
  pairs: string[][];
  choices: Record<string, Choice>;
  displayNames: Record<string, string>;
}): React.ReactElement {
  return (
    <ScrollView style={{ width: '100%', marginTop: 20 }} showsVerticalScrollIndicator={false}>
      {pairs.map(([a, b], index) => {
        const ca = choices[a];
        const cb = choices[b];
        const pa = payoff(ca, cb);
        return (
          <View
            key={`${a}-${b}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.sand,
              gap: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 14, fontWeight: '800' }}>
                {displayNames[a] ?? '?'}
              </Text>
              <Text style={{ color: pa.result === 'WIN' ? colors.go : colors.stop, fontSize: 11, fontWeight: '700' }}>
                {ca} · {pa.scoreDelta >= 0 ? '+' : '−'}{Math.abs(pa.scoreDelta)} pts
              </Text>
            </View>
            {(ca === 'BETRAY') !== (cb === 'BETRAY') ? (
              <Swords size={16} color={colors.stop} strokeWidth={2.5} />
            ) : ca === 'HELP' ? (
              <Handshake size={16} color={colors.go} strokeWidth={2.5} />
            ) : (
              <Swords size={16} color={colors.stop} strokeWidth={2.5} />
            )}
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 14, fontWeight: '800' }}>
                {displayNames[b] ?? '?'}
              </Text>
              <Text
                style={{
                  color: payoff(cb, ca).result === 'WIN' ? colors.go : colors.stop,
                  fontSize: 11,
                  fontWeight: '700',
                }}
              >
                {cb} · {payoff(cb, ca).scoreDelta >= 0 ? '+' : '−'}{Math.abs(payoff(cb, ca).scoreDelta)} pts
              </Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export const DilemmaGameUI: React.FC<MiniGameProps> = ({ gameState, onAction, clockOffset }) => {
  const { playerId } = usePlayerIdentity();
  const insets = useSafeAreaInsets();

  const status = (gameState.status as string) ?? 'PLAYING';
  const partnerOf = (gameState.partner_of as Record<string, string>) ?? {};
  const immunePlayer = (gameState.immune_player as string | null) ?? null;
  const choices = (gameState.choices as Record<string, Choice>) ?? {};
  const pairs = (gameState.pairs as string[][]) ?? [];
  const turnMs = (gameState.turn_ms as number) ?? 30_000;
  const turnDeadlineAt = (gameState.turn_deadline_at as number) ?? 0;
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const avatars = (gameState.avatars as Record<string, string | null>) ?? {};

  const playing = status === 'PLAYING';
  const done = status === 'DONE';
  const isImmune = !!playerId && playerId === immunePlayer;
  const opponentId = playerId ? (partnerOf[playerId] ?? null) : null;
  const opponentName = opponentId ? (displayNames[opponentId] ?? '?') : '?';
  const opponentAvatar = opponentId ? avatars[opponentId] : undefined;
  const myAvatar = playerId ? avatars[playerId] : undefined;
  const myChoice = playerId ? (choices[playerId] ?? null) : null;

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Deadline watchdog — every client nudges the server once the window shuts;
  // the server validates against its own clock before resolving
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

  // Reveal punch-in; game.tsx holds navigation (END_HOLD_MS) so it plays
  // before the summary screen
  const revealOpacity = useSharedValue(0);
  const revealScale = useSharedValue(0.9);
  useEffect(() => {
    if (!done) return;
    revealOpacity.value = withTiming(1, { duration: 200 });
    revealScale.value = withSequence(
      withTiming(1.04, { duration: 200, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 120 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: revealOpacity.value,
    transform: [{ scale: revealScale.value }],
  }));

  function handleChoice(choice: Choice) {
    if (playing && !myChoice) onAction('CHOOSE', { choice });
  }

  // ── REVEAL / DONE ──────────────────────────────────────────────────────────
  if (done) {
    if (isImmune) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.cream }}>
          <Animated.View
            style={[
              revealStyle,
              {
                flex: 1,
                width: '100%',
                maxWidth: 420,
                alignSelf: 'center',
                paddingHorizontal: 24,
                paddingTop: 32 + insets.top,
                paddingBottom: 24 + insets.bottom,
              },
            ]}
          >
            <View style={{ alignItems: 'center' }}>
              <ShieldCheck size={40} color={colors.amber} strokeWidth={2.5} />
              <Text style={{ ...MONO, color: colors.amber, fontSize: 12, marginTop: 8 }}>Immune</Text>
              <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: 4, textAlign: 'center' }}>
                You watched the chaos
              </Text>
            </View>
            <ImmuneReport pairs={pairs} choices={choices} displayNames={displayNames} />
          </Animated.View>
        </View>
      );
    }

    const finalOpponentChoice = opponentId ? (choices[opponentId] ?? 'BETRAY') : 'BETRAY';
    const finalMyChoice = myChoice ?? 'BETRAY';
    const mine = payoff(finalMyChoice, finalOpponentChoice);
    const theirs = payoff(finalOpponentChoice, finalMyChoice);

    return (
      <View style={{ flex: 1, backgroundColor: colors.ink }}>
        <Animated.View style={[revealStyle, { flex: 1 }]}>
          <RevealHalf
            label={opponentName.toUpperCase()}
            avatar={opponentAvatar}
            choice={finalOpponentChoice}
            scoreDelta={theirs.scoreDelta}
            chasers={theirs.chasers}
            perspective="opponent"
            insetTop={insets.top}
          />
          <RevealHalf
            label="YOU"
            avatar={myAvatar}
            choice={finalMyChoice}
            scoreDelta={mine.scoreDelta}
            chasers={mine.chasers}
            perspective="you"
            insetBottom={insets.bottom}
          />
        </Animated.View>
        <DiagonalSeam />
      </View>
    );
  }

  // ── PLAYING — immune ─────────────────────────────────────────────────────
  if (isImmune) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream }}>
        <View
          style={{
            flex: 1,
            width: '100%',
            maxWidth: 420,
            alignSelf: 'center',
            paddingHorizontal: 24,
            paddingTop: 32 + insets.top,
            paddingBottom: 24 + insets.bottom,
          }}
        >
          <Text style={{ ...TITLE, color: colors.amber, fontSize: 15, textAlign: 'center' }}>
            Prisoner&apos;s Dilemma
          </Text>
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <CountdownRing
              deadlineAt={turnDeadlineAt}
              clockOffset={clockOffset}
              totalMs={turnMs}
              active={playing}
              size={84}
              strokeWidth={7}
              trackColor={colors.sand}
              textColor={colors.ink}
              highTimeColor={colors.amber}
            />
          </View>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ShieldCheck size={64} color={colors.amber} strokeWidth={2} />
            <Text style={{ color: colors.ink, fontSize: 26, fontWeight: '900', marginTop: 16, textAlign: 'center' }}>
              You have immunity{'\n'}this round
            </Text>
            <Text style={{ color: colors.dune, fontSize: 14, marginTop: 8, textAlign: 'center' }}>
              Watch the chaos unfold.
            </Text>

            <ImmuneWaitingBoard pairs={pairs} choices={choices} displayNames={displayNames} />
          </View>
        </View>
      </View>
    );
  }

  // ── PLAYING — paired ─────────────────────────────────────────────────────
  const helpState: ButtonState = myChoice === 'HELP' ? 'picked' : myChoice ? 'dimmed' : 'idle';
  const betrayState: ButtonState = myChoice === 'BETRAY' ? 'picked' : myChoice ? 'dimmed' : 'idle';

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 32 + insets.top,
          paddingBottom: 24 + insets.bottom,
        }}
      >
        <Text style={{ ...TITLE, color: colors.amber, fontSize: 15, textAlign: 'center' }}>
          Prisoner&apos;s Dilemma
        </Text>

        <View style={{ alignItems: 'center', marginTop: 14 }}>
          <CountdownRing
            deadlineAt={turnDeadlineAt}
            clockOffset={clockOffset}
            totalMs={turnMs}
            active={playing}
            size={72}
            strokeWidth={6}
          />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.chalk, fontSize: 15, fontWeight: '700', opacity: 0.7 }}>VS</Text>
          <View style={{ marginTop: 10 }}>
            <OpponentBadge name={opponentName} avatar={opponentAvatar} />
          </View>

          <View style={{ flexDirection: 'row', gap: 14, marginTop: 32, alignSelf: 'stretch' }}>
            <ChoiceButton choice="HELP" state={helpState} disabled={!playing || !!myChoice} onPress={handleChoice} />
            <ChoiceButton choice="BETRAY" state={betrayState} disabled={!playing || !!myChoice} onPress={handleChoice} />
          </View>
        </View>
      </View>
    </View>
  );
};
