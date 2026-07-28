import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View, ScrollView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  interpolateColor,
  Easing,
  FadeIn,
  FadeInUp,
} from 'react-native-reanimated';
import { GlassWater, Trophy } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';

type Choice = 'A' | 'B';
type Mode = 'FLOW' | 'AGAINST';

// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the round resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// Reveal choreography: a beat of quiet, then the two bars race to their
// final height, then they lock in a color, then names cascade up under the
// winner. DIGEST_MS is the deliberate pause once a result is actually
// visible — long enough to read it and feel the tension before the next
// beat, instead of snapping straight to the next thing.
const RACE_DELAY_MS = 300;
const RACE_DURATION_MS = 900;
const COLOR_DELAY_MS = RACE_DELAY_MS + RACE_DURATION_MS;
const COLOR_DURATION_MS = 300;
const NAMES_DELAY_MS = COLOR_DELAY_MS + 150;
const DIGEST_MS = 2_000;
const VERDICT_DELAY_MS = COLOR_DELAY_MS + COLOR_DURATION_MS + DIGEST_MS;
const MAX_BAR_HEIGHT = 176;
const MIN_BAR_HEIGHT = 10;
const BAR_WIDTH = 64;

// Tie choreography: the columns race in exactly like a normal reveal (equal
// heights, since it's a tie), then a beat to read "dead even", then the coin
// mounts and does its own (slower, more deliberate) flip, then a full digest
// pause once it lands before the personal verdict shows.
const TIE_LABEL_DELAY_MS = COLOR_DELAY_MS + 300;
const COIN_STAGE_DELAY_MS = TIE_LABEL_DELAY_MS + 1_200;
const COIN_FLIP_MS = 5_000;
const COIN_OUTCOME_DELAY_MS = COIN_FLIP_MS + DIGEST_MS;
const COIN_SIZE = 120;
const TIE_LOSER_CHASERS = 1; // mirrors backend _LOSER_CHASERS

const VOTE_TIMER_HEIGHT = 6;

// Small tracked-caps stat/label text — see constants/design.ts's typography
// note for why this isn't Courier New anymore.
const MONO = typography.label;

// Each answer's own color identity — deliberately not green/red, since those
// are reserved for the personal win/lose verdict elsewhere on this screen.
// Fixed by slot (A/B), reused for the vote buttons, the tie columns, and the
// coin's two faces so the same answer always reads as the same color.
const OPTION_COLORS: [string, string] = [colors.tapped, '#7C3AED'];

// Mirrors backend/app/games/majority.py: scoring is flat and mode-agnostic —
// only *which* group counts as the winner depends on FLOW vs AGAINST, so the
// UI only ever needs to know whether the viewer landed on the winning side.
function payoff(won: boolean): { scoreDelta: number; chasers: number } {
  return won ? { scoreDelta: 5, chasers: 0 } : { scoreDelta: -5, chasers: 1 };
}

// ── Vote button ──────────────────────────────────────────────────────────────

type ButtonState = 'idle' | 'picked' | 'dimmed';

