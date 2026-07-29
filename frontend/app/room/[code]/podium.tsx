import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextStyle } from 'react-native';
import { Award, GlassWater } from 'lucide-react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeIn,
  LinearTransition,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  withTiming,
  withDelay,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { typography } from '@/constants/design';
import { AVATAR_COLORS } from '@/constants/avatars';
import { AvatarCircle } from '@/components/games/SharedChaserDistributor';
import type { PlayerOutcome } from '@/hooks/useRoomSocket';

// Same light/cream/amber register as the home screen — this is a results
// moment, not a between-rounds holding screen, so it borrows the app's
// "front door" palette rather than the dark in-round tones.
const BG       = '#FFF8E1';
const CARD     = '#FFFDF7';
const INK      = '#0A0A0F';
const MUTED    = '#A8977A';
const HAIRLINE = '#E4D9BE';
const AMBER    = '#F59E0B';
const SILVER   = '#EDEAE0';
const BRONZE   = '#E8C9A0';
const GO       = '#16A34A';
const STOP     = '#DC2626';
const ME_BG    = '#FCEFD1';

// Time the "before this round" standings stay on screen before settling
// into the final order — long enough to actually read who moved.
const REVEAL_DELAY_MS = 1600;

// Rolls a number stopwatch-style from its previous value to `value`. The tween
// runs on the UI thread; each integer step is bridged back as a React state
// update (≤ ~20 tiny renders per roll) so the Text re-lays-out every step —
// a natively-set TextInput keeps its mount-time width and clips new digits
// (20 → "2", −10 → "−1"). Duration matches the list's reorder spring so the
// digits spin exactly while the rows swap places.
const SCORE_ROLL_MS = 1200;

