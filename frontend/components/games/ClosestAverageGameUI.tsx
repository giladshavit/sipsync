import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { GlassWater } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';

// Must match the backend's ClosestAverageGame._DECISION_MS
const DECISION_MS = 15_000;
const MAX_NUMBER = 99;
const THUMB_SIZE = 72;
// Track is a bit taller than the thumb for a touch of breathing room —
// centered via THUMB_INSET, not by matching heights exactly.
const TRACK_HEIGHT = 76;
const THUMB_INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;

type Result = 'WIN' | 'LOSE' | 'SAFE';

interface RoundResult {
  average: number;
  myNumber: number;
  distance: number;
  result: Result;
  chasers: number;
  /** Competition ranking (ties share a place, e.g. 1, 1, 3) — same scheme
   * backend/app/games/scoring.py uses for scoring. */
  rank: number;
  total: number;
}

// Mirrors backend/app/games/closest_average.py's _compute_outcomes ranking —
// the round's own state is broadcast verbatim (same trust model as
// roulette/coin_flip), so the client re-derives the same closest/farthest
// split rather than waiting on a separate outcomes message.
function computeRoundResult(
  numbers: Record<string, number>,
  playerIds: string[],
  playerId: string,
): RoundResult | null {
  if (playerIds.length === 0 || !(playerId in numbers)) return null;

  const average =
    playerIds.reduce((sum, pid) => sum + (numbers[pid] ?? 0), 0) / playerIds.length;
  const distances = playerIds.map((pid) => Math.abs((numbers[pid] ?? 0) - average));
  const closest = Math.min(...distances);
  const farthest = Math.max(...distances);

  const myNumber = numbers[playerId] ?? 0;
  const myDistance = Math.abs(myNumber - average);
  const rank = 1 + distances.filter((d) => d < myDistance).length;

  let result: Result = 'SAFE';
  let chasers = 0;
  if (closest !== farthest) {
    if (myDistance === closest) {
      result = 'WIN';
    } else if (myDistance === farthest) {
      result = 'LOSE';
      chasers = 1;
    }
  }

  return { average, myNumber, distance: myDistance, result, chasers, rank, total: playerIds.length };
}