function OptionButton({
  label,
  color,
  state,
  disabled,
  onPress,
}: {
  label: string;
  color: string;
  state: ButtonState;
  disabled: boolean;
  onPress: () => void;
}): React.ReactElement {
  const picked = state === 'picked';
  const dimmed = state === 'dimmed';

  const pop = useSharedValue(1);
  useEffect(() => {
    if (picked) {
      pop.value = withSequence(
        withTiming(1.05, { duration: 140, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 180 }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ flex: 1 }}>
      {({ pressed }) => (
        <Animated.View
          style={[
            popStyle,
            {
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 16,
              paddingVertical: 20,
              backgroundColor: color,
              borderWidth: picked ? 4 : 2,
              borderColor: colors.ink,
              opacity: dimmed ? 0.4 : pressed && !disabled ? 0.85 : 1,
            },
          ]}
        >
          <Text
            numberOfLines={2}
            style={{
              color: '#FFFFFF',
              fontSize: 18,
              fontWeight: '900',
              textAlign: 'center',
              letterSpacing: -0.3,
            }}
          >
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

// ── Coin faces — one per answer, colored and labeled with that answer ──────

function OptionCoinFace({ label, color, size }: { label: string; color: string; size: number }): React.ReactElement {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: size * 0.045,
        borderColor: colors.ink,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: size * 0.14,
      }}
    >
      <Text
        numberOfLines={2}
        style={{
          color: '#FFFFFF',
          fontSize: size * 0.13,
          fontWeight: '900',
          textAlign: 'center',
          letterSpacing: -0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ── Flipping coin — same flip mechanics as CoinFlipGameUI's FlippingCoin,
// adapted to land on one of the two answers instead of heads/tails ─────────

function FlippingOptionCoin({
  resultLabel,
  resultColor,
  otherLabel,
  otherColor,
  size,
}: {
  resultLabel: string;
  resultColor: string;
  otherLabel: string;
  otherColor: string;
  size: number;
}): React.ReactElement {
  const HALF_TURNS = 7; // odd count: starts on the other answer, ends on the result
  const spin = useSharedValue(0);
  const hop = useSharedValue(0);

  useEffect(() => {
    spin.value = withTiming(HALF_TURNS, { duration: COIN_FLIP_MS, easing: Easing.out(Easing.cubic) });
    hop.value = withSequence(
      withTiming(-40, { duration: COIN_FLIP_MS * 0.42, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: COIN_FLIP_MS * 0.58, easing: Easing.bounce }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Squash follows a cosine so the coin thins edge-on mid half-turn
  const resultStyle = useAnimatedStyle(() => {
    const phase = spin.value * Math.PI;
    const cos = Math.cos(phase);
    const showing = Math.round(spin.value) % 2 === 1;
    return { transform: [{ translateY: hop.value }, { scaleY: Math.abs(cos) }], opacity: showing ? 1 : 0 };
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

  return (
    <View style={{ height: size + 48, justifyContent: 'flex-end' }}>
      <Animated.View style={backStyle}>
        <OptionCoinFace label={otherLabel} color={otherColor} size={size} />
      </Animated.View>
      <Animated.View style={resultStyle}>
        <OptionCoinFace label={resultLabel} color={resultColor} size={size} />
      </Animated.View>
    </View>
  );
}

// ── Tie reveal — columns race in exactly like a normal reveal (equal
// heights), then a beat, then the coin flip decides which answer drinks ────

function TieReveal({
  optionA,
  optionB,
  countA,
  countB,
  namesA,
  namesB,
  myName,
  coinResult,
  myChoice,
}: {
  optionA: string;
  optionB: string;
  countA: number;
  countB: number;
  namesA: string[];
  namesB: string[];
  myName: string | null;
  coinResult: Choice;
  myChoice: Choice | undefined;
}): React.ReactElement {
  const [showCoinStage, setShowCoinStage] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowCoinStage(true), COIN_STAGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const totalVotes = countA + countB;
  const resultLabel = coinResult === 'A' ? optionA : optionB;
  const resultColor = coinResult === 'A' ? OPTION_COLORS[0] : OPTION_COLORS[1];
  const otherLabel = coinResult === 'A' ? optionB : optionA;
  const otherColor = coinResult === 'A' ? OPTION_COLORS[1] : OPTION_COLORS[0];
  const lost = myChoice !== undefined && myChoice === coinResult;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row' }}>
          <ResultColumn
            label={optionA}
            count={countA}
            totalVotes={totalVotes}
            tint={OPTION_COLORS[0]}
            names={namesA}
            myName={myName}
          />
          <View style={{ width: 2, backgroundColor: colors.sand, marginHorizontal: 12 }} />
          <ResultColumn
            label={optionB}
            count={countB}
            totalVotes={totalVotes}
            tint={OPTION_COLORS[1]}
            names={namesB}
            myName={myName}
          />
        </View>

        <Animated.Text
          entering={FadeIn.delay(TIE_LABEL_DELAY_MS).duration(250)}
          style={{ ...MONO, color: colors.dune, fontSize: 12, textAlign: 'center', marginTop: 24 }}
        >
          Dead even - coin decides
        </Animated.Text>
      </View>

      {showCoinStage && (
        <Animated.View
          entering={FadeIn.duration(300)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(10,10,15,0.92)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 24,
          }}
        >
          <Text
            style={{
              color: colors.chalk,
              fontSize: 26,
              fontWeight: '900',
              textAlign: 'center',
              letterSpacing: 0.2,
              lineHeight: 32,
            }}
          >
            Lands on your pick? You drink.
          </Text>

          <View style={{ marginTop: 28 }}>
            <FlippingOptionCoin
              resultLabel={resultLabel}
              resultColor={resultColor}
              otherLabel={otherLabel}
              otherColor={otherColor}
              size={COIN_SIZE}
            />
          </View>

          <Animated.View
            entering={FadeInUp.delay(COIN_OUTCOME_DELAY_MS).duration(320)}
            style={{
              alignItems: 'center',
              marginTop: 20,
              paddingVertical: 12,
              paddingHorizontal: 24,
              backgroundColor: lost ? colors.stop : colors.go,
              borderWidth: 2,
              borderColor: colors.ink,
            }}
          >
            <Text style={{ color: colors.chalk, fontSize: 17, fontWeight: '900', letterSpacing: 0.4 }}>
              {lost ? 'YOU DRINK' : 'YOU’RE SAFE'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 3 }}>
              <Text style={{ ...MONO, color: colors.chalk, fontSize: 12, fontWeight: '800' }}>0 PTS</Text>
              {lost && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <GlassWater size={13} color={colors.chalk} strokeWidth={2.5} />
                  <Text style={{ ...MONO, color: colors.chalk, fontSize: 12, fontWeight: '800' }}>
                    {TIE_LOSER_CHASERS}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

// ── Result column — a racing bar (neutral -> win/lose color once it lands)
// with the option's voters cascading in underneath ──────────────────────────

function ResultColumn({
  label,
  count,
  totalVotes,
  won,
  tint,
  names,
  myName,
}: {
  label: string;
  count: number;
  totalVotes: number;
  // Normal reveal: green/red by win/lose. Tie reveal: no winner yet, so an
  // explicit tint (the answer's own color identity) is used instead.
  won?: boolean;
  tint?: string;
  names: string[];
  myName: string | null;
}): React.ReactElement {
  const fraction = totalVotes > 0 ? count / totalVotes : 0;
  const targetHeight = Math.max(MIN_BAR_HEIGHT, fraction * MAX_BAR_HEIGHT);
  const resolvedColor = tint ?? (won ? colors.go : colors.stop);

  const barHeight = useSharedValue(MIN_BAR_HEIGHT);
  const colorProgress = useSharedValue(0);
  useEffect(() => {
    barHeight.value = withDelay(
      RACE_DELAY_MS,
      withTiming(targetHeight, { duration: RACE_DURATION_MS, easing: Easing.out(Easing.cubic) }),
    );
    colorProgress.value = withDelay(COLOR_DELAY_MS, withTiming(1, { duration: COLOR_DURATION_MS }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const barStyle = useAnimatedStyle(() => ({
    height: barHeight.value,
    backgroundColor: interpolateColor(colorProgress.value, [0, 1], [colors.dune, resolvedColor]),
  }));

  const Icon = tint ? null : won ? Trophy : GlassWater;

  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 16, fontWeight: '900', textAlign: 'center' }}>
        {label}
      </Text>

      <Animated.View
        entering={FadeIn.delay(COLOR_DELAY_MS).duration(200)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}
      >
        {Icon && <Icon size={13} color={resolvedColor} strokeWidth={2.5} />}
        <Text style={{ ...MONO, color: resolvedColor, fontSize: 12, fontWeight: '800' }}>
          {count} {count === 1 ? 'vote' : 'votes'}
        </Text>
      </Animated.View>

      <View style={{ height: MAX_BAR_HEIGHT, justifyContent: 'flex-end', marginTop: 14 }}>
        <Animated.View style={[{ width: BAR_WIDTH, borderWidth: 2, borderColor: colors.ink }, barStyle]} />
      </View>

      <ScrollView style={{ marginTop: 14, maxHeight: 100, alignSelf: 'stretch' }} showsVerticalScrollIndicator={false}>
        {names.map((name, idx) => {
          const isMe = name === myName;
          return (
            <Animated.Text
              key={`${name}-${idx}`}
              entering={FadeInUp.delay(NAMES_DELAY_MS + idx * 70).duration(240)}
              numberOfLines={1}
              style={{
                color: colors.ink,
                fontSize: 13,
                fontWeight: isMe ? '900' : '600',
                textAlign: 'center',
                paddingVertical: 2,
                opacity: isMe ? 1 : 0.6,
              }}
            >
              {name}
              {isMe ? ' · You' : ''}
            </Animated.Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export const MajorityGameUI: React.FC<MiniGameProps> = ({ gameState, onAction, clockOffset }) => {
  const { playerId } = usePlayerIdentity();
  const insets = useSafeAreaInsets();

  const status = (gameState.status as string) ?? 'PLAYING';
  const mode = (gameState.mode as Mode) ?? 'FLOW';
  const question = (gameState.current_question as string) ?? '';
  const optionA = (gameState.option_a as string) ?? 'Option A';
  const optionB = (gameState.option_b as string) ?? 'Option B';
  const votes = (gameState.votes as Record<string, Choice>) ?? {};
  const turnMs = (gameState.turn_ms as number) ?? 15_000;
  const turnDeadlineAt = (gameState.turn_deadline_at as number) ?? 0;
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const tie = (gameState.tie as boolean) ?? false;
  const coinResult = (gameState.coin_result as Choice | null) ?? null;
  const majorityChoice = (gameState.majority_choice as Choice | null) ?? null;
  const minorityChoice = (gameState.minority_choice as Choice | null) ?? null;
  const tally = (gameState.tally as { A: number; B: number } | null) ?? null;

  const playing = status === 'PLAYING';
  const done = status === 'DONE';
  const myVote: Choice | null = playerId ? (votes[playerId] ?? null) : null;

  // Shown up front as plain instruction, not a technical rule label — every
  // player picks the mode's strategy before voting, so there's no reason to
  // hide it, but it needs to read as a sentence a reader can actually parse
  // (and see: dark ink, not the low-contrast amber-on-cream this replaced).
  const modeLabel = mode === 'FLOW' ? 'Guess with the majority' : 'Guess against the majority';

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Deadline watchdog — every client nudges the server once the window
  // shuts, and the server validates against its own clock.
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

  // Vote timer bar — a plain straight line draining left-to-right, corrected
  // from server time to this device's clock. Without it, the EXPIRE
  // auto-assign at the deadline reads as a random surprise instead of a
  // clock the player could see coming.
  const timerProgress = useSharedValue(1);
  useEffect(() => {
    if (!playing || !turnDeadlineAt) return;
    const remaining = Math.max(0, turnDeadlineAt - clockOffset - Date.now());
    timerProgress.value = Math.min(1, remaining / turnMs);
    timerProgress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
  }, [turnDeadlineAt, playing, clockOffset, turnMs, timerProgress]);
  const timerBarStyle = useAnimatedStyle(() => ({
    width: `${timerProgress.value * 100}%` as `${number}%`,
  }));

  function handleVote(choice: Choice) {
    if (playing && !myVote) onAction('VOTE', { choice });
  }

  // ── REVEAL / DONE ──────────────────────────────────────────────────────────
  if (done) {
    const countA = tally?.A ?? 0;
    const countB = tally?.B ?? 0;
    const totalVotes = countA + countB;

    const namesA = Object.entries(votes)
      .filter(([, choice]) => choice === 'A')
      .map(([pid]) => displayNames[pid] ?? '?');
    const namesB = Object.entries(votes)
      .filter(([, choice]) => choice === 'B')
      .map(([pid]) => displayNames[pid] ?? '?');

    const myName = playerId ? (displayNames[playerId] ?? null) : null;
    const myChoice = playerId ? votes[playerId] : undefined;

    if (tie) {
      return (
        <View
          style={{ flex: 1, backgroundColor: colors.cream, paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <TieReveal
            optionA={optionA}
            optionB={optionB}
            countA={countA}
            countB={countB}
            namesA={namesA}
            namesB={namesB}
            myName={myName}
            coinResult={coinResult ?? 'A'}
            myChoice={myChoice}
          />
        </View>
      );
    }

    const winnerChoice = mode === 'FLOW' ? majorityChoice : minorityChoice;
    const iWon = myChoice !== undefined && myChoice === winnerChoice;
    const mine = payoff(iWon);

    return (
      <View style={{ flex: 1, backgroundColor: colors.cream }}>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingHorizontal: 24,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}
        >
          <Text style={{ color: colors.dune, fontSize: 13, fontWeight: '700', textAlign: 'center' }}>
            {modeLabel}
          </Text>

          <View style={{ flexDirection: 'row', marginTop: 22 }}>
            <ResultColumn
              label={optionA}
              count={countA}
              totalVotes={totalVotes}
              won={winnerChoice === 'A'}
              names={namesA}
              myName={myName}
            />
            <View style={{ width: 2, backgroundColor: colors.sand, marginHorizontal: 12 }} />
            <ResultColumn
              label={optionB}
              count={countB}
              totalVotes={totalVotes}
              won={winnerChoice === 'B'}
              names={namesB}
              myName={myName}
            />
          </View>

          {myChoice !== undefined && (
            <Animated.View
              entering={FadeInUp.delay(VERDICT_DELAY_MS).duration(320)}
              style={{
                alignSelf: 'center',
                marginTop: 32,
                paddingVertical: 12,
                paddingHorizontal: 24,
                alignItems: 'center',
                backgroundColor: iWon ? colors.go : colors.stop,
                borderWidth: 2,
                borderColor: colors.ink,
              }}
            >
              <Text style={{ color: colors.chalk, fontSize: 17, fontWeight: '900', letterSpacing: 0.4 }}>
                {iWon ? 'YOU WIN' : 'YOU DRINK'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 3 }}>
                <Text style={{ ...MONO, color: colors.chalk, fontSize: 12, fontWeight: '800' }}>
                  {mine.scoreDelta >= 0 ? '+' : '−'}
                  {Math.abs(mine.scoreDelta)} PTS
                </Text>
                {mine.chasers > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <GlassWater size={13} color={colors.chalk} strokeWidth={2.5} />
                    <Text style={{ ...MONO, color: colors.chalk, fontSize: 12, fontWeight: '800' }}>
                      {mine.chasers}
                    </Text>
                  </View>
                )}
              </View>
            </Animated.View>
          )}
        </View>
      </View>
    );
  }

  // ── PLAYING ──────────────────────────────────────────────────────────────
  const stateA: ButtonState = myVote === 'A' ? 'picked' : myVote ? 'dimmed' : 'idle';
  const stateB: ButtonState = myVote === 'B' ? 'picked' : myVote ? 'dimmed' : 'idle';

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 24 }}>
        <View
          style={{
            height: VOTE_TIMER_HEIGHT,
            borderWidth: 1,
            borderColor: colors.ink,
            padding: 1,
            opacity: playing ? 1 : 0,
          }}
        >
          <Animated.View style={[{ height: '100%', backgroundColor: colors.amber }, timerBarStyle]} />
        </View>
      </View>

      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingBottom: insets.bottom,
        }}
      >
        <Text style={{ color: colors.dune, fontSize: 13, fontWeight: '700', textAlign: 'center' }}>
          {modeLabel}
        </Text>
        <Text
          numberOfLines={3}
          style={{
            color: colors.ink,
            fontSize: 27,
            fontWeight: '900',
            textAlign: 'center',
            letterSpacing: -0.4,
            marginTop: 10,
          }}
        >
          {question}
        </Text>

        <View style={{ flexDirection: 'row', gap: 14, marginTop: 32 }}>
          <OptionButton
            label={optionA}
            color={OPTION_COLORS[0]}
            state={stateA}
            disabled={!playing || !!myVote}
            onPress={() => handleVote('A')}
          />
          <OptionButton
            label={optionB}
            color={OPTION_COLORS[1]}
            state={stateB}
            disabled={!playing || !!myVote}
            onPress={() => handleVote('B')}
          />
        </View>
      </View>
    </View>
  );
};
