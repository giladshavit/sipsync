import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View, Image, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  withRepeat,
  interpolateColor,
  Easing,
  LinearTransition,
  FadeInRight,
  FadeOutDown,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { Check, Skull, SkipForward, Wine } from 'lucide-react-native';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';

const SLOTS = 6;
const FLIP_MS = 550;
// How long the "X skipped" toast stays fully up, and how long its own
// pop-out takes — the queue's slide animation is held back until both have
// finished (see displayTurnIndex below), so the two never animate at once.
const SKIP_TOAST_MS = 900;
const SKIP_TOAST_EXIT_MS = 180;
// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the turn advances.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// Grid gap between cards (matches the gap-4 class on the grid container)
const CARD_GAP = 16;

// Warm table felt; tints toward green when it's your pick
const BG_WAIT = '#221E1A';
const BG_TURN = '#20291E';

// Small tracked-caps stat/label text — see constants/design.ts's typography
// note for why this isn't Courier New anymore.
const MONO = typography.label;

interface RevealInfo {
  player_id: string;
  points: number;
}

// ── Flip card ───────────────────────────────────────────────────────────────

interface CardProps {
  index: number;
  isRevealed: boolean;
  isPoison: boolean;
  reveal: RevealInfo | null;
  revealerName: string | null;
  interactive: boolean;
  cardWidth: number;
  cardHeight: number;
  /** Server auto-picked this card on a turn timeout — act out the tap. */
  simulatePress: boolean;
  onPick: (index: number) => void;
}

const FlipCard: React.FC<CardProps> = ({
  index,
  isRevealed,
  isPoison,
  reveal,
  revealerName,
  interactive,
  cardWidth,
  cardHeight,
  simulatePress,
  onPick,
}) => {
  // Reconnecting clients mount mid-game — already-open cards start flipped
  const rotation = useSharedValue(isRevealed ? 180 : 0);
  // Pickable = your turn: the card's frame turns green, same as the skip
  // button — one color meaning "you may press this"
  const pickable = useSharedValue(0);
  // Ghost press for server auto-reveals: the card dips like a real tap
  // before flipping, so timeouts read as "someone pressed it"
  const autoPress = useSharedValue(1);

  useEffect(() => {
    if (!isRevealed) return;
    if (simulatePress) {
      autoPress.value = withSequence(
        withTiming(0.9, { duration: 110, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
      );
      rotation.value = withDelay(
        150,
        withTiming(180, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) }),
      );
    } else {
      rotation.value = withTiming(180, {
        duration: FLIP_MS,
        easing: Easing.inOut(Easing.cubic),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevealed]);

  const canPick = interactive && !isRevealed;
  useEffect(() => {
    pickable.value = withTiming(canPick ? 1 : 0, { duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPick]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${rotation.value}deg` }],
    borderColor: interpolateColor(pickable.value, [0, 1], [colors.rim, colors.go]),
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${rotation.value - 180}deg` }],
  }));
  const autoPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: autoPress.value }],
  }));

  const face = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backfaceVisibility: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 12,
    borderWidth: 2,
  };

  return (
    <Pressable
      onPress={() => canPick && onPick(index)}
      disabled={!canPick}
    >
      {({ pressed }) => (
        <View style={{
          width: cardWidth,
          height: cardHeight,
          transform: pressed && canPick ? [{ scale: 0.96 }] : [],
        }}>
        <Animated.View style={[{ flex: 1 }, autoPressStyle]}>
          {/* Front — closed card back */}
          <Animated.View
            style={[
              face,
              { width: cardWidth, height: cardHeight },
              { backgroundColor: colors.surface },
              frontStyle,
            ]}
          >
            <Wine size={32} color={colors.fog} strokeWidth={2} />
          </Animated.View>

          {/* Back — safe or poison */}
          <Animated.View
            style={[
              face,
              { width: cardWidth, height: cardHeight },
              isPoison
                ? { backgroundColor: colors.stop, borderColor: colors.chalk }
                : { backgroundColor: colors.surface, borderColor: colors.go },
              backStyle,
            ]}
          >
            {isPoison ? (
              <>
                <Skull size={40} color={colors.chalk} strokeWidth={2} />
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 8 }}>
                  <Wine size={14} color={colors.chalk} strokeWidth={2} />
                  <Wine size={14} color={colors.chalk} strokeWidth={2} />
                  <Wine size={14} color={colors.chalk} strokeWidth={2} />
                </View>
                <Text
                  style={{
                    ...MONO,
                    color: colors.chalk,
                    fontSize: 11,
                    fontWeight: '800',
                    marginTop: 6,
                  }}
                >
                  Poison
                </Text>
              </>
            ) : (
              <>
                <Check size={24} color={colors.go} strokeWidth={2.5} />
                {reveal && (
                  <Text
                    style={{
                      color: colors.amberGlow,
                      fontSize: 28,
                      fontWeight: '900',
                      marginTop: 2,
                    }}
                  >
                    +{reveal.points}
                  </Text>
                )}
                {revealerName && (
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.chalk,
                      fontSize: 13,
                      fontWeight: '800',
                      letterSpacing: 0.5,
                      marginTop: 5,
                      maxWidth: '92%',
                      textAlign: 'center',
                    }}
                  >
                    {revealerName}
                  </Text>
                )}
              </>
            )}
          </Animated.View>
        </Animated.View>
        </View>
      )}
    </Pressable>
  );
};

