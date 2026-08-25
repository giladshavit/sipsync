import { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView } from 'react-native';
import { Crown, GlassWater } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';
import type { Player, PlayerOutcome } from '@/hooks/useRoomSocket';

// The "this round" breakdown row's avatar chip — small enough to keep each
// row compact, big enough for the character art to still read.
const ROW_AVATAR_SIZE = 30;

// How many chaser glasses to draw before falling back to a numeral
const MAX_GLASS_ICONS = 6;

// One line per player in the round breakdown — what their round looked like
export function statLabel(o: PlayerOutcome): string {
  if (typeof o.taps === 'number') return `${o.taps} taps`;
  if (typeof o.error_ms === 'number' && typeof o.elapsed_ms === 'number') {
    return `${(o.elapsed_ms / 1000).toFixed(1)}s · ${(o.error_ms / 1000).toFixed(1)} off`;
  }
  if (o.reason === 'early_tap') return 'Too early';
  if (o.reason === 'missed') return 'Missed';
  if (o.reason === 'timed_out' || o.reason === 'no_tap') return 'No tap';
  if (typeof o.reaction_ms === 'number') return `${(o.reaction_ms / 1000).toFixed(2)}s`;
  if (typeof o.number === 'number' && typeof o.distance === 'number') {
    return `${o.number} · ${o.distance} from avg`;
  }
  // Games without a per-round stat (e.g. roulette) fall back to points earned
  if (typeof o.score_delta === 'number') {
    return `${o.score_delta >= 0 ? '+' : '−'}${Math.abs(o.score_delta)} pts`;
  }
  return '—';
}

// Best performance first: most taps, closest to target, or fastest valid
// reaction; early taps and no-shows sink to the bottom. Games without a
// per-round stat rank by points earned this round, highest first.
export function performanceKey(o: PlayerOutcome): number {
  if (typeof o.taps === 'number') return -o.taps;
  if (typeof o.error_ms === 'number') return o.error_ms;
  if (typeof o.reaction_ms === 'number') return o.reaction_ms;
  if (typeof o.distance === 'number') return o.distance;
  if (o.reason === 'early_tap' || o.reason === 'missed') return Number.MAX_SAFE_INTEGER - 1;
  if (o.reason === 'timed_out' || o.reason === 'no_tap') return Number.MAX_SAFE_INTEGER;
  if (typeof o.score_delta === 'number') return -o.score_delta;
  return Number.MAX_SAFE_INTEGER;
}

export function roundResultBgColor(result: PlayerOutcome['result'] | undefined): string {
  return result === 'WIN' ? colors.go : result === 'LOSE' ? colors.stop : colors.safe;
}

/**
 * The full-bleed "you WIN/DRINK/SAFE" visual, shared by the mandatory
 * first-view screen (summary.tsx) and the leaderboard's "last round" tab
 * (podium.tsx) — same content either way, just different surroundings
 * (a countdown footer vs. a plain back-to-leaderboard button).
 */