function AnimatedScore({ value, style }: { value: number; style: TextStyle }) {
  const sv = useSharedValue(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    sv.value = withTiming(value, {
      duration: SCORE_ROLL_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [value]);

  useAnimatedReaction(
    () => Math.round(sv.value),
    (current, previous) => {
      if (current !== previous) runOnJS(setDisplay)(current);
    },
  );

  return <Text style={style}>{display}</Text>;
}

// Tier is a dense rank over distinct scores (1 = best), so tied players share
// a tier — and therefore identical column height and fill. Height and color do
// all the talking; no place digits that could be misread as scores.
const TIER_HEIGHT: Record<number, number> = { 1: 172, 2: 134, 3: 104 };
const TIER_FILL:   Record<number, string> = { 1: AMBER, 2: SILVER, 3: BRONZE };

function PodiumColumn({
  name, avatar, score, tier, isMe, delayMs,
}: { name: string; avatar: string | null | undefined; score: number; tier: number; isMe: boolean; delayMs: number }) {
  const height = useSharedValue(0);
  const avatarScale = useSharedValue(0);
  useEffect(() => {
    height.value = withDelay(
      delayMs,
      withTiming(TIER_HEIGHT[tier], { duration: 520, easing: Easing.out(Easing.cubic) }),
    );
    avatarScale.value = withDelay(
      delayMs,
      withSequence(
        withTiming(1.12, { duration: 260, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 160 }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const barStyle = useAnimatedStyle(() => ({ height: height.value }));
  const avatarStyle = useAnimatedStyle(() => ({ transform: [{ scale: avatarScale.value }] }));

  const avatarSize = tier === 1 ? 60 : 48;
  const ringColor = TIER_FILL[tier];

  return (
    <View style={{ alignItems: 'center', flex: 1, maxWidth: 104 }}>
      <Animated.View
        style={[
          {
            marginBottom: 8,
            shadowColor: ringColor,
            shadowOpacity: tier === 1 ? 0.5 : 0,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 0 },
          },
          avatarStyle,
        ]}
      >
        <AvatarCircle name={name} avatar={avatar} size={avatarSize} ringColor={ringColor} />
      </Animated.View>
      <Text
        numberOfLines={1}
        style={{
          color: INK,
          fontWeight: tier === 1 ? '800' : '600',
          fontSize: tier === 1 ? 15 : 13,
          marginBottom: 2,
          maxWidth: 100,
          textAlign: 'center',
        }}
      >
        {name}{isMe ? ' •' : ''}
      </Text>
      <AnimatedScore
        value={score}
        style={{
          color: INK,
          fontSize: tier === 1 ? 20 : 16,
          fontWeight: '800',
          marginBottom: 8,
          textAlign: 'center',
        }}
      />
      <Animated.View
        style={[
          {
            alignSelf: 'stretch',
            borderWidth: 2,
            borderColor: INK,
            backgroundColor: TIER_FILL[tier],
            alignItems: 'center',
            paddingTop: 10,
            overflow: 'hidden',
          },
          barStyle,
        ]}
      >
        {tier === 1 && <Award size={18} color={INK} />}
      </Animated.View>
    </View>
  );
}

// ── Chasers-owed popup — shown once per round on first arrival ─────────────
// Tracked at module scope (not component state) because it needs to survive
// this screen unmounting between rounds (game -> summary -> podium is a real
// route each round) — component state would reset on that remount and show
// the popup again for a round already seen.
let lastChasersPopupKey: string | null = null;

interface ChaserRow { pid: string; name: string; avatar: string | null; chasers: number }

function ChasersPopup({ rows, onDismiss }: { rows: ChaserRow[]; onDismiss: () => void }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.85);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    scale.value = withSequence(
      withTiming(1.04, { duration: 220, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 130 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          // Opaque enough that whatever happens to be behind it (which row
          // is highlighted as "you" differs per viewer) never shows through
          // and makes the popup look inconsistent from player to player.
          backgroundColor: 'rgba(10,10,15,0.94)',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
        },
        overlayStyle,
      ]}
    >
      <Pressable
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={onDismiss}
      />
      <Animated.View
        style={[
          {
            backgroundColor: CARD,
            borderWidth: 2,
            borderColor: INK,
            width: 300,
            maxWidth: '86%',
            paddingVertical: 24,
            paddingHorizontal: 22,
            // Belt-and-suspenders: whatever the cause of a child rendering
            // wider/taller than this box on a given platform, nothing should
            // ever be able to visually poke out past the card's own fill —
            // that's what exposes the dark scrim behind it as an ugly gap.
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        <Text
          style={{
            ...typography.label,
            fontSize: 11,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 4,
            textAlign: 'center',
          }}
        >
          This round
        </Text>
        <Text
          style={{
            fontWeight: '900',
            color: INK,
            fontSize: 24,
            letterSpacing: -0.5,
            textAlign: 'center',
            marginBottom: 18,
          }}
        >
          Who&apos;s Drinking
        </Text>

        <View style={{ gap: 10 }}>
          {rows.map((row) => (
            <View
              key={row.pid}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 8,
                paddingHorizontal: 12,
                backgroundColor: BG,
                borderWidth: 1,
                borderColor: HAIRLINE,
                gap: 10,
              }}
            >
              <AvatarCircle
                name={row.name}
                avatar={row.avatar}
                size={30}
                ringColor={row.avatar ? AVATAR_COLORS[row.avatar] : STOP}
              />
              <Text numberOfLines={1} style={{ flex: 1, color: INK, fontSize: 15, fontWeight: '700' }}>
                {row.name}
              </Text>
              <GlassWater size={16} color={STOP} strokeWidth={2.5} style={{ marginRight: 6 }} />
              <Text style={{ color: STOP, fontSize: 15, fontWeight: '800' }}>{row.chasers}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={onDismiss}
          style={{ marginTop: 20, backgroundColor: AMBER, paddingVertical: 13, alignItems: 'center' }}
          className="active:opacity-80"
        >
          <Text className="text-ink text-sm font-bold tracking-[0.15em] uppercase">Got it</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

export default function PodiumScreen() {
  const { code, allOutcomesJson } = useLocalSearchParams<{
    code: string;
    allOutcomesJson: string;
  }>();

  const { playerId } = usePlayerIdentity();
  const { snapshot, send, dissolved } = useRoomSocket(code);

  const outcomes: Record<string, PlayerOutcome> = (() => {
    try { return allOutcomesJson ? JSON.parse(allOutcomesJson) : {}; } catch { return {}; }
  })();

  const isAdmin = !!snapshot && snapshot.admin_id === playerId;

  // Chasers-owed popup — shown once automatically on arrival, and reopenable
  // any time via the small button in the header (see JSX below).
  const chasersRows: ChaserRow[] = Object.entries(outcomes)
    .filter(([, o]) => o.chasers > 0)
    .map(([pid, o]) => ({
      pid,
      name: snapshot?.players[pid]?.display_name ?? 'Player',
      avatar: snapshot?.players[pid]?.avatar ?? null,
      chasers: o.chasers,
    }));
  // Let the podium's own reveal play out first — the before→after standings
  // swap and the score count-up (REVEAL_DELAY_MS + SCORE_ROLL_MS ≈ 2.8s) are
  // the moment's payoff; popping the popup over them immediately steals that
  // effect. Waiting this long also guarantees the screen has fully settled,
  // so the popup never gets caught mid-transition.
  const CHASERS_POPUP_DELAY_MS = 3500;

  const [showChasers, setShowChasers] = useState(false);
  useEffect(() => {
    if (chasersRows.length === 0 || lastChasersPopupKey === allOutcomesJson) return;
    const timer = setTimeout(() => {
      lastChasersPopupKey = allOutcomesJson;
      setShowChasers(true);
    }, CHASERS_POPUP_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 'before' = standings as they stood at the start of this round,
  // 'after' = current cumulative totals. Flipping this drives the list's
  // reorder + score-count animation. The podium shows the final result
  // from the start — it doesn't participate in the before/after replay.
  const [phase, setPhase] = useState<'before' | 'after'>('before');

  useEffect(() => {
    const timer = setTimeout(() => setPhase('after'), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const rows = Object.entries(snapshot?.players ?? {}).map(([pid, p]) => {
    const delta = outcomes[pid]?.score_delta ?? null;
    return {
      pid,
      display_name: p.display_name,
      avatar: p.avatar ?? null,
      afterScore: p.score,
      beforeScore: delta != null ? p.score - delta : p.score,
      delta,
    };
  });

  // Ranked list for the current phase, with dense ranks (ties share a rank).
  const ranked = (() => {
    const sorted = [...rows].sort((a, b) => {
      const sa = phase === 'before' ? a.beforeScore : a.afterScore;
      const sb = phase === 'before' ? b.beforeScore : b.afterScore;
      return sb - sa;
    });
    let rank = 0;
    let prevScore: number | null = null;
    return sorted.map((row) => {
      const displayScore = phase === 'before' ? row.beforeScore : row.afterScore;
      if (displayScore !== prevScore) rank += 1;
      prevScore = displayScore;
      return { ...row, rank, displayScore };
    });
  })();

  // Podium: final standings only, top 3 players, tiers by distinct after-score.
  const podium = (() => {
    const sorted = [...rows].sort((a, b) => b.afterScore - a.afterScore);
    let tier = 0;
    let prevScore: number | null = null;
    const tiered = sorted.map((row) => {
      if (row.afterScore !== prevScore) tier += 1;
      prevScore = row.afterScore;
      return { ...row, tier };
    });
    return tiered.slice(0, 3);
  })();

  // Classic arrangement: runner-up left, leader center, third right —
  // with ties the shared tier gives equal heights, which reads as the draw it is.
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);
  const maxTier = Math.max(...podium.map((p) => p.tier), 1);

  // Navigate when room is dissolved (End Night)
  useEffect(() => {
    if (dissolved) router.replace('/');
  }, [dissolved]);

  // Navigate when FSM transitions to next tutorial
  useEffect(() => {
    if (snapshot?.state !== 'TUTORIAL') return;
    router.replace({
      pathname: '/room/[code]/tutorial',
      params: {
        code,
        tutorialType: snapshot.tutorialType ?? '',
        tutorialAsset: snapshot.tutorialAsset ?? '',
      },
    });
  }, [snapshot?.state, snapshot?.tutorialType, snapshot?.tutorialAsset, code]);

  // Fallback: navigate back to lobby if state resets there
  useEffect(() => {
    if (snapshot?.state === 'LOBBY') {
      router.replace({ pathname: '/room/[code]/lobby', params: { code } });
    }
  }, [snapshot?.state, code]);

  function handleNextRound() { send({ type: 'NEXT_ROUND' }); }
  function handleEndNight()  { send({ type: 'END_NIGHT' }); }

  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeInDown.duration(400)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}
        >
          <View>
            <Text style={{ color: AMBER, ...typography.label, fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 6 }}>
              Round results
            </Text>
            <Text style={{ fontWeight: '200', color: INK, fontSize: 44, lineHeight: 48, letterSpacing: -2 }}>
              Leader
            </Text>
            <Text style={{ fontWeight: '900', color: AMBER, fontSize: 44, lineHeight: 48, letterSpacing: -2 }}>
              board
            </Text>
          </View>

          {/* Reopens the "who's drinking" popup on demand — it also pops up
              once automatically, but people arrive at this screen at
              different times and may want to check it again later. */}
          {chasersRows.length > 0 && (
            <Pressable
              onPress={() => setShowChasers(true)}
              style={{ borderWidth: 1.5, borderColor: INK, padding: 8 }}
              className="active:opacity-60"
            >
              <GlassWater size={18} color={INK} strokeWidth={2} />
            </Pressable>
          )}
        </Animated.View>

        {/* Podium — final standings, on screen from the start */}
        {podium.length > 0 && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: 10,
              marginBottom: 12,
            }}
          >
            {podiumOrder.map((p) => (
              <PodiumColumn
                key={p.pid}
                name={p.display_name}
                avatar={p.avatar}
                // Ticks before → after in sync with the list below; column
                // heights stay final so the podium shape never lies.
                score={phase === 'before' ? p.beforeScore : p.afterScore}
                tier={p.tier}
                isMe={p.pid === playerId}
                delayMs={(maxTier - p.tier) * 180}
              />
            ))}
          </View>
        )}

        {/* Baseline under the podium grounds the columns */}
        {podium.length > 0 && (
          <View style={{ height: 2, backgroundColor: INK, marginBottom: 10 }} />
        )}

        {/* Phase caption for the list replay below */}
        <Text
          style={{
            color: MUTED,
            ...typography.label,
            fontSize: 10,
            letterSpacing: 3,
            textTransform: 'uppercase',
            marginBottom: 12,
            textAlign: 'right',
          }}
        >
          {phase === 'before' ? 'Before this round' : 'After this round'}
        </Text>

        {/* Full ranked list — replays the before → after movement for everyone */}
        {ranked.map((row, index) => {
          const isMe = row.pid === playerId;
          const isTop = row.rank === 1;

          return (
            <Animated.View
              key={row.pid}
              layout={LinearTransition.springify().damping(26).stiffness(65).mass(1.1)}
              entering={FadeInDown.delay(index * 60).duration(320)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 14,
                paddingHorizontal: 14,
                marginBottom: 10,
                backgroundColor: isMe ? ME_BG : CARD,
                borderWidth: 1,
                borderColor: isMe ? AMBER : HAIRLINE,
                shadowColor: INK,
                shadowOpacity: 0.05,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 3 },
                elevation: 2,
              }}
            >
              {/* Rank chip — ties share a rank */}
              <View
                style={{
                  width: 28,
                  height: 28,
                  marginRight: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isTop ? AMBER : 'transparent',
                  borderWidth: isTop ? 0 : 1,
                  borderColor: HAIRLINE,
                }}
              >
                <Text
                  style={{
                    ...typography.label,
                    fontWeight: '700',
                    fontSize: 14,
                    color: isTop ? INK : MUTED,
                  }}
                >
                  {row.rank}
                </Text>
              </View>

              <View style={{ marginRight: 10 }}>
                <AvatarCircle
                  name={row.display_name}
                  avatar={row.avatar}
                  size={32}
                  ringColor={isMe ? AMBER : row.avatar ? AVATAR_COLORS[row.avatar] : HAIRLINE}
                />
              </View>

              <Text
                numberOfLines={1}
                style={{ flex: 1, color: INK, fontSize: 15, fontWeight: '600', marginRight: 8 }}
              >
                {row.display_name}
                {isMe ? ' (you)' : ''}
              </Text>

              {/* Last-round delta pill */}
              {phase === 'after' && row.delta != null && row.delta !== 0 && (
                <Animated.View
                  entering={FadeIn.delay(SCORE_ROLL_MS).duration(300)}
                  style={{
                    backgroundColor: row.delta > 0 ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    marginRight: 10,
                  }}
                >
                  <Text
                    style={{
                      color: row.delta > 0 ? GO : STOP,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    ({row.delta > 0 ? '+' : '−'}{Math.abs(row.delta)})
                  </Text>
                </Animated.View>
              )}

              <AnimatedScore
                value={row.displayScore}
                style={{
                  color: INK,
                  fontSize: 17,
                  fontWeight: '800',
                  minWidth: 30,
                  textAlign: 'right',
                }}
              />
            </Animated.View>
          );
        })}

        {/* Admin actions / non-admin waiting */}
        <Animated.View
          entering={FadeInDown.delay(ranked.length * 60 + 100).duration(350)}
          style={{ marginTop: 12, gap: 12 }}
        >
          {isAdmin ? (
            <>
              <Pressable
                onPress={handleNextRound}
                style={{ backgroundColor: AMBER }}
                className="py-5 items-center rounded-none active:opacity-80"
              >
                <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                  Next Round
                </Text>
              </Pressable>

              <Pressable
                onPress={handleEndNight}
                style={{ borderWidth: 2, borderColor: INK }}
                className="py-5 items-center rounded-none active:opacity-60"
              >
                <Text style={{ color: INK }} className="text-sm font-bold tracking-[0.18em] uppercase">
                  End Night
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={{ color: MUTED }} className="text-sm text-center">
              Waiting for host…
            </Text>
          )}
        </Animated.View>
      </ScrollView>

      {showChasers && (
        <ChasersPopup rows={chasersRows} onDismiss={() => setShowChasers(false)} />
      )}
    </View>
  );
}
