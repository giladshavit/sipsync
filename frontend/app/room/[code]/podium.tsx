import { useEffect, useState } from 'react';
import { View, Text, Pressable, Share, ScrollView, TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Award, Check, Copy, Crown, DoorOpen, FastForward, GlassWater, ListOrdered, LogOut, Pencil, Share2, Skull, X } from 'lucide-react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeIn,
  FadeOutUp,
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
import { buildRoomShareMessage } from '@/lib/deepLink';
import { typography } from '@/constants/design';
import { AVATAR_COLORS } from '@/constants/avatars';
import { GAME_CATALOG, getGameById, type GameMeta, type RuleLine } from '@/constants/games';
import { AvatarCircle } from '@/components/games/SharedChaserDistributor';
import { GamesSheet } from '@/components/GamesSheet';
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
// The non-semantic identity pair a couple of games' rule text uses to tag
// "player 1 / player 2" (see RuleSegment's own doc comment in games.ts) —
// matches constants/design.ts's colors.tapped / colors.orange.
const BLUE     = '#2563EB';
const ORANGE   = '#F97316';

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

// Up Next preview — fixed regardless of whether nextGame data has arrived
// yet or which game it's showing. Without a fixed height here, the header
// grew/shrank by a line of text every time the title wrapped differently (a
// one-word title vs a three-word one) or the moment nextGameId first landed
// after mount, and everything below — the podium columns, the standings
// list — visibly jumped to absorb the difference. Reserving the same box up
// front (see the always-rendered placeholder below) keeps that whole region
// static from first paint.
const UP_NEXT_CARD_HEIGHT = 72;
const UP_NEXT_SKIP_HEIGHT = 26;

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

// ── Stats modal — Scoreboard + Drinks, opened via the header Stats button ──
interface ChaserRow { pid: string; name: string; avatar: string | null; chasers: number }

interface RankedRow {
  pid: string;
  display_name: string;
  avatar: string | null;
  afterScore: number;
  beforeScore: number;
  delta: number | null;
  rank: number;
  displayScore: number;
}

type DrinksTab = 'round' | 'total';