function RevealKicker({ children, tint }: { children: React.ReactNode; tint: string }): React.ReactElement {
  return (
    <Text
      style={{
        color: tint,
        ...typography.label,
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 2,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}

function StatChip({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <View
      style={{
        marginTop: 28,
        paddingVertical: 11,
        paddingHorizontal: 22,
        borderRadius: 22,
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: colors.rim,
      }}
    >
      <Text style={{ color: colors.chalk, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 }}>
        {children}
      </Text>
    </View>
  );
}

export const ClosestAverageGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const { playerId } = usePlayerIdentity();

  const status = (gameState.status as string) ?? 'PLAYING';
  const deadlineAt = (gameState.deadline_at as number) ?? 0;
  const numbers = (gameState.numbers as Record<string, number>) ?? {};
  const clockOffsets = (gameState.clock_offsets as Record<string, number>) ?? {};
  const playerIds = Object.keys(clockOffsets);

  const playing = status === 'PLAYING';
  const done = status === 'DONE';
  const myNumber = playerId && playerId in numbers ? numbers[playerId] : null;
  const submittedCount = Object.keys(numbers).length;

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // ── Slider — position lives on the UI thread; only the rounded integer
  // crosses to JS for the text readout ───────────────────────────────────
  const [displayValue, setDisplayValue] = useState(Math.round(MAX_NUMBER / 2));
  const value = useSharedValue(MAX_NUMBER / 2);
  const trackWidth = useSharedValue(0);

  const pan = Gesture.Pan().onChange((e) => {
    const w = trackWidth.value;
    if (w <= 0) return;
    const clamped = Math.min(MAX_NUMBER, Math.max(0, (e.x / w) * MAX_NUMBER));
    value.value = clamped;
    runOnJS(setDisplayValue)(Math.round(clamped));
  });

  const thumbStyle = useAnimatedStyle(() => {
    const w = trackWidth.value;
    const t = w > 0 ? value.value / MAX_NUMBER : 0;
    return { transform: [{ translateX: t * Math.max(0, w - THUMB_SIZE) }] };
  });
  const fillStyle = useAnimatedStyle(() => {
    const w = trackWidth.value;
    const t = w > 0 ? value.value / MAX_NUMBER : 0;
    return { width: Math.max(THUMB_SIZE, t * w) };
  });

  const insets = useSafeAreaInsets();

  // ── Decision countdown bar, corrected from server time to this device ──
  const timerProgress = useSharedValue(1);
  useEffect(() => {
    if (!playing || !deadlineAt) return;
    const remaining = Math.max(0, deadlineAt - clockOffset - Date.now());
    timerProgress.value = Math.min(1, remaining / DECISION_MS);
    timerProgress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, playing, clockOffset]);
  const timerBarStyle = useAnimatedStyle(() => ({
    width: `${timerProgress.value * 100}%` as `${number}%`,
  }));

  function handleLockIn() {
    if (myNumber === null) {
      onActionRef.current('SUBMIT_NUMBER', { number: Math.round(value.value) });
    }
  }

  // Didn't tap LOCK IN in time? Submit whatever the slider is sitting on —
  // simpler than a surprise random number, and still gives everyone a real
  // pick instead of stalling the round.
  useEffect(() => {
    if (!playing || !deadlineAt || myNumber !== null) return;
    const wait = Math.max(0, deadlineAt - clockOffset - Date.now());
    const timer = setTimeout(() => {
      onActionRef.current('SUBMIT_NUMBER', { number: Math.round(value.value) });
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, playing, clockOffset, myNumber]);

  const roundResult =
    done && playerId ? computeRoundResult(numbers, playerIds, playerId) : null;

  // ── Reveal overlay pop-in — the scrim + average fade in quickly, then the
  // average counts up from 0 (fast start, slow finish) before the verdict
  // card pops in right underneath it, for a beat of suspense ─────────────
  const COUNT_UP_MS = 3500;

  const revealOpacity = useSharedValue(0);
  useEffect(() => {
    if (!done) return;
    revealOpacity.value = withDelay(150, withTiming(1, { duration: 200 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: revealOpacity.value,
  }));

  const countValue = useSharedValue(0);
  const [displayAverage, setDisplayAverage] = useState(0);
  useAnimatedReaction(
    () => countValue.value,
    (current, previous) => {
      if (current !== previous) runOnJS(setDisplayAverage)(current);
    },
  );
  useEffect(() => {
    if (!done || !roundResult) return;
    countValue.value = 0;
    countValue.value = withDelay(
      150,
      withTiming(roundResult.average, { duration: COUNT_UP_MS, easing: Easing.out(Easing.cubic) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, roundResult?.average]);

  const cardOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.8);
  useEffect(() => {
    if (!done) return;
    const delay = 150 + COUNT_UP_MS;
    cardOpacity.value = withDelay(delay, withTiming(1, { duration: 200 }));
    cardScale.value = withDelay(
      delay,
      withSequence(
        withTiming(1.05, { duration: 200, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 120 }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  const TONE_BG: Record<Result, string> = { WIN: colors.go, LOSE: colors.stop, SAFE: colors.safe };
  // Same verdict vocabulary as summary.tsx's verdictWord — "DRINK" reads
  // clearer than "LOSE" in a drinking game, and staying consistent means
  // this popup can't say something different from the summary screen
  // seconds later.
  const VERDICT_WORD: Record<Result, string> = { WIN: 'WIN', LOSE: 'DRINK', SAFE: 'SAFE' };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 44 + insets.top,
          paddingBottom: 24 + insets.bottom,
        }}
      >
        <Text
          style={{ color: colors.chalk, fontSize: 22, fontWeight: '900', letterSpacing: 1, textAlign: 'center' }}
        >
          PICK YOUR NUMBER
        </Text>

        <View
          style={{ height: 6, marginTop: 10, borderWidth: 1, borderColor: colors.rim, padding: 1, opacity: playing ? 1 : 0 }}
        >
          <Animated.View style={[{ height: '100%', backgroundColor: colors.amber }, timerBarStyle]} />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {myNumber === null ? (
            <>
              <Text style={{ color: colors.chalk, fontSize: 96, lineHeight: 100, fontWeight: '900' }}>
                {displayValue}
              </Text>

              <View
                onLayout={(e) => {
                  trackWidth.value = e.nativeEvent.layout.width;
                }}
                style={{ width: '100%', marginTop: 32 }}
              >
                <GestureDetector gesture={pan}>
                  <View
                    style={{
                      height: TRACK_HEIGHT,
                      borderRadius: TRACK_HEIGHT / 2,
                      backgroundColor: colors.surface,
                      overflow: 'hidden',
                    }}
                  >
                    <Animated.View
                      style={[
                        {
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          backgroundColor: 'rgba(245,158,11,0.28)',
                        },
                        fillStyle,
                      ]}
                    />
                    <Animated.View
                      style={[
                        {
                          position: 'absolute',
                          top: THUMB_INSET,
                          width: THUMB_SIZE,
                          height: THUMB_SIZE,
                          borderRadius: THUMB_SIZE / 2,
                          backgroundColor: colors.amber,
                          borderWidth: 3,
                          borderColor: colors.amberGlow,
                        },
                        thumbStyle,
                      ]}
                    />
                    {/* Decorative rim only — drawn as a non-clipping overlay so
                    it can't shrink this view's own content box (a border on
                    the clipping container itself was eating a few px off the
                    bottom, clipping the thumb that's sized to match exactly). */}
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        borderRadius: TRACK_HEIGHT / 2,
                        borderWidth: 1.5,
                        borderColor: colors.rim,
                      }}
                    />
                  </View>
                </GestureDetector>
              </View>

              <Pressable onPress={handleLockIn}>
                {({ pressed }) => (
                  <View
                    style={{
                      marginTop: 28,
                      paddingVertical: 14,
                      paddingHorizontal: 36,
                      borderRadius: 26,
                      backgroundColor: colors.amber,
                      transform: pressed ? [{ scale: 0.96 }] : [],
                    }}
                  >
                    <Text style={{ color: '#241A05', fontSize: 16, fontWeight: '900', letterSpacing: 1 }}>
                      LOCK IN
                    </Text>
                  </View>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ color: colors.chalk, fontSize: 96, lineHeight: 100, fontWeight: '900' }}>
                {myNumber}
              </Text>
              <StatChip>
                {`LOCKED IN · ${submittedCount}/${playerIds.length} SUBMITTED`}
              </StatChip>
            </>
          )}
        </View>
      </View>

      {done && roundResult && (
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
          <RevealKicker tint={colors.fog}>Room average</RevealKicker>
          <Text style={{ color: colors.amberGlow, fontSize: 56, fontWeight: '900', marginTop: 4 }}>
            {displayAverage.toFixed(1)}
          </Text>

          <Animated.View
            style={[
              {
                alignItems: 'center',
                marginTop: 22,
                paddingVertical: 20,
                paddingHorizontal: 12,
                borderRadius: 20,
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.3)',
                backgroundColor: TONE_BG[roundResult.result],
                width: 300,
              },
              cardStyle,
            ]}
          >
            <Text style={{ color: colors.chalk, fontSize: 22, fontWeight: '900', letterSpacing: 2 }}>
              {VERDICT_WORD[roundResult.result]}
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, width: '100%' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <RevealKicker tint="rgba(240,240,232,0.75)">Your distance</RevealKicker>
              <Text style={{ color: colors.chalk, fontSize: 42, fontWeight: '900', marginTop: 2 }}>
                {roundResult.distance.toFixed(1)}
              </Text>
            </View>

            <View style={{ width: 1, height: 52, backgroundColor: 'rgba(255,255,255,0.25)' }} />

            <View style={{ flex: 1, alignItems: 'center' }}>
              <RevealKicker tint="rgba(240,240,232,0.75)">Your rank</RevealKicker>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 2 }}>
                <Text style={{ color: colors.chalk, fontSize: 42, fontWeight: '900' }}>
                  #{roundResult.rank}
                </Text>
                <Text style={{ color: 'rgba(240,240,232,0.75)', fontSize: 16, fontWeight: '700', marginLeft: 2 }}>
                  /{roundResult.total}
                </Text>
              </View>
            </View>
            </View>

            {roundResult.chasers > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
                <GlassWater size={20} color={colors.stop} strokeWidth={2.5} />
                <Text style={{ color: colors.chalk, fontSize: 16, fontWeight: '800' }}>
                  {roundResult.chasers} chaser
                </Text>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
};
