import { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Head from '@/lib/head';
import { ArrowLeft, Bot, GlassWater, PlayCircle } from 'lucide-react-native';
import { colors } from '@/constants/design';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { CATEGORY_LABELS, GAME_CATALOG, getGameById, type PairwiseMatrix, type RuleLine } from '@/constants/games';
import { getTutorialComponent } from '@/constants/tutorials';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { apiFetch } from '@/lib/api';
import { PracticeRoleSheet, type PracticeRole } from '@/components/PracticeRoleSheet';

// Games that pick a small number of participants at random each round —
// against bots, a real person could easily never land in the interesting
// seat, so practice mode asks which one they want up front instead of
// leaving it to chance. Mirrors bot_engine.py's own _PRACTICE_ROLE_GAMES.
const PRACTICE_ROLE_GAMES = new Set(['black_box']);

function pointColor(points: string) {
  if (points.startsWith('-')) return colors.stop;
  if (points.startsWith('+')) return colors.go;
  return colors.dune;
}

function badgeFor(n: number): { symbol: string; bg: string } {
  return { symbol: String(n), bg: n > 0 ? colors.go : n < 0 ? colors.stop : colors.dune };
}

// A score badge only renders as colored circle(s) for shapes that reduce to
// a small set of glyphs: a clean signed integer (+10, -5, 0 ...), a short
// numeric range (+3 to +7 -> one circle per value), or the rank-scaled
// "depends on the result" case. Anything else (formulas, per-guesser math)
// falls back to the plain description + text-value row so nothing overflows.
function scoreBadges(points: string): { symbol: string; bg: string }[] | null {
  const trimmed = points.trim();
  // A bare "?" (unlike "Between X and Y") means the outcome always loses,
  // just by an amount that depends on what was bid/pledged/etc — a plain
  // red circle, not the amber "could go either way" badge.
  if (trimmed === '?') {
    return [{ symbol: '?', bg: colors.stop }];
  }
  if (/between/i.test(trimmed)) {
    return [{ symbol: '?', bg: colors.amber }];
  }
  const range = trimmed.match(/^([+-]?\d+)\s*to\s*([+-]?\d+)$/i);
  if (range) {
    const start = parseInt(range[1], 10);
    const end = parseInt(range[2], 10);
    const step = start <= end ? 1 : -1;
    const badges: { symbol: string; bg: string }[] = [];
    for (let n = start; step > 0 ? n <= end : n >= end; n += step) {
      badges.push(badgeFor(n));
    }
    return badges;
  }
  if (/^[+-]?\d+$/.test(trimmed)) {
    return [badgeFor(parseInt(trimmed, 10))];
  }
  return null;
}

function segmentColor(color: 'red' | 'green' | 'amber' | 'blue' | 'orange' | undefined): string {
  if (color === 'red') return colors.stop;
  if (color === 'green') return colors.go;
  if (color === 'amber') return colors.amber;
  if (color === 'blue') return colors.tapped;
  if (color === 'orange') return colors.orange;
  return colors.ink;
}

function RuleText({ line, fontSize = 14, lineHeight = 20 }: { line: RuleLine; fontSize?: number; lineHeight?: number }) {
  if (typeof line === 'string') {
    return <Text style={{ color: colors.ink, fontSize, lineHeight, flex: 1 }}>{line}</Text>;
  }
  return (
    <Text style={{ fontSize, lineHeight, flex: 1 }}>
      {line.map((seg, i) => (
        <Text
          key={i}
          style={{
            color: segmentColor(seg.color),
            fontWeight: seg.color || seg.bold ? '800' : '400',
          }}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

function SectionDivider() {
  return <View style={{ height: 2, backgroundColor: colors.ink, opacity: 0.12, marginVertical: 28 }} />;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: colors.ink,
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginBottom: 14,
      }}
    >
      <Text
        style={{
          color: colors.cream,
          fontWeight: '900',
          fontSize: 12,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Text>
    </View>
  );
}

// Short callout box for a clarifying aside that doesn't belong in a numbered
// step or a drinkingRules/scoring row (e.g. "both rows stack", "the odd
// player out sits this one out").
function NoteBox({ children }: { children: string }) {
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: colors.ink,
        backgroundColor: colors.amber,
        paddingVertical: 10,
        paddingHorizontal: 14,
        marginTop: 10,
      }}
    >
      <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700', lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

const GRID_CORNER = 84;
const GRID_HEADER_HEIGHT = 58;

// Renders a 2x2 "you chose X, they chose Y" payoff grid (Prisoner's Dilemma-
// style games). Backs both the "Who drinks" and "Scoring" sections off the
// same matrix data — mode picks which outcome each cell displays. Columns
// are always "you" (top) and rows are always "them" (left), matching the
// diagonal corner label split.
function PairwiseGrid({ matrix, mode }: { matrix: PairwiseMatrix; mode: 'chasers' | 'points' }) {
  const headerCellStyle = {
    flex: 1,
    height: GRID_HEADER_HEIGHT,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderColor: colors.ink,
    backgroundColor: colors.parchment,
  };
  const cornerLabelStyle = {
    fontSize: 11,
    fontWeight: '900' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    color: colors.ink,
  };
  const optionColor = (i: number) => {
    const c = matrix.optionColors?.[i];
    return c === 'red' ? colors.stop : c === 'green' ? colors.go : colors.ink;
  };

  return (
    <View style={{ borderWidth: 2, borderColor: colors.ink }}>
      {/* Header row — blank corner (diagonal You/Them split) + one "You" column per option */}
      <View style={{ flexDirection: 'row' }}>
        <View
          style={{
            width: GRID_CORNER,
            height: GRID_HEADER_HEIGHT,
            borderBottomWidth: 2,
            borderColor: colors.ink,
            backgroundColor: colors.parchment,
            overflow: 'hidden',
          }}
        >
          <Svg width={GRID_CORNER} height={GRID_HEADER_HEIGHT} style={{ position: 'absolute' }}>
            <Line x1={0} y1={0} x2={GRID_CORNER} y2={GRID_HEADER_HEIGHT} stroke={colors.ink} strokeWidth={1.5} />
          </Svg>
          <Text style={[cornerLabelStyle, { position: 'absolute', top: 6, right: 8 }]}>{matrix.yourLabel}</Text>
          <Text style={[cornerLabelStyle, { position: 'absolute', bottom: 6, left: 8 }]}>{matrix.theirLabel}</Text>
        </View>
        {matrix.options.map((opt, i) => (
          <View key={opt} style={[headerCellStyle, { borderBottomWidth: 2, borderLeftWidth: 2 }]}>
            <Text style={{ fontWeight: '800', fontSize: 13, color: optionColor(i) }}>{opt}</Text>
          </View>
        ))}
      </View>

      {/* Body rows — one "Them" row-label per option, then the data cells.
          cells[] is indexed [yourChoice][theirChoice], so with columns=you
          and rows=them the lookup for (row ri, col ci) is cells[ci][ri]. */}
      {matrix.options.map((rowOpt, ri) => (
        <View key={rowOpt} style={{ flexDirection: 'row' }}>
          <View
            style={{
              width: GRID_CORNER,
              padding: 10,
              justifyContent: 'center',
              borderTopWidth: ri > 0 ? 2 : 0,
              borderColor: colors.ink,
              backgroundColor: colors.parchment,
            }}
          >
            <Text style={{ fontWeight: '800', fontSize: 13, color: optionColor(ri) }}>{rowOpt}</Text>
          </View>
          {matrix.options.map((_, ci) => {
            const cell = matrix.cells[ci][ri];
            const badge = mode === 'points' ? scoreBadges(cell.points)?.[0] : null;
            return (
              <View
                key={ci}
                style={{
                  flex: 1,
                  padding: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderTopWidth: ri > 0 ? 2 : 0,
                  borderLeftWidth: 2,
                  borderColor: colors.ink,
                }}
              >
                {mode === 'chasers' ? (
                  cell.chasers === 0 ? (
                    <Text style={{ color: colors.go, fontSize: 13, fontWeight: '700' }}>SAFE</Text>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 3 }}>
                      {Array.from({ length: cell.chasers }).map((_, j) => (
                        <GlassWater key={j} size={18} color={colors.stop} strokeWidth={2} />
                      ))}
                    </View>
                  )
                ) : badge ? (
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: badge.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 13 }}>{badge.symbol}</Text>
                  </View>
                ) : (
                  <Text style={{ fontWeight: '800', fontSize: 17, color: pointColor(cell.points) }}>
                    {cell.points}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// Static export: prerender a real HTML page per catalog game.
export function generateStaticParams(): { id: string }[] {
  return GAME_CATALOG.map((g) => ({ id: g.id }));
}

export default function GameRulesScreen() {
  useWebPageBackground(colors.cream);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const game = getGameById(id ?? '');
  const { playerId } = usePlayerIdentity();
  const [simulating, setSimulating] = useState(false);
  const [showRoleSheet, setShowRoleSheet] = useState(false);
  const [selectedRole, setSelectedRole] = useState<PracticeRole | null>(null);

  async function handleSimulate(role?: PracticeRole) {
    if (!playerId || !game || simulating) return;
    setSimulating(true);
    setSelectedRole(role ?? null);
    try {
      const res = await apiFetch('/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_id: playerId,
          game_ids: [game.id],
          practice: true,
          ...(role ? { practice_role: role } : {}),
        }),
      });
      if (!res.ok) throw new Error('practice room create failed');
      const data: { code: string } = await res.json();
      // replace, not push: the whole practice flow (practice-start -> game ->
      // summary) chains router.replace calls back to this same rules-screen
      // route. Pushing here would leave this screen's instance alive
      // underneath that chain — its stale `simulating` state (still true from
      // this very click) would then resurface when the user hits the back
      // button, showing the Bot button stuck on its loading spinner instead
      // of a normal back navigation.
      router.replace({
        pathname: '/room/[code]/practice-start',
        params: { code: data.code, gameId: game.id },
      });
    } catch {
      setSimulating(false);
      setSelectedRole(null);
      setShowRoleSheet(false);
    }
  }

  function handleBotPress() {
    if (game && PRACTICE_ROLE_GAMES.has(game.id)) {
      setShowRoleSheet(true);
    } else {
      handleSimulate();
    }
  }

  if (!game) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.ink, fontSize: 16 }}>Game not found.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.amber, fontWeight: '700' }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const { Icon } = game;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Head>
        <title>{`${game.title} — Drinking Game Rules | Quickle`}</title>
        <meta
          name="description"
          content={`${game.title}: ${game.tagline}. Full rules, who drinks, and scoring for this Quickle party mini-game.`}
        />
        <link rel="canonical" href={`https://www.quicklegame.com/games/${game.id}`} />
      </Head>
      {/* Fixed header — just the banner + the back button floating on it.
          Sits outside the ScrollView so it stays pinned; everything else
          (title, tagline, category badges, the rules themselves) scrolls
          underneath it. */}
      <View
        style={{
          width: '100%',
          height: 240,
          backgroundColor: game.accentColor,
          borderBottomWidth: 2,
          borderBottomColor: colors.ink,
        }}
      >
        {/* paddingTop excludes the status-bar/notch area from the centering
            math, so the icon sits in the middle of the visible banner
            instead of the middle of the full (notch-covered) rectangle. */}
        <View style={{ flex: 1, paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={80} color={colors.parchment} strokeWidth={1.5} />
        </View>
      </View>

      {/* Back to grid — floats over the banner */}
      <Pressable
        onPress={() => router.back()}
        style={{
          position: 'absolute',
          top: insets.top + 12,
          left: 16,
          width: 42,
          height: 42,
          borderWidth: 2,
          borderColor: colors.ink,
          backgroundColor: colors.cream,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="active:opacity-70"
      >
        <ArrowLeft size={20} color={colors.ink} />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <View style={{ paddingHorizontal: 24, paddingTop: 20 }}>
          {/* Category badges on the left, tutorial preview on the right —
              same line, so the button doesn't push everything else down */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              rowGap: 8,
              marginBottom: 16,
            }}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {game.categories.map((cat) => (
                <View
                  key={cat}
                  style={{
                    alignSelf: 'flex-start',
                    borderWidth: 2,
                    borderColor: colors.ink,
                    paddingHorizontal: 12,
                    paddingVertical: 4,
                  }}
                >
                  <Text
                    style={{
                      color: colors.ink,
                      fontSize: 11,
                      fontWeight: '700',
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {CATEGORY_LABELS[cat]}
                  </Text>
                </View>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {getTutorialComponent(game.id) && (
                <Pressable
                  onPress={() => router.push(`/games/${game.id}/tutorial`)}
                  style={{
                    width: 44,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.amber,
                    borderWidth: 2,
                    borderColor: colors.ink,
                  }}
                  className="active:opacity-80"
                >
                  <PlayCircle size={22} color={colors.ink} strokeWidth={2.5} />
                </Pressable>
              )}

              <Pressable
                onPress={handleBotPress}
                disabled={simulating}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.amber,
                  borderWidth: 2,
                  borderColor: colors.ink,
                  opacity: simulating ? 0.6 : 1,
                }}
                className="active:opacity-80"
              >
                {simulating ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : (
                  <Bot size={22} color={colors.ink} strokeWidth={2.5} />
                )}
              </Pressable>
            </View>
          </View>

          {/* Title */}
          <Text style={{ fontWeight: '900', color: colors.ink, fontSize: 32, lineHeight: 36, letterSpacing: -1 }}>
            {game.title}
          </Text>
          <Text style={{ color: colors.dune, fontSize: 14, marginTop: 6, marginBottom: 28 }}>
            {game.tagline}
          </Text>

          {/* How to play */}
          <SectionLabel>How to play</SectionLabel>
          <View style={{ gap: 12 }}>
            {game.rules.map((rule, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={{ color: colors.amber, fontWeight: '900', fontSize: 14, width: 18 }}>
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
          {game.rulesNote && <NoteBox>{game.rulesNote}</NoteBox>}

          <SectionDivider />

          {/* Who drinks */}
          <SectionLabel>Who drinks</SectionLabel>
          {game.pairwiseMatrix && <PairwiseGrid matrix={game.pairwiseMatrix} mode="chasers" />}
          <View style={{ gap: 10, marginTop: game.pairwiseMatrix ? 10 : 0 }}>
            {game.drinkingRules.map((rule, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: colors.ink,
                  backgroundColor: colors.parchment,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                }}
              >
                <View style={{ flexDirection: 'row', gap: 2, marginRight: 12 }}>
                  {rule.chasers === 0 ? (
                    <Text style={{ color: colors.go, fontSize: 12, fontWeight: '700' }}>
                      SAFE
                    </Text>
                  ) : (
                    Array.from({ length: rule.chasers }).map((_, j) => (
                      <GlassWater key={j} size={18} color={colors.stop} strokeWidth={2} />
                    ))
                  )}
                </View>
                <RuleText line={rule.description} fontSize={13} lineHeight={18} />
              </View>
            ))}
          </View>
          {game.whoDrinksNote && <NoteBox>{game.whoDrinksNote}</NoteBox>}

          <SectionDivider />

          {/* Scoring */}
          <SectionLabel>Scoring</SectionLabel>
          {game.pairwiseMatrix && <PairwiseGrid matrix={game.pairwiseMatrix} mode="points" />}
          <View style={{ gap: 10, marginTop: game.pairwiseMatrix ? 10 : 0 }}>
            {game.scoring.map((entry, i) => {
              const badges = scoreBadges(entry.points);
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 2,
                    borderColor: colors.ink,
                    backgroundColor: colors.parchment,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                  }}
                >
                  {badges ? (
                    <View style={{ flexDirection: 'row', gap: 4, marginRight: 12 }}>
                      {badges.map((badge, bi) => (
                        <View
                          key={bi}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            backgroundColor: badge.bg,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: badge.symbol === '?' ? 16 : 13 }}>
                            {badge.symbol}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <RuleText line={entry.description} fontSize={13} lineHeight={18} />
                  {!badges && (
                    <Text style={{ fontWeight: '800', fontSize: 13, color: pointColor(entry.points), marginLeft: 10 }}>
                      {entry.points}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {showRoleSheet && (
        <PracticeRoleSheet
          loadingRole={simulating ? selectedRole : null}
          onSelect={(role) => handleSimulate(role)}
          onClose={() => setShowRoleSheet(false)}
        />
      )}
    </View>
  );
}