// ── Turn queue ──────────────────────────────────────────────────────────────
// Role 0 = current turn (big, named, pulses when it's you), role 1 = on deck
// (medium, named), role 2 = on-deck-after-that (small, avatar only). Keyed by
// player_id so React keeps each slot's component identity as the queue
// window slides forward a turn: the pid that falls out of the window exits
// (dropped/faded down), the two that remain reposition via `layout` (their
// measured box literally moves + resizes from the old role's slot to the
// new one), and whichever pid newly enters at role 2 slides in from the
// right — three requirements, one Reanimated layout-animation mechanism.
const QUEUE_SIZES = [64, 42, 30];

interface QueueSlotProps {
  role: 0 | 1 | 2;
  isMe: boolean;
  avatar: string | null | undefined;
  name: string;
}

const TurnQueueSlot: React.FC<QueueSlotProps> = ({ role, isMe, avatar, name }) => {
  const size = QUEUE_SIZES[role];
  const avatarSource = avatar ? AVATAR_IMAGES[avatar] : undefined;
  const ringColor = avatar ? AVATAR_COLORS[avatar] : avatarFallbackColor(name);
  const initial = (name.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();
  const isMyTurnSlot = role === 0 && isMe;

  // Special gesture for "it's your turn": the current-turn avatar breathes
  // gently while it's yours, otherwise it sits still.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isMyTurnSlot) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurnSlot]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(16).stiffness(140)}
      entering={FadeInRight.duration(320)}
      exiting={FadeOutDown.duration(260)}
      style={{ alignItems: 'center' }}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: 'hidden',
            borderWidth: isMyTurnSlot ? 3 : 2,
            borderColor: isMyTurnSlot ? colors.go : role === 0 ? colors.amberGlow : ringColor,
            backgroundColor: avatarSource ? colors.parchment : ringColor,
            alignItems: 'center',
            justifyContent: 'center',
          },
          pulseStyle,
        ]}
      >
        {avatarSource ? (
          <Image source={avatarSource} style={{ width: size, height: size }} resizeMode="cover" />
        ) : (
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.4 }}>
            {initial}
          </Text>
        )}
      </Animated.View>

      {role < 2 && (
        <Text
          numberOfLines={1}
          style={{
            marginTop: 4,
            maxWidth: size + 28,
            textAlign: 'center',
            color: role === 0 ? colors.chalk : colors.fog,
            fontSize: role === 0 ? 14 : 10,
            fontWeight: role === 0 ? '800' : '600',
          }}
        >
          {isMe ? 'You' : name}
        </Text>
      )}

      {isMyTurnSlot && (
        <View
          style={{
            marginTop: 3,
            paddingHorizontal: 8,
            paddingVertical: 2,
            backgroundColor: colors.go,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>
            YOUR TURN
          </Text>
        </View>
      )}
    </Animated.View>
  );
};

// ── Screen ──────────────────────────────────────────────────────────────────

