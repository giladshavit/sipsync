import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import Head from '@/lib/head';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { useHydrated } from '@/hooks/useHydrated';
import { ACTIVE_GAME_CATALOG, type GameMeta } from '@/constants/games';
import { CategoryFilterChips, type CategoryFilter } from '@/components/CategoryFilterChips';

const GRID_GAP = 10;
const H_PADDING = 20;
const COLUMNS = 3;

export default function AllGamesScreen() {
  useWebPageBackground(colors.cream);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<CategoryFilter>('all');

  // Floored, not just divided — Yoga snaps each child's float width to the
  // device's pixel grid independently, and on screen widths where this
  // division isn't a whole number, three independently-rounded-UP cards can
  // sum to a hair more than the row's actual available width, which is
  // exactly what tips flexWrap into bumping the 3rd card to its own line
  // (the bug this fixes). Flooring means 3 cards can only ever round DOWN
  // from here, never past the budget, so the row can never overflow.
  // The static export renders with no viewport (width 0), which would bake
  // negative card/icon sizes into the HTML — use a phone-ish width there.
  // The same value must serve the first client pass too: hydration adopts
  // server inline styles verbatim, so only a post-hydration value *change*
  // gets the real measured width written to the DOM (see useHydrated).
  const hydrated = useHydrated();
  const layoutWidth = hydrated ? width || 390 : 390;
  const cellSize = Math.floor((layoutWidth - H_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS);

  const games = useMemo(
    () => (filter === 'all' ? ACTIVE_GAME_CATALOG : ACTIVE_GAME_CATALOG.filter((g) => g.categories.includes(filter))),
    [filter],
  );

  // Chunked into fixed rows of exactly COLUMNS, rather than a flexWrap flow
  // of same-width children — belt and suspenders on top of the floor above:
  // the column count is then a structural guarantee (each row IS 3 cards),
  // never a byproduct of whether floating-point card widths happen to sum
  // under the container's width on a given device.
  const rows = useMemo(() => {
    const chunks: GameMeta[][] = [];
    for (let i = 0; i < games.length; i += COLUMNS) {
      chunks.push(games.slice(i, i + COLUMNS));
    }
    return chunks;
  }, [games]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Head>
        <title>All 15 Party Drinking Games — Quickle</title>
        <meta
          name="description"
          content="Browse Quickle's 15 party drinking mini-games — speed, luck and strategy games with full rules, who drinks, and scoring."
        />
        <link rel="canonical" href="https://www.quicklegame.com/games" />
      </Head>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: H_PADDING,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {/* Back to home */}
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>

        {/* Header — split-weight signature, matches home/lobby */}
        <View className="mb-6">
          <Text
            style={{
              color: colors.amber,
              ...typography.label,
              fontSize: 11,
              letterSpacing: 4,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            {ACTIVE_GAME_CATALOG.length} mini-games
          </Text>
          <Text style={{ fontWeight: '200', color: colors.ink, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
            All
          </Text>
          <Text style={{ fontWeight: '900', color: colors.amber, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
            Games
          </Text>
        </View>

        {/* Category filter chips */}
        <CategoryFilterChips value={filter} onChange={setFilter} style={{ marginBottom: 20 }} />

        {/* Game grid — fixed rows of exactly 3, not a flexWrap flow (see
            `rows` above for why). */}
        <View style={{ gap: GRID_GAP }}>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={{ flexDirection: 'row', gap: GRID_GAP }}>
              {row.map((game) => (
                // Link, not router.push: crawlers only follow real <a href>
                // anchors, and these cards are the site's path to the rules
                // pages.
                <Link
                  key={game.id}
                  href={{ pathname: '/games/[id]', params: { id: game.id } }}
                  asChild
                >
                <Pressable
                  style={{
                    width: cellSize,
                    borderWidth: 2,
                    borderColor: colors.ink,
                    backgroundColor: colors.parchment,
                  }}
                  className="active:opacity-75"
                >
                  {/* Image placeholder — swaps for real artwork later */}
                  <View
                    style={{
                      width: '100%',
                      aspectRatio: 1,
                      backgroundColor: game.accentColor,
                      borderBottomWidth: 2,
                      borderBottomColor: colors.ink,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <game.Icon size={cellSize * 0.34} color={colors.parchment} strokeWidth={1.75} />
                  </View>

                  <View
                    style={{
                      paddingHorizontal: cellSize * 0.09,
                      paddingVertical: 14,
                      minHeight: 60,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      numberOfLines={2}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                      style={{
                        color: colors.ink,
                        // Scales with the card itself so a cramped narrow
                        // device shrinks the title instead of clipping or
                        // overflowing it — clamped so it never gets either
                        // illegibly small or oversized on a wide tablet.
                        fontSize: Math.max(11, Math.min(13, cellSize * 0.12)),
                        fontWeight: '900',
                        letterSpacing: 0.3,
                        lineHeight: Math.max(13, Math.min(16, cellSize * 0.15)),
                        textAlign: 'center',
                        textTransform: 'uppercase',
                      }}
                    >
                      {game.title}
                    </Text>
                  </View>
                </Pressable>
                </Link>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