export function RoundResultCard({
  outcome,
  allOutcomes,
  players,
  playerId,
  displayName,
}: {
  outcome: PlayerOutcome | null;
  allOutcomes: Record<string, PlayerOutcome>;
  players: Record<string, Player>;
  playerId: string | null;
  /** null until the room snapshot has landed — see summary.tsx. */
  displayName: string | null;
}) {
  const insets = useSafeAreaInsets();
  const result = outcome?.result ?? 'SAFE';
  const bgColor = roundResultBgColor(result);

  const thinWord = result === 'SAFE' ? "you're" : 'you';
  const verdictWord = result === 'WIN' ? 'WIN' : result === 'LOSE' ? 'DRINK' : 'SAFE';

  // score_delta arrives signed from the server (+1 / −1)
  const delta = outcome?.score_delta ?? 0;
  const deltaChip = delta !== 0 ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)} PTS` : null;

  const chasers = outcome?.chasers ?? 0;

  // Everyone's round, best performance first — so you see where you landed
  // Identity flash: `players` comes from the room snapshot, which is empty
  // for the first frames after router.replace (useRoomSocket opens a fresh
  // socket per screen — see summary.tsx). This used to substitute 'Player'
  // and a generic circled "P", i.e. confidently wrong identity that then
  // snapped to the real name and avatar. null means "not known yet"; the
  // row keeps its exact footprint below and simply doesn't draw a name or
  // an avatar until it is.
  const breakdown = Object.entries(allOutcomes)
    .map(([pid, o]) => ({
      pid,
      outcome: o,
      name: players[pid]?.display_name ?? null,
      avatar: players[pid]?.avatar ?? null,
    }))
    .sort((a, b) => performanceKey(a.outcome) - performanceKey(b.outcome));
  const hasBreakdown = breakdown.length > 1;

  // ── Breakdown list height cap ────────────────────────────────────────────
  // The "This round" box should hug its own rows (a 3-player round shouldn't
  // drag a near-empty box down the screen) but still be stoppable before it
  // runs into whatever's below (the summary screen's countdown footer, or
  // podium's own chrome) once a full room's worth of rows would otherwise
  // overflow. flexShrink/flex:1-on-ScrollView combos to express "capped but
  // content-sized" turned out to resolve inconsistently between web and
  // native (worked in preview, collapsed the list to zero rows on-device) —
  // measuring the real available pixels via onLayout and handing the
  // ScrollView a concrete `maxHeight` is the version that's actually
  // reliable on both. Both callbacks fire (and this resolves) well before
  // the box's own entering animation (450ms delay) makes it visible.
  //
  // The cap applies to the ScrollView itself, so it has to net out the
  // breakdown box's own chrome around that ScrollView (external margins +
  // internal padding + the "This round" header line) — otherwise the box's
  // real on-screen height would run past the measured budget by exactly
  // that much.
  const BREAKDOWN_CHROME_HEIGHT = 26 /* marginTop */ + 4 /* marginBottom */ + 20 /* paddingVertical */ + 22; /* header text + its marginBottom */
  const [outerHeight, setOuterHeight] = useState<number | null>(null);
  const [aboveBreakdownHeight, setAboveBreakdownHeight] = useState<number | null>(null);
  const breakdownScrollMaxHeight =
    outerHeight != null && aboveBreakdownHeight != null
      ? Math.max(60, outerHeight - aboveBreakdownHeight - BREAKDOWN_CHROME_HEIGHT - 8 /* safety */)
      : undefined;

  // ── LOSE flash: brief white-overlay pulse on mount ─────────────────────────
  const flashOpacity = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));
  useEffect(() => {
    if (result === 'LOSE') {
      flashOpacity.value = withSequence(
        withTiming(0.35, { duration: 80 }),
        withTiming(0, { duration: 200 }),
        withTiming(0.25, { duration: 80 }),
        withTiming(0, { duration: 300 }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View className="flex-1" style={{ backgroundColor: bgColor, overflow: 'hidden' }}>
      {/* Ghost verdict column — set in poster type */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -20,
          bottom: 0,
          left: 0,
          right: 0,
          justifyContent: 'space-between',
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Text
            key={i}
            numberOfLines={1}
            style={{
              color: 'rgba(255,255,255,0.06)',
              fontSize: 96,
              lineHeight: 100,
              fontWeight: '900',
              letterSpacing: 2,
              textAlign: i % 2 === 0 ? 'left' : 'right',
              paddingHorizontal: 8,
            }}
          >
            {verdictWord}
          </Text>
        ))}
      </View>

      {result === 'LOSE' && (
        <Animated.View
          className="absolute inset-0 bg-white"
          style={flashStyle}
          pointerEvents="none"
        />
      )}

      <View
        className="flex-1 items-center px-8"
        style={{
          justifyContent: hasBreakdown ? 'flex-start' : 'center',
          paddingTop: hasBreakdown ? insets.top + 28 : 0,
        }}
        onLayout={(e) => setOuterHeight(e.nativeEvent.layout.height)}
      >
        <View
          style={{ alignItems: 'center' }}
          onLayout={(e) => setAboveBreakdownHeight(e.nativeEvent.layout.height)}
        >
          <Animated.View entering={FadeInDown.duration(350)} style={{ alignItems: 'center' }}>
            <Text
              style={{
                color: 'rgba(255,255,255,0.65)',
                ...typography.label,
                fontSize: 11,
                letterSpacing: 4,
                textTransform: 'uppercase',
                marginBottom: 10,
                // Identity flash: hold this line invisible (not filled with
                // a placeholder name) until the snapshot lands. It still
                // occupies its full line height, so nothing below moves when
                // the real name arrives.
                opacity: displayName ? 1 : 0,
              }}
            >
              Round verdict{displayName ? ` · ${displayName}` : ''}
            </Text>

            {/* Split-weight verdict — the brand's thin/heavy signature */}
            <Text
              style={{
                color: '#FFFFFF',
                fontWeight: '200',
                fontSize: 40,
                lineHeight: 44,
                letterSpacing: -1,
              }}
            >
              {thinWord}
            </Text>
            <Text
              style={{
                color: '#FFFFFF',
                fontWeight: '900',
                fontSize: 88,
                lineHeight: 94,
                letterSpacing: -3,
              }}
            >
              {verdictWord}
            </Text>
          </Animated.View>

          {/* Chasers as physical glasses — one per drink owed. Shown whenever a
              chaser is owed, not just on LOSE: a round can pay out positive
              points while still owing a drink (e.g. Sacrifice's volunteers),
              and that combo needs the same glasses a plain loss gets. */}
          {chasers > 0 && (
            <Animated.View
              entering={FadeInDown.delay(200).duration(350)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22 }}
            >
              {Array.from({ length: Math.min(chasers, MAX_GLASS_ICONS) }).map((_, i) => (
                <GlassWater key={i} size={26} color="#FFFFFF" strokeWidth={2} />
              ))}
              {chasers > MAX_GLASS_ICONS && (
                <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '700' }}>
                  ×{chasers}
                </Text>
              )}
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16, marginLeft: 6 }}>
                {chasers === 1 ? 'chaser' : 'chasers'}
              </Text>
            </Animated.View>
          )}

          {/* Score delta + running total */}
          <Animated.View
            entering={FadeInDown.delay(300).duration(350)}
            style={{ alignItems: 'center', marginTop: 24 }}
          >
            {deltaChip && (
              <View
                style={{
                  backgroundColor: 'rgba(0,0,0,0.22)',
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  marginBottom: 10,
                }}
              >
                <Text
                  style={{
                    color: '#FFFFFF',
                    ...typography.label,
                    fontWeight: '700',
                    fontSize: 15,
                    letterSpacing: 2,
                  }}
                >
                  {deltaChip}
                </Text>
              </View>
            )}
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15 }}>
              Total: {outcome?.total_score ?? '—'} pts
            </Text>
          </Animated.View>
        </View>

        {/* The whole round, ranked — see where you landed. Sized to its own
            rows (a 3-player round doesn't drag a near-empty box down to the
            safe area) but capped by breakdownScrollMaxHeight — the real measured
            space left below the verdict/chasers/score block — so a full
            room's worth of rows scrolls internally instead of overflowing
            past the bottom padding. */}
        {hasBreakdown && (
          <Animated.View
            entering={FadeInDown.delay(450).duration(350)}
            style={{
              alignSelf: 'stretch',
              backgroundColor: 'rgba(0,0,0,0.20)',
              marginTop: 26,
              marginBottom: 4,
              paddingVertical: 10,
              paddingHorizontal: 14,
            }}
          >
            <Text
              style={{
                color: 'rgba(255,255,255,0.5)',
                ...typography.label,
                fontSize: 10,
                letterSpacing: 3,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              This round
            </Text>
            <ScrollView
              style={breakdownScrollMaxHeight != null ? { maxHeight: breakdownScrollMaxHeight } : undefined}
              contentContainerStyle={{ paddingBottom: 4 }}
              showsVerticalScrollIndicator={false}
            >
              {breakdown.map((row, index) => {
                const isMe = row.pid === playerId;
                const isTop = index === 0;
                const o = row.outcome;
                const name = row.name;
                const avatarSource = row.avatar ? AVATAR_IMAGES[row.avatar] : undefined;
                const ringColor = row.avatar
                  ? AVATAR_COLORS[row.avatar]
                  : name !== null
                    ? avatarFallbackColor(row.pid)
                    : 'rgba(255,255,255,0.18)'; // neutral placeholder, not a guessed identity
                const initial = name ? (name.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase() : '';
                return (
                  <View
                    key={row.pid}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 8,
                      paddingHorizontal: isMe ? 8 : 0,
                      marginHorizontal: isMe ? -8 : 0,
                      backgroundColor: isMe ? 'rgba(255,255,255,0.16)' : 'transparent',
                      borderLeftWidth: isMe ? 3 : 0,
                      borderLeftColor: '#FFFFFF',
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <Text
                      style={{
                        width: 18,
                        color: isMe ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
                        ...typography.label,
                        fontWeight: '700',
                        fontSize: 12,
                      }}
                    >
                      {index + 1}
                    </Text>

                    {/* Avatar chip — image when the player picked one, else
                        an initial-letter circle in their stable fallback
                        color. Ring is always the avatar's own accent (or the
                        fallback hash color) so it reads consistently with
                        the lobby's avatar picker. */}
                    <View
                      style={{
                        width: ROW_AVATAR_SIZE,
                        height: ROW_AVATAR_SIZE,
                        marginRight: 10,
                      }}
                    >
                      <View
                        style={{
                          width: ROW_AVATAR_SIZE,
                          height: ROW_AVATAR_SIZE,
                          borderRadius: ROW_AVATAR_SIZE / 2,
                          overflow: 'hidden',
                          borderWidth: 2,
                          borderColor: isTop ? colors.amber : ringColor,
                          backgroundColor: avatarSource ? colors.parchment : ringColor,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {avatarSource ? (
                          <Image
                            source={avatarSource}
                            style={{ width: ROW_AVATAR_SIZE, height: ROW_AVATAR_SIZE }}
                            resizeMode="cover"
                          />
                        ) : (
                          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>
                            {initial}
                          </Text>
                        )}
                      </View>
                      {/* Crown badge — this round's best performer only */}
                      {isTop && (
                        <View
                          style={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            backgroundColor: colors.amber,
                            borderWidth: 1.5,
                            borderColor: bgColor,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Crown size={9} color={colors.ink} strokeWidth={2.5} />
                        </View>
                      )}
                    </View>

                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: '#FFFFFF',
                        fontSize: isMe ? 15 : 14,
                        fontWeight: isMe ? '900' : '500',
                        opacity: isMe ? 1 : 0.85,
                        marginRight: 8,
                      }}
                    >
                      {name !== null ? `${name}${isMe ? ' (you)' : ''}` : ''}
                    </Text>
                    {/* Only losers get an icon — a solid (filled, not
                        outline) glass, so "you're drinking" reads instantly
                        without a winner-side medal that read as another
                        glass at this size. No icon at all is itself the
                        winner's signal. */}
                    {o.result === 'LOSE' && (
                      <GlassWater
                        size={14}
                        color="rgba(255,255,255,0.9)"
                        fill="rgba(255,255,255,0.9)"
                        strokeWidth={2}
                        style={{ marginRight: 6 }}
                      />
                    )}
                    <Text
                      style={{
                        color: 'rgba(255,255,255,0.9)',
                        ...typography.label,
                        fontWeight: '700',
                        fontSize: 13,
                      }}
                    >
                      {statLabel(o)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