export const RouletteGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const { playerId } = usePlayerIdentity();

  // Card dimensions scale with the screen: 3 columns inside the container
  // (maxWidth 420, 20px padding each side, two 16px gaps), 1:1.5 card ratio
  const { width } = useWindowDimensions();
  const containerWidth = Math.min(width, 420) - 40; // 40 is total horizontal padding
  const dynamicCardW = Math.floor((containerWidth - 32) / 3); // 32 is two 16px gaps
  const dynamicCardH = Math.floor(dynamicCardW * 1.5);

  const status = (gameState.status as string) ?? 'PLAYING';
  const revealed = (gameState.revealed as boolean[]) ?? [];
  const currentPlayerId = (gameState.current_player_id as string) ?? null;
  const poisonIndex = (gameState.poison_index as number | null) ?? null;
  const turnMs = (gameState.turn_ms as number) ?? 10_000;
  const turnDeadlineAt = (gameState.turn_deadline_at as number) ?? 0;
  const skipsUsed = (gameState.skips_used as string[]) ?? [];
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const avatars = (gameState.avatars as Record<string, string | null>) ?? {};
  const turnOrder = (gameState.turn_order as string[]) ?? [];
  const turnIndex = (gameState.turn_index as number) ?? 0;
  const revealedBy = (gameState.revealed_by as Record<string, RevealInfo>) ?? {};
  const lastEvent = gameState.last_event as
    | { type: string; player_id: string; slot_index?: number; reason?: string }
    | null
    | undefined;
  const pendingDeltas = (gameState.pending_deltas as Record<string, number>) ?? {};

  const playing = status === 'PLAYING';
  const isMyTurn = playing && !!playerId && playerId === currentPlayerId;
  const myPoints = playerId ? (pendingDeltas[playerId] ?? 0) : 0;
  // Which slot the server auto-revealed on a turn timeout, for the ghost tap
  const autoRevealSlot =
    lastEvent?.reason === 'timeout' && typeof lastEvent.slot_index === 'number'
      ? lastEvent.slot_index
      : null;
  // Queue's own turn cursor, decoupled from the server's `turnIndex`. On a
  // normal reveal it follows immediately (the flip animation is already the
  // "something happened" beat). On a skip, the queue holds on the skipper —
  // still shown as current, right where the toast above names them — until
  // the toast has fully appeared and popped back out, and only then slides
  // to the next player. Two effects touching the same turn, one at a time,
  // instead of both firing off the same state update.
  const [displayTurnIndex, setDisplayTurnIndex] = useState(turnIndex);
  useEffect(() => {
    if (turnIndex === displayTurnIndex) return;
    if (lastEvent?.type === 'SKIP') {
      const timer = setTimeout(
        () => setDisplayTurnIndex(turnIndex),
        SKIP_TOAST_MS + SKIP_TOAST_EXIT_MS,
      );
      return () => clearTimeout(timer);
    }
    setDisplayTurnIndex(turnIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnIndex, lastEvent?.type]);

  // Up-next queue: current turn + the next two, read straight off the
  // server's round-robin order/index (no client-side ordering guesses).
  // Capped to the number of distinct players so a 2-player game shows
  // "current, next" instead of wrapping the same player back in as their
  // own next-next.
  //
  // Rendered off `displayTurnIndex`, not the raw `turnIndex`, so a skip's
  // toast and the queue's slide animation don't fire in the same instant
  // (see the effect above) — everything else (felt tint, timer, card
  // interactivity) still reacts to the real server state immediately.
  const queuePids = turnOrder.length
    ? Array.from({ length: Math.min(3, turnOrder.length) }, (_, i) => turnOrder[(displayTurnIndex + i) % turnOrder.length])
    : [];

  const closedCount = revealed.filter((r) => !r).length;
  const skipDisabled =
    !isMyTurn || closedCount <= 1 || (!!playerId && skipsUsed.includes(playerId));
  const poisonHit = status === 'DONE' && poisonIndex !== null;
  // Once the poison lands, fold its penalty into the on-screen points so the
  // loser sees the −15 immediately (matches the backend's _POISON_POINTS)
  const displayPoints =
    poisonHit && lastEvent?.player_id === playerId ? myPoints - 15 : myPoints;

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // The felt tints toward green when it's your pick
  const turnGlow = useSharedValue(0);
  useEffect(() => {
    turnGlow.value = withTiming(isMyTurn ? 1 : 0, {
      duration: 450,
      easing: Easing.inOut(Easing.quad),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn]);
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(turnGlow.value, [0, 1], [BG_WAIT, BG_TURN]),
  }));

  // Turn countdown bar, corrected from server time to this device's clock
  const timerProgress = useSharedValue(1);
  useEffect(() => {
    if (!playing || !turnDeadlineAt) return;
    const remaining = Math.max(0, turnDeadlineAt - clockOffset - Date.now());
    timerProgress.value = Math.min(1, remaining / turnMs);
    timerProgress.value = withTiming(0, {
      duration: remaining,
      easing: Easing.linear,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnDeadlineAt, playing, clockOffset, turnMs]);

  // Deadline watchdog — every client nudges the server if the active player
  // stalls; the server validates against its own clock and force-reveals
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

  // Poison hit → the loss sequence: card flips (FLIP_MS), screen shakes,
  // red flash, then the loss banner slams in. game.tsx holds navigation
  // (END_HOLD_MS) so the whole thing plays before the summary screen.
  const shake = useSharedValue(0);
  const flash = useSharedValue(0);
  const bannerScale = useSharedValue(0);
  const bannerOpacity = useSharedValue(0);
  useEffect(() => {
    if (!poisonHit) return;
    const hit = (amp: number) =>
      withTiming(amp, { duration: 55, easing: Easing.linear });
    shake.value = withDelay(
      FLIP_MS - 150,
      withSequence(hit(-14), hit(14), hit(-11), hit(11), hit(-6), hit(6), hit(0)),
    );
    flash.value = withDelay(
      FLIP_MS - 150,
      withSequence(
        withTiming(0.75, { duration: 90 }),
        withTiming(0, { duration: 260 }),
        withTiming(0.4, { duration: 90 }),
        withTiming(0, { duration: 320 }),
      ),
    );
    bannerOpacity.value = withDelay(FLIP_MS + 350, withTiming(1, { duration: 180 }));
    bannerScale.value = withDelay(
      FLIP_MS + 350,
      withSequence(
        withTiming(1.08, { duration: 200, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 120 }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poisonHit]);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const bannerStyle = useAnimatedStyle(() => ({
    opacity: bannerOpacity.value,
    transform: [{ scale: bannerScale.value }],
  }));

  const timerBarStyle = useAnimatedStyle(() => ({
    width: `${timerProgress.value * 100}%` as `${number}%`,
  }));

  const loserName =
    lastEvent?.type === 'POISON'
      ? (displayNames[lastEvent.player_id] ?? '?')
      : null;

  // Skip toast — pops up over the queue for a beat, then clears itself. Keyed
  // off turnIndex (bumped by every action, skip included) rather than
  // lastEvent staying "SKIP" in state, so the toast doesn't linger once the
  // next turn is already underway.
  const [skipToast, setSkipToast] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    if (lastEvent?.type !== 'SKIP') return;
    setSkipToast({ id: turnIndex, name: displayNames[lastEvent.player_id] ?? '?' });
    const timer = setTimeout(
      () => setSkipToast((cur) => (cur?.id === turnIndex ? null : cur)),
      SKIP_TOAST_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnIndex, lastEvent?.type, lastEvent?.player_id]);

  function handlePick(index: number) {
    onAction('REVEAL', { slot_index: index });
  }

  return (
    <Animated.View style={[{ flex: 1 }, bgStyle, shakeStyle]}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 56,
          paddingBottom: 28,
        }}
      >
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

        {/* Turn queue — current turn (avatar + name, pulses when it's you)
            plus the next two on deck, smaller. */}
        <View style={{ minHeight: 96, marginTop: 34, justifyContent: 'center' }}>
          {playing && queuePids.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 16 }}>
              {queuePids.map((pid, i) => (
                <TurnQueueSlot
                  key={pid}
                  role={i as 0 | 1 | 2}
                  isMe={pid === playerId}
                  avatar={avatars[pid]}
                  name={displayNames[pid] ?? '?'}
                />
              ))}
            </View>
          )}
        </View>

        {/* Skip toast — pops up below the queue, gone before the next turn.
            Its own reserved-height row (not absolutely laid over the queue)
            so it never covers an avatar/name. */}
        <View style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
          {skipToast && (
            <Animated.View
              key={skipToast.id}
              entering={ZoomIn.duration(180)}
              exiting={ZoomOut.duration(SKIP_TOAST_EXIT_MS)}
              pointerEvents="none"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: '#EAB308',
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderRadius: 999,
                borderWidth: 2,
                borderColor: '#CA8A04',
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 8,
              }}
            >
              <SkipForward size={14} color="#1A1A1A" strokeWidth={3} />
              <Text style={{ color: '#1A1A1A', fontWeight: '900', fontSize: 12, letterSpacing: 1 }}>
                {skipToast.name.toUpperCase()} SKIPPED
              </Text>
            </Animated.View>
          )}
        </View>

        {/* Board — grid and skip button live together in the centered space,
            so the button reads as part of the game board */}
        <View className="flex-1 w-full items-center justify-center">
          {/* Your banked points this round — the stake SKIP plays against */}
          <Text
            style={{
              ...MONO,
              color: colors.chalk,
              fontSize: 16,
              fontWeight: '800',
              marginBottom: 26,
            }}
          >
            Points: {displayPoints >= 0 ? displayPoints : `−${Math.abs(displayPoints)}`}
          </Text>
          <View
            className="flex-row flex-wrap justify-center gap-4 px-4"
            style={{ width: dynamicCardW * 3 + CARD_GAP * 2 + 32 }}
          >
            {Array.from({ length: SLOTS }, (_, i) => (
              <FlipCard
                key={i}
                index={i}
                isRevealed={revealed[i] ?? false}
                isPoison={poisonIndex === i}
                reveal={revealedBy[String(i)] ?? null}
                revealerName={
                  revealedBy[String(i)]
                    ? (displayNames[revealedBy[String(i)].player_id] ?? null)
                    : null
                }
                interactive={isMyTurn}
                cardWidth={dynamicCardW}
                cardHeight={dynamicCardH}
                simulatePress={autoRevealSlot === i}
                onPick={handlePick}
              />
            ))}
          </View>

          {/* Skip — clearly defined physical button */}
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Pressable
              onPress={() => onAction('SKIP')}
              disabled={skipDisabled}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    paddingVertical: 16,
                    paddingHorizontal: 40,
                    backgroundColor: skipDisabled ? '#2A2A2A' : '#EAB308', // Solid vibrant amber
                    borderRadius: 14,
                    borderWidth: 2,
                    borderColor: skipDisabled ? '#404040' : '#CA8A04',
                    transform: pressed && !skipDisabled ? [{ scale: 0.95 }] : [],
                  }}
                >
                  <SkipForward
                    size={22}
                    color={skipDisabled ? '#888888' : '#1A1A1A'}
                    strokeWidth={3}
                  />
                  <Text
                    style={{
                      color: skipDisabled ? '#888888' : '#1A1A1A',
                      fontSize: 18,
                      fontWeight: '900',
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                    }}
                  >
                    Skip (−5)
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      {/* Poison red flash */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.stop,
          },
          flashStyle,
        ]}
      />

      {/* Loss banner — slams in once the poison flip lands */}
      {poisonHit && loserName && (
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
            <Skull size={56} color={colors.chalk} strokeWidth={2} />
            <Text
              style={{
                color: colors.chalk,
                fontSize: 26,
                fontWeight: '900',
                letterSpacing: 1,
                marginTop: 12,
                textAlign: 'center',
              }}
            >
              {loserName.toUpperCase()}
            </Text>
            <Text
              style={{ ...MONO, color: colors.chalk, fontSize: 12, marginTop: 2, opacity: 0.9 }}
            >
              Hit the poison
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Wine size={26} color={colors.chalk} strokeWidth={2} />
              <Wine size={26} color={colors.chalk} strokeWidth={2} />
              <Wine size={26} color={colors.chalk} strokeWidth={2} />
            </View>
            <Text style={{ ...MONO, color: colors.chalk, fontSize: 12, marginTop: 10 }}>
              3 chasers · −15 pts
            </Text>
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
};