function StatsModal({
  ranked, playerId, rows, totalRows, onDismiss, initialTab, phase,
}: {
  ranked: RankedRow[];
  playerId: string | null;
  rows: ChaserRow[];
  totalRows: ChaserRow[];
  onDismiss: () => void;
  initialTab: 'scoreboard' | 'drinks';
  phase: 'before' | 'after';
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.85);
  const [topTab, setTopTab] = useState<'scoreboard' | 'drinks'>(initialTab);
  const [drinksTab, setDrinksTab] = useState<DrinksTab>('round');

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

  const activeChaserRows = drinksTab === 'round' ? rows : totalRows;
  const topTotalPid = totalRows.length > 0 ? totalRows[0].pid : null;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
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
            width: 320,
            maxWidth: '88%',
            maxHeight: '74%',
            paddingVertical: 24,
            paddingHorizontal: 22,
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        <Text
          style={{
            fontWeight: '900',
            color: INK,
            fontSize: 24,
            letterSpacing: -0.5,
            textAlign: 'center',
            marginBottom: 16,
          }}
        >
          Stats
        </Text>

        {/* Top-level tabs */}
        <View
          style={{
            flexDirection: 'row',
            borderWidth: 1.5,
            borderColor: INK,
            marginBottom: 16,
          }}
        >
          <Pressable
            onPress={() => setTopTab('scoreboard')}
            style={{
              flex: 1,
              paddingVertical: 9,
              alignItems: 'center',
              backgroundColor: topTab === 'scoreboard' ? INK : 'transparent',
            }}
            className="active:opacity-70"
          >
            <Text style={{ ...typography.label, fontSize: 10, letterSpacing: 1.5, color: topTab === 'scoreboard' ? CARD : MUTED }}>
              Scoreboard
            </Text>
          </Pressable>
          <View style={{ width: 1.5, backgroundColor: INK }} />
          <Pressable
            onPress={() => setTopTab('drinks')}
            style={{
              flex: 1,
              paddingVertical: 9,
              alignItems: 'center',
              backgroundColor: topTab === 'drinks' ? INK : 'transparent',
            }}
            className="active:opacity-70"
          >
            <Text style={{ ...typography.label, fontSize: 10, letterSpacing: 1.5, color: topTab === 'drinks' ? CARD : MUTED }}>
              Drinks
            </Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {topTab === 'scoreboard' ? (
            <View style={{ gap: 10 }}>
              {ranked.map((row) => {
                const isMe = row.pid === playerId;
                const isTop = row.rank === 1;
                return (
                  <View
                    key={row.pid}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      backgroundColor: isMe ? ME_BG : BG,
                      borderWidth: 1,
                      borderColor: isMe ? AMBER : HAIRLINE,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        marginRight: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isTop ? AMBER : 'transparent',
                        borderWidth: isTop ? 0 : 1,
                        borderColor: HAIRLINE,
                      }}
                    >
                      <Text style={{ ...typography.label, fontWeight: '700', fontSize: 12, color: isTop ? INK : MUTED }}>
                        {row.rank}
                      </Text>
                    </View>
                    <View style={{ marginRight: 10 }}>
                      <AvatarCircle
                        name={row.display_name}
                        avatar={row.avatar}
                        size={30}
                        ringColor={isMe ? AMBER : row.avatar ? AVATAR_COLORS[row.avatar] : HAIRLINE}
                      />
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, color: INK, fontSize: 14, fontWeight: '600', marginRight: 8 }}>
                      {row.display_name}{isMe ? ' (you)' : ''}
                    </Text>
                    {phase === 'after' && row.delta != null && row.delta !== 0 && (
                      <View
                        style={{
                          backgroundColor: row.delta > 0 ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)',
                          paddingHorizontal: 7,
                          paddingVertical: 3,
                          marginRight: 8,
                        }}
                      >
                        <Text style={{ color: row.delta > 0 ? GO : STOP, fontSize: 11, fontWeight: '700' }}>
                          ({row.delta > 0 ? '+' : '−'}{Math.abs(row.delta)})
                        </Text>
                      </View>
                    )}
                    <Text style={{ color: INK, fontSize: 16, fontWeight: '800', minWidth: 28, textAlign: 'right' }}>
                      {row.displayScore}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  borderWidth: 1.5,
                  borderColor: HAIRLINE,
                  marginBottom: 14,
                }}
              >
                <Pressable
                  onPress={() => setDrinksTab('round')}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: 'center',
                    backgroundColor: drinksTab === 'round' ? HAIRLINE : 'transparent',
                  }}
                  className="active:opacity-70"
                >
                  <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: drinksTab === 'round' ? INK : MUTED }}>
                    This Round
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setDrinksTab('total')}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: 'center',
                    backgroundColor: drinksTab === 'total' ? HAIRLINE : 'transparent',
                  }}
                  className="active:opacity-70"
                >
                  <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: drinksTab === 'total' ? INK : MUTED }}>
                    Total
                  </Text>
                </Pressable>
              </View>

              {activeChaserRows.length === 0 ? (
                <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 16 }}>
                  Nobody&apos;s owed a single chaser yet.
                </Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {activeChaserRows.map((row) => {
                    const isTopTotal = drinksTab === 'total' && row.pid === topTotalPid;
                    return (
                      <View
                        key={row.pid}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          backgroundColor: isTopTotal ? 'rgba(220,38,38,0.07)' : BG,
                          borderWidth: isTopTotal ? 1.5 : 1,
                          borderColor: isTopTotal ? STOP : HAIRLINE,
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
                        {isTopTotal && <Skull size={15} color={STOP} strokeWidth={2.5} />}
                        {drinksTab === 'total' ? (
                          <>
                            <Text style={{ color: STOP, fontSize: 16, fontWeight: '900' }}>×{row.chasers}</Text>
                            <GlassWater size={16} color={STOP} strokeWidth={2.5} />
                          </>
                        ) : (
                          <>
                            <GlassWater size={16} color={STOP} strokeWidth={2.5} style={{ marginRight: 6 }} />
                            <Text style={{ color: STOP, fontSize: 15, fontWeight: '800' }}>{row.chasers}</Text>
                          </>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>

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

// ── Share popup — same overlay/card language as StatsModal ─────────────────
// Two distinct actions rather than one button that guesses which the player
// wants: copying the code is the fast path for someone already talking to
// the room in person or over voice chat; the native share sheet is the path
// for sending it somewhere text has to travel (a text thread, DMs).
function SharePopup({ code, onDismiss }: { code: string; onDismiss: () => void }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.85);
  const [copied, setCopied] = useState(false);

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

  async function handleCopy() {
    await Clipboard.setStringAsync(code ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleShareLink() {
    await Share.share({ message: buildRoomShareMessage(code) });
    onDismiss();
  }

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
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
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          style={{ position: 'absolute', top: 16, right: 16, zIndex: 1 }}
          className="active:opacity-60"
        >
          <X size={18} color={MUTED} strokeWidth={2} />
        </Pressable>

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
          Invite friends
        </Text>
        <Text
          style={{
            fontWeight: '900',
            color: AMBER,
            fontSize: 24,
            letterSpacing: -0.5,
            textAlign: 'center',
            marginBottom: 22,
          }}
        >
          Bring Someone In
        </Text>

        <View style={{ gap: 12 }}>
          {/* Premium code block — same monospace/tracked treatment as
              lobby.tsx's own code display, the icon absolutely positioned
              so the code itself stays perfectly centered regardless of
              digit width. This *is* the "Copy Room Code" action now, not a
              separate readout sitting above a smaller button for it. */}
          <Pressable
            onPress={handleCopy}
            style={{
              backgroundColor: BG,
              borderWidth: 2,
              borderColor: INK,
              paddingVertical: 18,
              alignItems: 'center',
            }}
            className="active:opacity-70"
          >
            <Text
              style={{
                color: INK,
                fontSize: 22,
                fontFamily: 'Courier New',
                fontWeight: '700',
                letterSpacing: 8,
                textAlign: 'center',
              }}
            >
              {code}
            </Text>
            <View style={{ position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' }}>
              {copied ? <Check size={20} color={GO} strokeWidth={2} /> : <Copy size={20} color={INK} strokeWidth={2} />}
            </View>
          </Pressable>

          {/* Share Invite Link — filled amber, the clear visual opposite of
              the outlined code block above it. */}
          <Pressable
            onPress={handleShareLink}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 15,
              backgroundColor: AMBER,
              gap: 9,
            }}
            className="active:opacity-80"
          >
            <Share2 size={17} color={INK} strokeWidth={2.5} />
            <Text style={{ color: INK, fontSize: 14, fontWeight: '800' }} className="tracking-[0.14em] uppercase">
              Share Invite Link
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={onDismiss}
          style={{ marginTop: 20, paddingVertical: 10, alignItems: 'center' }}
          className="active:opacity-60"
        >
          <Text style={{ color: MUTED }} className="text-xs font-bold tracking-[0.15em] uppercase">Close</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function ruleSegmentColor(color: 'red' | 'green' | 'amber' | 'blue' | 'orange' | undefined): string {
  if (color === 'red') return STOP;
  if (color === 'green') return GO;
  if (color === 'amber') return AMBER;
  if (color === 'blue') return BLUE;
  if (color === 'orange') return ORANGE;
  return INK;
}

// Inline echo of games/[id]/index.tsx's own RuleText — same string-or-
// colored-segments rendering, just sized for this modal's tighter card
// rather than a full screen.
function RuleText({ line }: { line: RuleLine }) {
  if (typeof line === 'string') {
    return <Text style={{ color: INK, fontSize: 14, lineHeight: 20, flex: 1 }}>{line}</Text>;
  }
  return (
    <Text style={{ fontSize: 14, lineHeight: 20, flex: 1 }}>
      {line.map((seg, i) => (
        <Text
          key={i}
          style={{
            color: ruleSegmentColor(seg.color),
            fontWeight: seg.color || seg.bold ? '800' : '400',
          }}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

// Up Next: the admin's queued-game preview, opened by tapping the small
// card in the header. Deliberately an in-tree overlay (same pattern as
// StatsModal/SharePopup above) rather than a route push — routing away
// would tear down this screen's WebSocket listener, and the whole point is
// that the FSM's own TUTORIAL transition (Next Round) can pull the room out
// from under this modal via the screen's existing router.replace effect.
// Scoped to what the card promises — how to play, the icon, the tagline —
// not the full details screen's who-drinks/scoring breakdown, which stays
// a reason to visit the real rules screen later.
function NextGameRulesModal({ game, onDismiss }: { game: GameMeta; onDismiss: () => void }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    scale.value = withSequence(
      withTiming(1.03, { duration: 220, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 130 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const { Icon } = game;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
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
            width: 320,
            maxWidth: '88%',
            maxHeight: '78%',
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        <View
          style={{
            height: 108,
            backgroundColor: game.accentColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={46} color="#FFFFFF" strokeWidth={1.5} />
        </View>

        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: 'rgba(10,10,15,0.35)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-70"
        >
          <X size={16} color="#FFFFFF" strokeWidth={2.5} />
        </Pressable>

        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
          <Text
            style={{
              ...typography.label,
              fontSize: 10,
              letterSpacing: 3,
              color: MUTED,
              marginBottom: 4,
            }}
          >
            Up next
          </Text>
          <Text style={{ fontWeight: '900', color: INK, fontSize: 22, letterSpacing: -0.5, marginBottom: 4 }}>
            {game.title}
          </Text>
          <Text style={{ color: MUTED, fontSize: 13, marginBottom: 20 }}>
            {game.tagline}
          </Text>

          <Text
            style={{
              ...typography.label,
              fontSize: 11,
              letterSpacing: 2,
              color: INK,
              marginBottom: 12,
            }}
          >
            How to play
          </Text>
          <View style={{ gap: 12 }}>
            {game.rules.map((rule, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                <Text style={{ color: AMBER, fontWeight: '900', fontSize: 13, width: 16 }}>
                  {i + 1}
                </Text>
                <RuleText line={rule} />
              </View>
            ))}
          </View>

          {game.RulesIllustration && (
            <View style={{ marginTop: 14 }}>
              <game.RulesIllustration />
            </View>
          )}

          {game.rulesNote && (
            <View
              style={{
                borderWidth: 2,
                borderColor: INK,
                backgroundColor: AMBER,
                paddingVertical: 10,
                paddingHorizontal: 14,
                marginTop: 14,
              }}
            >
              <Text style={{ color: INK, fontSize: 13, fontWeight: '700', lineHeight: 18 }}>
                {game.rulesNote}
              </Text>
            </View>
          )}
        </ScrollView>

        <Pressable
          onPress={onDismiss}
          style={{ paddingVertical: 16, alignItems: 'center', borderTopWidth: 1.5, borderTopColor: HAIRLINE }}
          className="active:opacity-70"
        >
          <Text style={{ color: MUTED }} className="text-xs font-bold tracking-[0.15em] uppercase">Close</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// Host Migration: sleek, self-dismissing banner — deliberately not a modal
// like StatsModal. A promotion is good news that shouldn't block the
// leaderboard someone just arrived to look at; it announces itself and gets
// out of the way (auto-hides, or a tap dismisses it early).
const PROMOTION_TOAST_DURATION_MS = 3200;

function PromotionToast({ topInset, onDismiss }: { topInset: number; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, PROMOTION_TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <Animated.View
      entering={FadeInDown.duration(280).easing(Easing.out(Easing.cubic))}
      exiting={FadeOutUp.duration(220)}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        paddingTop: topInset + 10,
        alignItems: 'center',
        zIndex: 60,
      }}
    >
      <Pressable
        onPress={onDismiss}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: INK,
          borderWidth: 2,
          borderColor: AMBER,
          paddingVertical: 12,
          paddingHorizontal: 16,
          maxWidth: '86%',
          shadowColor: INK,
          shadowOpacity: 0.25,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
        className="active:opacity-80"
      >
        <Crown size={18} color={AMBER} strokeWidth={2} />
        <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>
          You are now the Room Admin
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function PodiumScreen() {
  const { code, allOutcomesJson } = useLocalSearchParams<{
    code: string;
    allOutcomesJson: string;
  }>();

  const { playerId } = usePlayerIdentity();
  const { snapshot, send, dissolved, dismissPromotion } = useRoomSocket(code);

  const outcomes: Record<string, PlayerOutcome> = (() => {
    try { return allOutcomesJson ? JSON.parse(allOutcomesJson) : {}; } catch { return {}; }
  })();

  const isAdmin = !!snapshot && snapshot.admin_id === playerId;

  // Leave Room: personal, permanent departure — available to every player
  // here, not just the admin (see handleEndNight for the admin-only "end
  // the whole night" action, a distinct control further down). Same
  // confirmation overlay pattern as lobby.tsx's own confirmingLeave.
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  function handleLeave() {
    send({ type: 'LEAVE_ROOM' });
    router.replace('/');
  }

  // Up Next preview — the deck's peeked (not popped) next game, shown to
  // everyone in the header; only the admin gets the Skip control next to it.
  const nextGame = snapshot?.nextGameId ? getGameById(snapshot.nextGameId) : undefined;
  const [showNextGameModal, setShowNextGameModal] = useState(false);
  function handleSkipGame() { send({ type: 'SKIP_GAME' }); }

  // Host Migration: this is the only screen that ever renders the toast —
  // useRoomSocket computes justPromoted per-mount, so it only fires here
  // when the promotion itself happens while this screen is open (a
  // mid-round promotion, e.g. an admin's disconnect, is never retroactively
  // flagged once this screen mounts fresh — see justPromoted's own doc
  // comment). Consuming it (dismissPromotion) immediately, rather than
  // waiting for the toast's own auto-hide, means a second podium mount
  // before the toast finishes its timer (e.g. a fast Next Round → End Night
  // round-trip) won't show it twice.
  const [showPromotionToast, setShowPromotionToast] = useState(false);
  useEffect(() => {
    if (!snapshot?.justPromoted) return;
    setShowPromotionToast(true);
    dismissPromotion();
  }, [snapshot?.justPromoted, dismissPromotion]);

  // Chasers owed this round — Drinks tab of the StatsModal, opened via the
  // small button in the header (see JSX below).
  const chasersRows: ChaserRow[] = Object.entries(outcomes)
    .filter(([, o]) => o.chasers > 0)
    .map(([pid, o]) => ({
      pid,
      name: snapshot?.players[pid]?.display_name ?? 'Player',
      avatar: snapshot?.players[pid]?.avatar ?? null,
      chasers: o.chasers,
    }));

  // Total Drinks: cumulative chasers across the whole night so far, sorted
  // worst-first — the StatsModal's "TOTAL" tab.
  const totalChaserRows: ChaserRow[] = Object.entries(snapshot?.players ?? {})
    .map(([pid, p]) => ({
      pid,
      name: p.display_name,
      avatar: p.avatar ?? null,
      chasers: p.total_chasers ?? 0,
    }))
    .filter((row) => row.chasers > 0)
    .sort((a, b) => b.chasers - a.chasers);

  const [showStats, setShowStats] = useState(false);
  const [statsInitialTab, setStatsInitialTab] = useState<'scoreboard' | 'drinks'>('scoreboard');

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

  // End Night is destructive for the whole room (dissolves it for every
  // player, not just this one admin — unlike Leave Room above), so it gets
  // its own confirmation gate rather than firing straight off the icon tap.
  const [confirmingEndNight, setConfirmingEndNight] = useState(false);
  function confirmEndNight() {
    setConfirmingEndNight(false);
    handleEndNight();
  }

  // Share Invite: available to every player here (not just admin) — anyone
  // on the podium between rounds is a natural moment to pull in someone who
  // couldn't make the start (see Late Join / waiting.tsx for what happens
  // when they use it mid-round). Opens SharePopup rather than acting
  // immediately — copy-vs-share-sheet is a real choice, not a single
  // best-guess action.
  const [showSharePopup, setShowSharePopup] = useState(false);

  // Mid-Session Game Editing: the admin can adjust tonight's lineup from
  // here too, not just the lobby — the server now allows SET_GAMES from
  // PODIUM as well as LOBBY (see room_service.handle_set_games).
  const [gamesSheetMode, setGamesSheetMode] = useState<'edit' | null>(null);
  const connectedPlayerCount = Object.values(snapshot?.players ?? {}).filter(
    (p) => p.connected !== false,
  ).length;

  // Same bulk-replace flow as lobby.tsx's commitGameIds/handleSetGames:
  // always reorders to catalog order and never lets the list go empty (the
  // server's own normalize_game_ids silently no-ops SET_GAMES on an empty
  // list, so this guard keeps the UI truthful about what will actually apply).
  function commitGameIds(next: string[]) {
    const ordered = GAME_CATALOG.filter((g) => next.includes(g.id)).map((g) => g.id);
    if (ordered.length === 0) return;
    send({ type: 'SET_GAMES', game_ids: ordered });
  }
  function handleSetGames(ids: string[]) {
    commitGameIds(Array.from(new Set(ids)));
  }

  const insets = useSafeAreaInsets();
  const HEADER_ICON_BTN = 40;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header — three equal-width flex columns so the centered title
          stays geometrically centered regardless of the left column
          holding 1 button and the right column holding 2. */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}
      >
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Pressable
            onPress={() => setConfirmingLeave(true)}
            style={{ width: HEADER_ICON_BTN, height: HEADER_ICON_BTN, borderWidth: 1.5, borderColor: STOP, backgroundColor: 'rgba(220,38,38,0.10)', alignItems: 'center', justifyContent: 'center' }}
            className="active:opacity-60"
          >
            <DoorOpen size={18} color={STOP} strokeWidth={2} />
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: MUTED, ...typography.label, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
            Round results
          </Text>
          <Text style={{ color: AMBER, ...typography.title, fontSize: 22, letterSpacing: 3 }}>
            Podium
          </Text>
        </View>

        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => setShowSharePopup(true)}
              style={{ width: HEADER_ICON_BTN, height: HEADER_ICON_BTN, borderWidth: 1.5, borderColor: INK, backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center' }}
              className="active:opacity-60"
            >
              <Share2 size={18} color={INK} strokeWidth={2} />
            </Pressable>

            {/* Stats — always visible (the Scoreboard tab always has
                content, unlike the old conditional Chasers button). */}
            <Pressable
              onPress={() => { setStatsInitialTab('scoreboard'); setShowStats(true); }}
              style={{ width: HEADER_ICON_BTN, height: HEADER_ICON_BTN, borderWidth: 1.5, borderColor: INK, backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center' }}
              className="active:opacity-60"
            >
              <ListOrdered size={18} color={INK} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </Animated.View>

      {/* Up Next — full-width strip, no longer coupled to the header
          icon row's width. Reserves its footprint before nextGameId
          arrives so nothing below jumps once it does. */}
      <View style={{ marginBottom: 20 }}>
        <View style={{ height: UP_NEXT_CARD_HEIGHT }}>
          {nextGame ? (
            <Pressable
              onPress={() => setShowNextGameModal(true)}
              style={{
                flex: 1,
                flexDirection: 'row',
                borderWidth: 1.5,
                borderColor: INK,
                backgroundColor: nextGame.accentColor,
                paddingHorizontal: 14,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
              className="active:opacity-70"
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <nextGame.Icon size={18} color="#FFFFFF" strokeWidth={2} />
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: 'rgba(255,255,255,0.8)' }}>
                  Up next
                </Text>
                <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800' }}>
                  {nextGame.title}
                </Text>
              </View>
            </Pressable>
          ) : (
            <View
              style={{
                flex: 1,
                borderWidth: 1.5,
                borderColor: HAIRLINE,
                backgroundColor: CARD,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: MUTED }}>
                Up next
              </Text>
            </View>
          )}
        </View>

        {isAdmin && (
          <Pressable
            onPress={handleSkipGame}
            disabled={!nextGame}
            style={{
              height: UP_NEXT_SKIP_HEIGHT,
              marginTop: 6,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              borderWidth: 1.5,
              borderColor: INK,
              backgroundColor: nextGame ? AMBER : HAIRLINE,
            }}
            className="active:opacity-70"
          >
            <FastForward size={11} color={INK} strokeWidth={2.5} />
            <Text style={{ color: INK, fontSize: 9, fontWeight: '800', letterSpacing: 1 }} className="uppercase">
              Skip this game
            </Text>
          </Pressable>
        )}
      </View>

      {/* Podium — the untouched animated visualization, now the
          screen's center-stage focus with room to breathe on all sides. */}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
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
                score={phase === 'before' ? p.beforeScore : p.afterScore}
                tier={p.tier}
                isMe={p.pid === playerId}
                delayMs={(maxTier - p.tier) * 180}
              />
            ))}
          </View>
        )}

        {podium.length > 0 && (
          <View style={{ height: 2, width: 220, backgroundColor: INK }} />
        )}
      </View>

      {/* Admin actions / non-admin waiting */}
      <Animated.View
        entering={FadeInDown.delay(300).duration(350)}
        style={{ marginTop: 12, gap: 12 }}
      >
        {isAdmin ? (
          <View style={{ gap: 10 }}>
            {/* Secondary actions — a tweak and an exit, styled as clearly
                tappable outlined buttons (not the old dim/disabled-looking
                icon squares) side-by-side to save vertical space. */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setGamesSheetMode('edit')}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  height: 52,
                  borderWidth: 2,
                  borderColor: INK,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                className="active:opacity-60"
              >
                <Pencil size={16} color={INK} strokeWidth={2} />
                <Text style={{ ...typography.label, fontSize: 11, letterSpacing: 1.5, color: INK }}>
                  Edit Games
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setConfirmingEndNight(true)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  height: 52,
                  borderWidth: 2,
                  borderColor: INK,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                className="active:opacity-60"
              >
                <LogOut size={16} color={INK} strokeWidth={2} />
                <Text style={{ ...typography.label, fontSize: 11, letterSpacing: 1.5, color: INK }}>
                  End Night
                </Text>
              </Pressable>
            </View>

            {/* Next Round — the unmistakable primary CTA: full-width,
                taller than the secondary row, amber with a soft glow. */}
            <Pressable
              onPress={handleNextRound}
              style={{
                height: 64,
                backgroundColor: AMBER,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: AMBER,
                shadowOpacity: 0.4,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 4 },
                elevation: 8,
              }}
              className="active:opacity-80"
            >
              <Text className="text-ink text-base font-bold tracking-[0.2em] uppercase">
                Next Round
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text style={{ color: MUTED }} className="text-sm text-center">
            Waiting for host…
          </Text>
        )}
      </Animated.View>

      {showStats && (
        <StatsModal
          ranked={ranked}
          playerId={playerId}
          rows={chasersRows}
          totalRows={totalChaserRows}
          initialTab={statsInitialTab}
          phase={phase}
          onDismiss={() => setShowStats(false)}
        />
      )}

      {showSharePopup && (
        <SharePopup code={code ?? ''} onDismiss={() => setShowSharePopup(false)} />
      )}

      {showNextGameModal && nextGame && (
        <NextGameRulesModal game={nextGame} onDismiss={() => setShowNextGameModal(false)} />
      )}

      {gamesSheetMode && (
        <GamesSheet
          mode={gamesSheetMode}
          selectedIds={snapshot?.gameIds ?? []}
          onSetSelected={handleSetGames}
          onClose={() => setGamesSheetMode(null)}
          playerCount={connectedPlayerCount}
        />
      )}

      {showPromotionToast && (
        <PromotionToast topInset={insets.top} onDismiss={() => setShowPromotionToast(false)} />
      )}

      {/* Leave confirmation overlay — same layout/copy as lobby.tsx's own
          confirmingLeave overlay, just wired to this screen's local colors. */}
      {confirmingLeave && (
        <Animated.View
          entering={FadeIn.duration(150)}
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            backgroundColor: 'rgba(10,10,15,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              alignSelf: 'stretch',
              backgroundColor: BG,
              borderWidth: 2,
              borderColor: INK,
              padding: 24,
            }}
          >
            <Text style={{ fontWeight: '900', color: INK, fontSize: 24, letterSpacing: -0.5, marginBottom: 8 }}>
              Leave the room?
            </Text>
            <Text style={{ color: MUTED, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
              {isAdmin
                ? 'Hosting passes to a random player. You can rejoin with the code.'
                : 'You can rejoin anytime with the code.'}
            </Text>

            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => setConfirmingLeave(false)}
                className="bg-amber py-4 items-center rounded-none active:opacity-80"
              >
                <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                  Stay
                </Text>
              </Pressable>
              <Pressable
                onPress={handleLeave}
                style={{ borderWidth: 2, borderColor: STOP }}
                className="py-4 items-center rounded-none active:opacity-60"
              >
                <Text style={{ color: STOP }} className="text-sm font-bold tracking-[0.18em] uppercase">
                  Leave room
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}

      {/* End Night confirmation overlay — same visual language as the Leave
          overlay above, but for the admin-only action that dissolves the
          room for every player, not just this one device. */}
      {confirmingEndNight && (
        <Animated.View
          entering={FadeIn.duration(150)}
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            backgroundColor: 'rgba(10,10,15,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              alignSelf: 'stretch',
              backgroundColor: BG,
              borderWidth: 2,
              borderColor: INK,
              padding: 24,
            }}
          >
            <Text style={{ fontWeight: '900', color: INK, fontSize: 24, letterSpacing: -0.5, marginBottom: 8 }}>
              End the night?
            </Text>
            <Text style={{ color: MUTED, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
              This closes the room for everyone — no one will be able to rejoin.
            </Text>

            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => setConfirmingEndNight(false)}
                className="bg-amber py-4 items-center rounded-none active:opacity-80"
              >
                <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                  Keep playing
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmEndNight}
                style={{ borderWidth: 2, borderColor: STOP }}
                className="py-4 items-center rounded-none active:opacity-60"
              >
                <Text style={{ color: STOP }} className="text-sm font-bold tracking-[0.18em] uppercase">
                  End night
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </ScrollView>
  );
}
